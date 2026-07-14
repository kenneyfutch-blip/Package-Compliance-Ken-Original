import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  packagesTable,
  violationsTable,
  packageVersionsTable,
  annotationsTable,
  commentRepliesTable,
  reviewTasksTable,
  approvalDecisionsTable,
  auditEventsTable,
  reportsTable,
  reviewAssignmentsTable,
} from "@workspace/db";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import {
  CreatePackageVersionBody,
  CreateAnnotationBody,
  UpdateAnnotationBody,
  AddCommentReplyBody,
  CreateReviewTaskBody,
  UpdateReviewTaskBody,
  CreateApprovalDecisionBody,
  BulkPackageActionBody,
} from "@workspace/api-zod";
import {
  mapAnnotation,
  mapReviewTask,
} from "../lib/mappers";
import { analyzePackaging, compareVersions } from "../lib/ai";
import {
  buildDetail,
  loadRegulations,
  applyAnalysis,
  ensureInitialVersion,
  inferFileType,
  detectPageCount,
} from "../lib/packageService";
import { generateProofPdf } from "../lib/proofPdf";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "../lib/objectStorage";
import { logger } from "../lib/logger";
import { currentUser } from "../lib/identity";
import { notifyUsers } from "../lib/reviews/notify";
import {
  requirePermission,
  requireAnyPermission,
  hasPermission,
  orgId,
} from "../lib/rbac/context";
import { packageConds, canAccessPackage, canAccessObjectOwner } from "../lib/rbac/scope";
import { resolveObjectOwner } from "./storage";
import type { PackageRow } from "@workspace/db";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

// Workspace root, resolved from this module (src/lib is 3 levels below root).
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(MODULE_DIR, "..", "..", "..", "..");
const COMPLIANCE_PUBLIC = path.join(
  WORKSPACE_ROOT,
  "artifacts",
  "compliance",
  "public",
);

function reqId(raw: string | string[] | undefined): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}

// Load a package only if the caller's org/supplier scope permits it. Responds
// 404 (not 403) when missing or inaccessible so we never leak the existence of
// another tenant's package.
async function loadOwnedPackage(
  req: Request,
  res: Response,
  id: number,
): Promise<PackageRow | null> {
  const [pkg] = await db
    .select()
    .from(packagesTable)
    .where(eq(packagesTable.id, id));
  if (!pkg || !canAccessPackage(req, pkg)) {
    res.status(404).json({ error: "Package not found" });
    return null;
  }
  return pkg;
}

// Enforce package access for record-scoped mutations (annotations, replies,
// tasks) that only carry a child-record id. Returns false and responds 404 when
// the parent package is missing or outside the caller's scope.
async function assertPackageAccess(
  req: Request,
  res: Response,
  packageId: number,
): Promise<boolean> {
  const [pkg] = await db
    .select()
    .from(packagesTable)
    .where(eq(packagesTable.id, packageId));
  if (!pkg || !canAccessPackage(req, pkg)) {
    res.status(404).json({ error: "Not found" });
    return false;
  }
  return true;
}

// GET /packages/:id/versions
router.get(
  "/packages/:id/versions",
  requirePermission("proofs:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = reqId(req.params["id"]);
    const pkg = await loadOwnedPackage(req, res, id);
    if (!pkg) return;
    await ensureInitialVersion(pkg);
    const rows = await db
      .select()
      .from(packageVersionsTable)
      .where(eq(packageVersionsTable.packageId, id))
      .orderBy(asc(packageVersionsTable.versionNumber));
    const { mapPackageVersion } = await import("../lib/mappers");
    res.json(rows.map(mapPackageVersion));
  },
);

