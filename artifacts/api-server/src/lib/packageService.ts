import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { db } from "@workspace/db";
import {
  packagesTable,
  violationsTable,
  regulationsTable,
  auditEventsTable,
  packageVersionsTable,
  annotationsTable,
  commentRepliesTable,
  reviewTasksTable,
  approvalDecisionsTable,
  type PackageRow,
  type ViolationRow,
  type PackageVersionRow,
  type CommentReplyRow,
} from "@workspace/db";
import { eq, and, ne, asc, inArray } from "drizzle-orm";
import {
  type AnalysisResult,
  findingClassColor,
  priorityFromSeverity,
} from "./ai";
import { mapPackageDetail } from "./mappers";
import { ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(MODULE_DIR, "..", "..", "..", "..");
const COMPLIANCE_PUBLIC = path.join(
  WORKSPACE_ROOT,
  "artifacts",
  "compliance",
  "public",
);
const objectStorage = new ObjectStorageService();

/** Load raw bytes for an artwork URL from object storage or the seed public dir. */
async function loadFileBytes(fileUrl: string): Promise<Uint8Array | null> {
  try {
    if (fileUrl.startsWith("/objects/")) {
      const file = await objectStorage.getObjectEntityFile(fileUrl);
      const response = await objectStorage.downloadObject(file);
      return new Uint8Array(await response.arrayBuffer());
    }
    const rel = fileUrl.replace(/^\//, "");
    const bytes = await readFile(path.join(COMPLIANCE_PUBLIC, rel));
    return new Uint8Array(bytes);
  } catch (err) {
    logger.warn({ err, fileUrl }, "Could not load file for page-count detection");
    return null;
  }
}

/** Detect the number of pages in a PDF; returns 1 for non-PDF or on failure. */
export async function detectPageCount(
  fileUrl: string | null | undefined,
  fileType: string | null | undefined,
): Promise<number> {
  if (fileType !== "pdf" || !fileUrl) return 1;
  const bytes = await loadFileBytes(fileUrl);
  if (!bytes) return 1;
  try {
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    return Math.max(1, doc.getPageCount());
  } catch (err) {
    logger.warn({ err, fileUrl }, "PDF page-count detection failed");
    return 1;
  }
}

export function gradeToStatus(complianceStatus: string): string {
  if (complianceStatus === "Passed") return "Approved";
  if (complianceStatus === "Failed") return "Needs Revision";
  return "AI Review";
}

export async function loadRegulations() {
  return db.select().from(regulationsTable);
}

/** Ensure a package has at least one version; returns the current version. */
export async function ensureInitialVersion(
  pkg: PackageRow,
): Promise<PackageVersionRow> {
  const existing = await db
    .select()
    .from(packageVersionsTable)
    .where(eq(packageVersionsTable.packageId, pkg.id))
    .orderBy(asc(packageVersionsTable.versionNumber));
  if (existing.length > 0) {
    return existing.find((v) => v.isCurrent) ?? existing[0]!;
  }
  const fileType = inferFileType(pkg.artworkUrl);
  const [created] = await db
    .insert(packageVersionsTable)
    .values({
      packageId: pkg.id,
      versionNumber: 1,
      label: "Version 1",
      fileUrl: pkg.artworkUrl,
      fileName: pkg.artworkUrl ? pkg.artworkUrl.split("/").pop() : null,
      fileType,
      pageCount: await detectPageCount(pkg.artworkUrl, fileType),
      extractedText: pkg.extractedText,
      isCurrent: true,
      createdBy: "System",
    })
    .returning();
  return created!;
}

export function inferFileType(url: string | null | undefined): string | null {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";
  if (lower.endsWith(".ai")) return "ai";
  if (lower.endsWith(".indd")) return "indd";
  return null;
}

function assignedRoleForFlags(flags: string[], engine: string): string {
  if (flags.includes("Legal")) return "Legal Reviewer";
  if (flags.includes("FTC")) return "Marketing Compliance";
  if (flags.includes("EPA")) return "EPA Specialist";
  if (flags.includes("FDA")) return "FDA Specialist";
  if (/spell|grammar|typograph|contextual|language/i.test(engine))
    return "Copy Editor";
  return "Compliance Reviewer";
}

/**
 * Deterministic, non-overlapping layout for AI finding pins.
 *
 * The analysis model only sees the extracted copy, not the rendered artwork, so
 * any bounding box it returns is a guess — in practice the boxes cluster on top
 * of each other and drift into the empty margins off the product. Instead of
 * trusting those coordinates we place pins on an even grid inside a safe central
 * band of the artwork, so markers stay on the product, never overlap, and read
 * as intentional. Order follows finding order, which drives the numbered labels.
 */
export function layoutPinPositions(count: number): { x: number; y: number }[] {
  if (count <= 0) return [];
  const xMin = 0.16;
  const xMax = 0.84;
  const yMin = 0.12;
  const yMax = 0.88;
  const cols = count <= 3 ? count : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const rows = Math.ceil(count / cols);
  const step = cols > 1 ? (xMax - xMin) / (cols - 1) : 0;
  const positions: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const itemsInRow = Math.min(cols, count - r * cols);
    // Center partial (final) rows within the full-column grid width so a short
    // last row sits under the columns above instead of stretching to the edges.
    const rowWidth = (itemsInRow - 1) * step;
    const startX = xMin + (xMax - xMin - rowWidth) / 2;
    const x = cols === 1 ? 0.5 : startX + c * step;
    const y =
      rows === 1 ? (yMin + yMax) / 2 : yMin + (yMax - yMin) * (r / (rows - 1));
    positions.push({ x: +x.toFixed(4), y: +y.toFixed(4) });
  }
  return positions;
}

/**
 * Persist an analysis result: update the package, replace violations, and
 * regenerate AI annotations + review tasks (leaving human ones intact).
 */
export async function applyAnalysis(
  pkg: PackageRow,
  result: AnalysisResult,
  versionId: number | null,
  organizationId: number | null = null,
): Promise<void> {
  const counts = result.violations.reduce(
    (acc, v) => {
      if (v.findingClass !== "issue" && v.findingClass !== "warning")
        return acc;
      if (v.severity === "critical") acc.critical += 1;
      else if (v.severity === "major") acc.major += 1;
      else if (v.severity === "minor") acc.minor += 1;
      return acc;
    },
    { critical: 0, major: 0, minor: 0 },
  );

  await db
    .update(packagesTable)
    .set({
      category: result.category,
      grade: result.grade,
      riskScore: result.riskScore,
      complianceStatus: result.complianceStatus,
      status: gradeToStatus(result.complianceStatus),
      summary: result.summary,
      complianceImpact: result.complianceImpact,
      ocr: result.ocr,
      recommendations: result.recommendations,
      criticalCount: counts.critical,
      majorCount: counts.major,
      minorCount: counts.minor,
      analyzedAt: new Date(),
    })
    .where(eq(packagesTable.id, pkg.id));

  await db.delete(violationsTable).where(eq(violationsTable.packageId, pkg.id));

  let insertedViolations: ViolationRow[] = [];
  if (result.violations.length > 0) {
    insertedViolations = await db
      .insert(violationsTable)
      .values(
        result.violations.map((v) => ({
          organizationId,
          packageId: pkg.id,
          severity: v.severity,
          engine: v.engine,
          title: v.title,
          description: v.description,
          regulationRef: v.regulationRef,
          recommendation: v.recommendation,
          detectedText: v.detectedText,
          suggestedText: v.suggestedText,
          bboxX: v.bbox?.x ?? null,
          bboxY: v.bbox?.y ?? null,
          bboxW: v.bbox?.w ?? null,
          bboxH: v.bbox?.h ?? null,
          page: v.page,
          confidence: v.confidence,
          findingClass: v.findingClass,
          claimFlags: v.claimFlags,
          status: "Open",
        })),
      )
      .returning();
  }

  // Regenerate AI annotations (remove previous AI-authored ones only).
  await db
    .delete(annotationsTable)
    .where(
      and(
        eq(annotationsTable.packageId, pkg.id),
        eq(annotationsTable.source, "ai"),
      ),
    );

  if (insertedViolations.length > 0) {
    const pinPositions = layoutPinPositions(insertedViolations.length);
    await db.insert(annotationsTable).values(
      insertedViolations.map((v, i) => {
        const fx = pinPositions[i]!.x;
        const fy = pinPositions[i]!.y;
        const cls = v.findingClass as
          | "issue"
          | "warning"
          | "passed"
          | "recommendation";
        return {
          packageId: pkg.id,
          versionId,
          type: "pin",
          page: v.page,
          x: fx,
          y: fy,
          // AI findings render as numbered pin markers; the model's bbox w/h is
          // a text-only guess and would draw detached boxes in PDF export, so we
          // do not persist a size for these pins.
          w: null,
          h: null,
          color: findingClassColor(cls),
          author: "AI Compliance Engine",
          authorRole: "AI",
          text: v.description ? `${v.title}: ${v.description}` : v.title,
          priority: priorityFromSeverity(v.severity),
          status: cls === "passed" ? "resolved" : "open",
          source: "ai",
          confidence: v.confidence,
          severity: v.severity,
          regulationRef: v.regulationRef,
          suggestedFix: v.suggestedText ?? v.recommendation ?? null,
          violationId: v.id,
          mentions: [],
        };
      }),
    );
  }

  // Regenerate AI review tasks for actionable findings (keep completed ones).
  await db
    .delete(reviewTasksTable)
    .where(
      and(
        eq(reviewTasksTable.packageId, pkg.id),
        eq(reviewTasksTable.source, "ai"),
        ne(reviewTasksTable.status, "done"),
      ),
    );

  const actionable = insertedViolations.filter(
    (v) =>
      (v.findingClass === "issue" || v.findingClass === "warning") &&
      (v.severity === "critical" || v.severity === "major"),
  );
  if (actionable.length > 0) {
    await db.insert(reviewTasksTable).values(
      actionable.map((v) => ({
        packageId: pkg.id,
        versionId,
        title: `Fix: ${v.title}`,
        description: v.recommendation ?? v.description,
        assignedRole: assignedRoleForFlags(v.claimFlags ?? [], v.engine),
        priority: priorityFromSeverity(v.severity),
        status: "open",
        source: "ai",
        violationId: v.id,
      })),
    );
  }

  await db.insert(auditEventsTable).values({
    organizationId,
    packageId: pkg.id,
    actor: "AI Compliance Engine",
    action: "Analysis completed",
    detail: `Grade ${result.grade}, risk ${result.riskScore}, ${result.violations.length} finding(s) detected. Status: ${result.complianceStatus}.`,
  });
}

/** Build the full package detail payload (all relations). */
export async function buildDetail(pkg: PackageRow) {
  await ensureInitialVersion(pkg);
  const [violations, regulations, versions, annotations, tasks, approvals] =
    await Promise.all([
      db
        .select()
        .from(violationsTable)
        .where(eq(violationsTable.packageId, pkg.id)),
      loadRegulations(),
      db
        .select()
        .from(packageVersionsTable)
        .where(eq(packageVersionsTable.packageId, pkg.id))
        .orderBy(asc(packageVersionsTable.versionNumber)),
      db
        .select()
        .from(annotationsTable)
        .where(eq(annotationsTable.packageId, pkg.id))
        .orderBy(asc(annotationsTable.createdAt)),
      db
        .select()
        .from(reviewTasksTable)
        .where(eq(reviewTasksTable.packageId, pkg.id))
        .orderBy(asc(reviewTasksTable.createdAt)),
      db
        .select()
        .from(approvalDecisionsTable)
        .where(eq(approvalDecisionsTable.packageId, pkg.id))
        .orderBy(asc(approvalDecisionsTable.createdAt)),
    ]);

  const annIds = annotations.map((a) => a.id);
  const replies = annIds.length
    ? await db
        .select()
        .from(commentRepliesTable)
        .where(inArray(commentRepliesTable.annotationId, annIds))
        .orderBy(asc(commentRepliesTable.createdAt))
    : [];
  const replyMap = new Map<number, CommentReplyRow[]>();
  for (const r of replies) {
    const list = replyMap.get(r.annotationId) ?? [];
    list.push(r);
    replyMap.set(r.annotationId, list);
  }

  return mapPackageDetail(
    pkg,
    violations,
    regulations,
    versions,
    annotations,
    replyMap,
    tasks,
    approvals,
  );
}
