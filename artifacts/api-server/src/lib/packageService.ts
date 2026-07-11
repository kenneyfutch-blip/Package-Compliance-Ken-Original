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
    let spread = 0;
    await db.insert(annotationsTable).values(
      insertedViolations.map((v) => {
        const hasBbox = v.bboxX !== null && v.bboxY !== null;
        // Fallback layout for findings the model did not localize.
        const fx = hasBbox ? v.bboxX! : 0.08 + (spread % 3) * 0.3;
        const fy = hasBbox ? v.bboxY! : 0.12 + Math.floor(spread / 3) * 0.18;
        if (!hasBbox) spread += 1;
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
          w: v.bboxW ?? null,
          h: v.bboxH ?? null,
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