// POST /packages/:id/versions
router.post(
  "/packages/:id/versions",
  requirePermission("proofs:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = reqId(req.params["id"]);
    const parsed = CreatePackageVersionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const data = parsed.data;
    const pkg = await loadOwnedPackage(req, res, id);
    if (!pkg) return;
    // Validate every caller-supplied storage reference before it is persisted.
    // A stored fileUrl later drives hashing, proof export, and the object-serving
    // owner lookup, so it must be (a) safe-shaped — no traversal — and (b) not a
    // forged pointer to another tenant's object.
    for (const url of [data.fileUrl, data.previewUrl]) {
      const refErr = await referenceError(req, url);
      if (refErr) {
        res.status(400).json({ error: refErr });
        return;
      }
    }
    await ensureInitialVersion(pkg);
    const existing = await db
      .select()
      .from(packageVersionsTable)
      .where(eq(packageVersionsTable.packageId, id))
      .orderBy(desc(packageVersionsTable.versionNumber));
    const nextNumber = (existing[0]?.versionNumber ?? 0) + 1;
    const fileType = data.fileType ?? inferFileType(data.fileUrl);
    const versionFileUrl = data.fileUrl ?? pkg.artworkUrl;
    // Capture a content hash of the stored artwork so this version's exact bytes
    // can be integrity-verified later as compliance evidence (best-effort).
    const fileHash = await hashFileAtUrl(versionFileUrl);

    // The new version becomes current.
    await db
      .update(packageVersionsTable)
      .set({ isCurrent: false })
      .where(eq(packageVersionsTable.packageId, id));

    const [version] = await db
      .insert(packageVersionsTable)
      .values({
        packageId: id,
        versionNumber: nextNumber,
        label: data.label ?? `Version ${nextNumber}`,
        fileUrl: versionFileUrl,
        fileName: data.fileName ?? null,
        fileType,
        previewUrl: data.previewUrl ?? null,
        fileHash,
        pageCount:
          data.pageCount ??
          (await detectPageCount(data.fileUrl ?? pkg.artworkUrl, fileType)),
        extractedText: data.extractedText ?? null,
        notes: data.notes ?? null,
        isCurrent: true,
        createdBy: currentUser(req).name,
      })
      .returning();

    // Update the package's headline artwork/text to the new version.
    await db
      .update(packagesTable)
      .set({
        artworkUrl: data.fileUrl ?? pkg.artworkUrl,
        ...(data.extractedText ? { extractedText: data.extractedText } : {}),
        approvalStatus: "Pending",
      })
      .where(eq(packagesTable.id, id));

    await db.insert(auditEventsTable).values({
      packageId: id,
      actor: currentUser(req).name,
      action: "Version added",
      detail: `${version!.label} uploaded${fileType ? ` (${fileType})` : ""}.`,
    });

    const trackedOnly = fileType === "ai" || fileType === "indd";
    if (data.analyze && data.extractedText && !trackedOnly) {
      try {
        const [refreshedPkg] = await db
          .select()
          .from(packagesTable)
          .where(eq(packagesTable.id, id));
        const regulations = await loadRegulations();
        const result = await analyzePackaging(refreshedPkg!, regulations);
        await applyAnalysis(refreshedPkg!, result, version!.id);
      } catch (err) {
        logger.error({ err }, "Version analysis failed");
      }
    }

    const [finalPkg] = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.id, id));
    res.json(await buildDetail(finalPkg!));
  },
);

// GET /packages/:id/compare/:versionA/:versionB
router.get(
  "/packages/:id/compare/:versionA/:versionB",
  requirePermission("proofs:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = reqId(req.params["id"]);
    const va = reqId(req.params["versionA"]);
    const vb = reqId(req.params["versionB"]);
    const pkg = await loadOwnedPackage(req, res, id);
    if (!pkg) return;
    const versions = await db
      .select()
      .from(packageVersionsTable)
      .where(eq(packageVersionsTable.packageId, id));
    const versionA = versions.find((v) => v.id === va);
    const versionB = versions.find((v) => v.id === vb);
    if (!versionA || !versionB) {
      res.status(404).json({ error: "Version not found" });
      return;
    }
    const { mapPackageVersion } = await import("../lib/mappers");
    try {
      const result = await compareVersions(
        pkg.name,
        versionA.label ?? `Version ${versionA.versionNumber}`,
        versionA.extractedText ?? "",
        versionB.label ?? `Version ${versionB.versionNumber}`,
        versionB.extractedText ?? "",
      );
      res.json({
        packageId: id,
        summary: result.summary,
        versionA: mapPackageVersion(versionA),
        versionB: mapPackageVersion(versionB),
        changes: result.changes,
      });
    } catch (err) {
      logger.error({ err }, "Version comparison failed");
      res.status(502).json({ error: "Comparison failed. Please retry." });
    }
  },
);

// POST /packages/:id/annotations
router.post(
  "/packages/:id/annotations",
  requirePermission("proofs:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = reqId(req.params["id"]);
    const parsed = CreateAnnotationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const pkg = await loadOwnedPackage(req, res, id);
    if (!pkg) return;
    const version = await ensureInitialVersion(pkg);
    const d = parsed.data;
    const [annotation] = await db
      .insert(annotationsTable)
      .values({
        packageId: id,
        versionId: d.versionId ?? version.id,
        type: d.type,
        page: d.page ?? 0,
        x: d.x ?? null,
        y: d.y ?? null,
        w: d.w ?? null,
        h: d.h ?? null,
        color: d.color ?? null,
        author: currentUser(req).name,
        authorRole: null,
        text: d.text ?? null,
        priority: d.priority ?? "medium",
        status: "open",
        source: "human",
        mentions: d.mentions ?? [],
      })
      .returning();

    await db.insert(auditEventsTable).values({
      packageId: id,
      actor: currentUser(req).name,
      action: "Comment added",
      detail: `${d.type} annotation added${d.text ? `: ${d.text.slice(0, 80)}` : ""}.`,
    });

    res.json(mapAnnotation(annotation!, []));
  },
);

// PATCH /annotations/:id
router.patch(
  "/annotations/:id",
  requirePermission("proofs:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = reqId(req.params["id"]);
    const parsed = UpdateAnnotationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [existing] = await db
      .select()
      .from(annotationsTable)
      .where(eq(annotationsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Annotation not found" });
      return;
    }
    if (!(await assertPackageAccess(req, res, existing.packageId))) return;
    const d = parsed.data;
    const statusChangedToResolved =
      d.status === "resolved" && existing.status !== "resolved";
    await db
      .update(annotationsTable)
      .set({
        ...(d.text !== undefined ? { text: d.text } : {}),
        ...(d.priority !== undefined ? { priority: d.priority } : {}),
        ...(d.status !== undefined ? { status: d.status } : {}),
        ...(d.color !== undefined ? { color: d.color } : {}),
        ...(d.x !== undefined ? { x: d.x } : {}),
        ...(d.y !== undefined ? { y: d.y } : {}),
        ...(d.w !== undefined ? { w: d.w } : {}),
        ...(d.h !== undefined ? { h: d.h } : {}),
        ...(statusChangedToResolved
          ? { resolvedBy: currentUser(req).name, resolvedAt: new Date() }
          : {}),
        ...(d.status === "open"
          ? { resolvedBy: null, resolvedAt: null }
          : {}),
      })
      .where(eq(annotationsTable.id, id));

    if (d.status) {
      await db.insert(auditEventsTable).values({
        packageId: existing.packageId,
        actor: currentUser(req).name,
        action: d.status === "resolved" ? "Comment resolved" : "Comment reopened",
        detail: existing.text ? existing.text.slice(0, 80) : `Annotation #${id}`,
      });
    }

    const [updated] = await db
      .select()
      .from(annotationsTable)
      .where(eq(annotationsTable.id, id));
    const replies = await db
      .select()
      .from(commentRepliesTable)
      .where(eq(commentRepliesTable.annotationId, id))
      .orderBy(asc(commentRepliesTable.createdAt));
    res.json(mapAnnotation(updated!, replies));
  },
);

// DELETE /annotations/:id
router.delete(
  "/annotations/:id",
  requirePermission("proofs:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = reqId(req.params["id"]);
    const [existing] = await db
      .select()
      .from(annotationsTable)
      .where(eq(annotationsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Annotation not found" });
      return;
    }
    if (!(await assertPackageAccess(req, res, existing.packageId))) return;
    await db
      .delete(commentRepliesTable)
      .where(eq(commentRepliesTable.annotationId, id));
    await db.delete(annotationsTable).where(eq(annotationsTable.id, id));
    res.status(204).send();
  },
);

// POST /annotations/:id/replies
router.post(
  "/annotations/:id/replies",
  requirePermission("proofs:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = reqId(req.params["id"]);
    const parsed = AddCommentReplyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [annotation] = await db
      .select()
      .from(annotationsTable)
      .where(eq(annotationsTable.id, id));
    if (!annotation) {
      res.status(404).json({ error: "Annotation not found" });
      return;
    }
    if (!(await assertPackageAccess(req, res, annotation.packageId))) return;
    const d = parsed.data;
    await db.insert(commentRepliesTable).values({
      annotationId: id,
      author: currentUser(req).name,
      authorRole: null,
      text: d.text,
      source: "human",
      mentions: d.mentions ?? [],
    });
    await db.insert(auditEventsTable).values({
      packageId: annotation.packageId,
      actor: currentUser(req).name,
      action: "Reply added",
      detail: d.text.slice(0, 80),
    });
    const replies = await db
      .select()
      .from(commentRepliesTable)
      .where(eq(commentRepliesTable.annotationId, id))
      .orderBy(asc(commentRepliesTable.createdAt));
    res.json(mapAnnotation(annotation, replies));
  },
);

// POST /packages/:id/tasks
router.post(
  "/packages/:id/tasks",
  requirePermission("proofs:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = reqId(req.params["id"]);
    const parsed = CreateReviewTaskBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const pkg = await loadOwnedPackage(req, res, id);
    if (!pkg) return;
    const d = parsed.data;
    const [task] = await db
      .insert(reviewTasksTable)
      .values({
        packageId: id,
        versionId: d.versionId ?? null,
        title: d.title,
        description: d.description ?? null,
        assignedRole: d.assignedRole ?? null,
        assignee: d.assignee ?? null,
        dueDate: d.dueDate ?? null,
        priority: d.priority ?? "medium",
        status: "open",
        source: "manual",
      })
      .returning();
    await db.insert(auditEventsTable).values({
      packageId: id,
      actor: currentUser(req).name,
      action: "Task created",
      detail: d.title,
    });
    res.json(mapReviewTask(task!));
  },
);

// PATCH /tasks/:id
router.patch(
  "/tasks/:id",
  requirePermission("proofs:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = reqId(req.params["id"]);
    const parsed = UpdateReviewTaskBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [existing] = await db
      .select()
      .from(reviewTasksTable)
      .where(eq(reviewTasksTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (!(await assertPackageAccess(req, res, existing.packageId))) return;
    const d = parsed.data;
    await db
      .update(reviewTasksTable)
      .set({
        ...(d.title !== undefined ? { title: d.title } : {}),
        ...(d.description !== undefined ? { description: d.description } : {}),
        ...(d.assignedRole !== undefined
          ? { assignedRole: d.assignedRole }
          : {}),
        ...(d.assignee !== undefined ? { assignee: d.assignee } : {}),
        ...(d.dueDate !== undefined ? { dueDate: d.dueDate } : {}),
        ...(d.priority !== undefined ? { priority: d.priority } : {}),
        ...(d.status !== undefined ? { status: d.status } : {}),
      })
      .where(eq(reviewTasksTable.id, id));
    if (d.status) {
      await db.insert(auditEventsTable).values({
        packageId: existing.packageId,
        actor: currentUser(req).name,
        action: `Task ${d.status}`,
        detail: existing.title,
      });
    }
    const [updated] = await db
      .select()
      .from(reviewTasksTable)
      .where(eq(reviewTasksTable.id, id));
    res.json(mapReviewTask(updated!));
  },
);

const DECISION_MAP: Record<string, { approval: string; status: string; label: string }> = {
  approve: { approval: "Approved", status: "Approved", label: "Approved" },
  approve_with_comments: {
    approval: "Approved with Comments",
    status: "Approved",
    label: "Approved with comments",
  },
  needs_revision: {
    approval: "Needs Revision",
    status: "Needs Revision",
    label: "Needs revision",
  },
  reject: { approval: "Rejected", status: "Rejected", label: "Rejected" },
  escalate: { approval: "Escalated", status: "Escalated", label: "Escalated" },
  reset: { approval: "Pending", status: "Needs Review", label: "Reset to pending" },
};

// POST /packages/:id/approvals
router.post(
  "/packages/:id/approvals",
  requirePermission("proofs:decide"),
  async (req: Request, res: Response): Promise<void> => {
    const id = reqId(req.params["id"]);
    const parsed = CreateApprovalDecisionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const pkg = await loadOwnedPackage(req, res, id);
    if (!pkg) return;
    const d = parsed.data;
    const mapping = DECISION_MAP[d.decision];
    if (!mapping) {
      res.status(400).json({ error: "Invalid decision" });
      return;
    }
    const actor = currentUser(req).name;
    await db.insert(approvalDecisionsTable).values({
      packageId: id,
      versionId: d.versionId ?? null,
      decision: d.decision,
      reviewer: actor,
      reviewerRole: null,
      note: d.note ?? null,
    });
    await db
      .update(packagesTable)
      .set({
        approvalStatus: mapping.approval,
        status: mapping.status,
        reviewer: actor,
      })
      .where(eq(packagesTable.id, id));
    await db.insert(auditEventsTable).values({
      packageId: id,
      actor,
      action: `Decision: ${mapping.label}`,
      detail: d.note ?? `${pkg.name} marked ${mapping.label}.`,
    });
    const [updated] = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.id, id));

    // Escalating a decision requires manager sign-off. Notify the responsible
    // manager (falling back to the assignee) so approval isn't left waiting.
    // Best-effort and non-fatal — must never roll back the decision.
    if (d.decision === "escalate") {
      try {
        const [assignment] = await db
          .select({
            managerUserId: reviewAssignmentsTable.managerUserId,
            assigneeUserId: reviewAssignmentsTable.assigneeUserId,
          })
          .from(reviewAssignmentsTable)
          .where(eq(reviewAssignmentsTable.packageId, id));
        await notifyUsers({
          organizationId: orgId(req),
          userIds: [assignment?.managerUserId, assignment?.assigneeUserId],
          packageId: id,
          title: "Approval required",
          message: `${actor} escalated "${pkg.name}" for manager approval.${d.note ? ` Note: ${d.note}` : ""}`,
          type: "warning",
        });
      } catch (err) {
        logger.warn({ err, packageId: id }, "Failed to emit approval-required notification");
      }
    }

    res.json(await buildDetail(updated!));
  },
);

async function loadArtworkBytes(
  artworkUrl: string | null,
): Promise<{ bytes: Uint8Array; type: "png" | "jpg" } | null> {
  if (!artworkUrl) return null;
  const type: "png" | "jpg" | null =
    inferFileType(artworkUrl) === "jpg"
      ? "jpg"
      : inferFileType(artworkUrl) === "png"
        ? "png"
        : null;
  if (!type) return null;
  try {
    if (artworkUrl.startsWith("/objects/")) {
      const file = await objectStorage.getObjectEntityFile(artworkUrl);
      const response = await objectStorage.downloadObject(file);
      const buf = new Uint8Array(await response.arrayBuffer());
      return { bytes: buf, type };
    }
    // Seed artwork lives in the compliance app's public directory.
    const rel = artworkUrl.replace(/^\//, "");
    const filePath = path.join(COMPLIANCE_PUBLIC, rel);
    const bytes = await readFile(filePath);
    return { bytes: new Uint8Array(bytes), type };
  } catch (err) {
    logger.warn({ err, artworkUrl }, "Could not load artwork for proof export");
    return null;
  }
}

// A stored artwork reference is only ever an object-storage path (/objects/...)
// or a seed asset under the compliance app's public /artwork/ dir. Reject
// anything else — absolute filesystem paths, scheme URLs, backslashes, or any
// "../" traversal — so a caller-supplied fileUrl can never point hashing or
// serving at an arbitrary file. Enforced at write time (version create) and
// re-checked before any byte read.
export function isSafeStoredFileUrl(url: string): boolean {
  if (url.includes("..") || url.includes("\\") || url.includes("\0")) {
    return false;
  }
  return /^\/objects\/[A-Za-z0-9._\-/]+$/.test(url) ||
    /^\/artwork\/[A-Za-z0-9._\-/]+$/.test(url);
}

// Load the raw bytes behind a stored, already-shape-validated file reference —
// an object-storage path or a seed file under the compliance public dir.
// Returns null when unavailable. Only used for best-effort content hashing;
// private downloads go through /storage/objects/* which enforces owner ACL.
async function loadFileBytes(url: string | null): Promise<Uint8Array | null> {
  if (!url || !isSafeStoredFileUrl(url)) return null;
  try {
    if (url.startsWith("/objects/")) {
      const file = await objectStorage.getObjectEntityFile(url);
      const response = await objectStorage.downloadObject(file);
      return new Uint8Array(await response.arrayBuffer());
    }
    // Seed artwork under /artwork/. Canonicalize and fail closed if the
    // resolved path escapes the public directory (defense in depth).
    const filePath = path.resolve(COMPLIANCE_PUBLIC, url.replace(/^\//, ""));
    if (filePath !== COMPLIANCE_PUBLIC && !filePath.startsWith(COMPLIANCE_PUBLIC + path.sep)) {
      return null;
    }
    const bytes = await readFile(filePath);
    return new Uint8Array(bytes);
  } catch (err) {
    logger.warn({ err, url }, "Could not load file bytes");
    return null;
  }
}

// Authorize a caller-supplied storage reference at write time. Returns an error
// string to reject with, or null when the reference is safe to persist. Rejects
// unsafe-shaped URLs and object paths that already belong to a record outside
// the caller's org/supplier scope (prevents binding another tenant's object).
async function referenceError(
  req: Request,
  url: string | null | undefined,
): Promise<string | null> {
  if (!url) return null;
  if (!isSafeStoredFileUrl(url)) return "Invalid file reference.";
  if (url.startsWith("/objects/")) {
    const owner = await resolveObjectOwner(url);
    if (owner && !canAccessObjectOwner(req, owner)) {
      return "Invalid file reference.";
    }
  }
  return null;
}

// Best-effort SHA-256 (hex) of the file behind a stored reference. Never throws:
// hashing is evidence-capture, not a gate on the upload succeeding.
async function hashFileAtUrl(url: string | null): Promise<string | null> {
  const bytes = await loadFileBytes(url);
  if (!bytes) return null;
  return createHash("sha256").update(bytes).digest("hex");
}

// POST /packages/:id/versions/:versionId/restore
// Restore a previous version by appending a NEW version that copies the chosen
// version's artwork and metadata, then marking it current. Append-only: no
// historical row is ever mutated or deleted.
router.post(
  "/packages/:id/versions/:versionId/restore",
  requirePermission("proofs:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = reqId(req.params["id"]);
    const versionId = reqId(req.params["versionId"]);
    const pkg = await loadOwnedPackage(req, res, id);
    if (!pkg) return;
    const rows = await db
      .select()
      .from(packageVersionsTable)
      .where(eq(packageVersionsTable.packageId, id))
      .orderBy(desc(packageVersionsTable.versionNumber));
    const target = rows.find((v) => v.id === versionId);
    if (!target) {
      res.status(404).json({ error: "Version not found" });
      return;
    }
    if (target.isCurrent) {
      res
        .status(400)
        .json({ error: "That version is already the current version." });
      return;
    }
    const nextNumber = (rows[0]?.versionNumber ?? 0) + 1;

    await db
      .update(packageVersionsTable)
      .set({ isCurrent: false })
      .where(eq(packageVersionsTable.packageId, id));

    const [version] = await db
      .insert(packageVersionsTable)
      .values({
        packageId: id,
        versionNumber: nextNumber,
        label: `Restore of V${target.versionNumber}`,
        fileUrl: target.fileUrl,
        fileName: target.fileName,
        fileType: target.fileType,
        previewUrl: target.previewUrl,
        fileHash: target.fileHash,
        pageCount: target.pageCount,
        extractedText: target.extractedText,
        notes: `Restored from Version ${target.versionNumber}`,
        isCurrent: true,
        createdBy: currentUser(req).name,
      })
      .returning();

    await db
      .update(packagesTable)
      .set({
        artworkUrl: target.fileUrl ?? pkg.artworkUrl,
        ...(target.extractedText
          ? { extractedText: target.extractedText }
          : {}),
        approvalStatus: "Pending",
      })
      .where(eq(packagesTable.id, id));

    await db.insert(auditEventsTable).values({
      packageId: id,
      actor: currentUser(req).name,
      action: "Version restored",
      detail: `Version ${target.versionNumber} restored as ${version!.label} (V${nextNumber}).`,
    });

    const [finalPkg] = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.id, id));
    res.json(await buildDetail(finalPkg!));
  },
);

// POST /packages/:id/proof-export
router.post(
  "/packages/:id/proof-export",
  requirePermission("proofs:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = reqId(req.params["id"]);
    const pkg = await loadOwnedPackage(req, res, id);
    if (!pkg) return;
    try {
      const detail = await buildDetail(pkg);
      const artwork = await loadArtworkBytes(pkg.artworkUrl);
      const pdfBytes = await generateProofPdf({
        pkg: {
          name: pkg.name,
          sku: pkg.sku,
          brand: pkg.brand,
          grade: pkg.grade,
          riskScore: pkg.riskScore,
          complianceStatus: pkg.complianceStatus,
          approvalStatus: pkg.approvalStatus,
          summary: pkg.summary,
        },
        artwork,
        annotations: detail.annotations.map((a) => ({
          x: a.x,
          y: a.y,
          w: a.w,
          h: a.h,
          color: a.color,
          text: a.text,
          source: a.source,
          priority: a.priority,
          status: a.status,
          author: a.author,
          severity: a.severity,
          confidence: a.confidence,
          regulationRef: a.regulationRef,
          suggestedFix: a.suggestedFix,
        })),
        violations: detail.violations.map((v) => ({
          title: v.title,
          description: v.description,
          severity: v.severity,
          findingClass: v.findingClass,
          engine: v.engine,
          regulationRef: v.regulationRef,
          recommendation: v.recommendation,
          suggestedText: v.suggestedText,
          detectedText: v.detectedText,
          claimFlags: v.claimFlags,
          confidence: v.confidence,
        })),
        scorecard: detail.scorecard,
      });

      const uploadURL = await objectStorage.getObjectEntityUploadURL();
      const putResponse = await fetch(uploadURL, {
        method: "PUT",
        body: Buffer.from(pdfBytes),
        headers: { "Content-Type": "application/pdf" },
      });
      if (!putResponse.ok) {
        throw new Error(`Upload failed: ${putResponse.status}`);
      }
      const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
      const serveUrl = `/api/storage/objects/${objectPath.replace(/^\/objects\//, "")}`;
      const filename = `proof-${pkg.sku}-v${detail.currentVersionId ?? 1}.pdf`;

      await db.insert(reportsTable).values({
        organizationId: pkg.organizationId,
        packageId: id,
        title: `Annotated Proof - ${pkg.name}`,
        type: "Proof",
        format: "PDF",
        // Persist the object path so the download route can map this exported
        // PDF back to its owning package and enforce the same access scope.
        objectPath,
        summary: `Annotated proof with ${detail.violations.length} finding(s) and ${detail.annotations.filter((a) => a.source === "human").length} reviewer comment(s).`,
      });
      await db.insert(auditEventsTable).values({
        packageId: id,
        actor: currentUser(req).name,
        action: "Proof exported",
        detail: `Annotated proof PDF generated (${filename}).`,
      });

      res.json({ url: serveUrl, filename });
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Artwork not found" });
        return;
      }
      logger.error({ err }, "Proof export failed");
      res.status(502).json({ error: "Proof export failed. Please retry." });
    }
  },
);

// POST /packages/bulk-action
router.post(
  "/packages/bulk-action",
  requireAnyPermission(
    "proofs:read",
    "proofs:write",
    "proofs:decide",
    "packages:analyze",
  ),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = BulkPackageActionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { ids, action, assignee } = parsed.data;
    if (!ids.length) {
      res.json({ updated: 0, action });
      return;
    }

    // Each bulk action requires the same permission as its single-record
    // equivalent; reject up front if the caller lacks it.
    const requiredPerm =
      action === "approve" || action === "reject"
        ? "proofs:decide"
        : action === "assign"
          ? "proofs:write"
          : action === "rescan"
            ? "packages:analyze"
            : action === "export"
              ? "proofs:read"
              : null;
    if (requiredPerm === null) {
      res.status(400).json({ error: "Unsupported action" });
      return;
    }
    if (!hasPermission(req, requiredPerm)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Scope the target set to packages the caller may access, so a bulk action
    // can never reach another org's or supplier's packages even if their ids
    // are supplied.
    const rows = await db
      .select()
      .from(packagesTable)
      .where(and(inArray(packagesTable.id, ids), ...packageConds(req)));

    let updated = 0;
    const who = currentUser(req).name;

    if (action === "approve" || action === "reject") {
      const mapping =
        action === "approve" ? DECISION_MAP.approve! : DECISION_MAP.reject!;
      for (const pkg of rows) {
        await db.insert(approvalDecisionsTable).values({
          packageId: pkg.id,
          decision: action,
          reviewer: who,
          note: `Bulk ${mapping.label.toLowerCase()}.`,
        });
        await db
          .update(packagesTable)
          .set({
            approvalStatus: mapping.approval,
            status: mapping.status,
            reviewer: who,
          })
          .where(eq(packagesTable.id, pkg.id));
        await db.insert(auditEventsTable).values({
          packageId: pkg.id,
          actor: who,
          action: `Decision: ${mapping.label}`,
          detail: `Bulk action applied to ${pkg.name}.`,
        });
        updated += 1;
      }
    } else if (action === "assign") {
      // The assignment target is a legitimate client choice; the acting user
      // (audit actor) is still the authenticated session user.
      const target = assignee ?? who;
      for (const pkg of rows) {
        await db
          .update(packagesTable)
          .set({ reviewer: target })
          .where(eq(packagesTable.id, pkg.id));
        await db.insert(auditEventsTable).values({
          packageId: pkg.id,
          actor: who,
          action: "Reviewer assigned",
          detail: `${pkg.name} assigned to ${target}.`,
        });
        updated += 1;
      }
    } else if (action === "rescan") {
      const regulations = await loadRegulations();
      for (const pkg of rows) {
        try {
          const version = await ensureInitialVersion(pkg);
          const result = await analyzePackaging(pkg, regulations);
          await applyAnalysis(pkg, result, version.id);
          updated += 1;
        } catch (err) {
          logger.error({ err, packageId: pkg.id }, "Bulk rescan item failed");
        }
      }
    } else if (action === "export") {
      for (const pkg of rows) {
        const [violationRows] = await Promise.all([
          db
            .select()
            .from(violationsTable)
            .where(eq(violationsTable.packageId, pkg.id)),
        ]);
        await db.insert(reportsTable).values({
          packageId: pkg.id,
          title: `Compliance Report - ${pkg.name}`,
          type: "Compliance",
          format: "PDF",
          summary:
            pkg.summary ??
            `Report for ${pkg.name} with ${violationRows.length} finding(s).`,
        });
        await db.insert(auditEventsTable).values({
          packageId: pkg.id,
          actor: who,
          action: "Report generated",
          detail: `Bulk export for ${pkg.name}.`,
        });
        updated += 1;
      }
    } else {
      res.status(400).json({ error: "Unsupported action" });
      return;
    }

    res.json({ updated, action });
  },
);

export default router;
