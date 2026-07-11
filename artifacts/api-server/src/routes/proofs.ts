import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  packagesTable,
  proofsTable,
  proofAnnotationsTable,
  proofCommentsTable,
  proofDecisionsTable,
  type PackageRow,
  type ProofRow,
  type ProofAnnotationRow,
  type ProofCommentRow,
  type ProofDecisionRow,
} from "@workspace/db";
import { eq, and, asc, desc, max } from "drizzle-orm";
import {
  CreateProofBody,
  CreateAnnotationBody,
  UpdateAnnotationBody,
  CreateCommentBody,
  RecordProofDecisionBody,
} from "@workspace/api-zod";
import { requirePermission, orgId } from "../lib/rbac/context";
import { canAccessPackage } from "../lib/rbac/scope";
import { writeAudit } from "../lib/audit";

const router: IRouter = Router();

type AuthedRequest = Request & { userId?: string; userEmail?: string | null };

// Identity is derived strictly from the authenticated Clerk session, never from
// the request body, so actors cannot be spoofed in the audit trail.
function authorName(req: Request): string {
  const email = (req as AuthedRequest).userEmail ?? null;
  if (email) {
    const local = email.slice(0, email.lastIndexOf("@"));
    if (local) return local;
  }
  return "Reviewer";
}

function authorId(req: Request): string | null {
  return (req as AuthedRequest).userId ?? null;
}

function requireIntParam(
  raw: string | string[] | undefined,
  res: Response,
): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  return id;
}

// Loads a package only if the caller's organization (and supplier scope) allows
// it; otherwise responds 404 and returns null.
async function accessiblePackage(
  req: Request,
  res: Response,
  packageId: number,
): Promise<PackageRow | null> {
  const [pkg] = await db
    .select()
    .from(packagesTable)
    .where(eq(packagesTable.id, packageId));
  if (!pkg || !canAccessPackage(req, pkg)) {
    res.status(404).json({ error: "Package not found" });
    return null;
  }
  return pkg;
}

// Loads a proof only if its package is accessible to the caller.
async function accessibleProof(
  req: Request,
  res: Response,
  proofId: number,
): Promise<ProofRow | null> {
  const [proof] = await db
    .select()
    .from(proofsTable)
    .where(eq(proofsTable.id, proofId));
  if (!proof) {
    res.status(404).json({ error: "Proof not found" });
    return null;
  }
  const [pkg] = await db
    .select()
    .from(packagesTable)
    .where(eq(packagesTable.id, proof.packageId));
  if (!pkg || !canAccessPackage(req, pkg)) {
    res.status(404).json({ error: "Proof not found" });
    return null;
  }
  return proof;
}

function mapComment(row: ProofCommentRow) {
  return {
    id: row.id,
    proofId: row.proofId,
    annotationId: row.annotationId,
    body: row.body,
    authorName: row.authorName,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapAnnotation(
  row: ProofAnnotationRow,
  comments: ProofCommentRow[],
) {
  return {
    id: row.id,
    proofId: row.proofId,
    page: row.page,
    kind: row.kind,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    color: row.color,
    resolved: row.resolved,
    authorName: row.authorName,
    createdAt: row.createdAt.toISOString(),
    comments: comments
      .filter((c) => c.annotationId === row.id)
      .map(mapComment),
  };
}

function mapDecision(row: ProofDecisionRow) {
  return {
    id: row.id,
    proofId: row.proofId,
    decision: row.decision,
    note: row.note,
    reviewerName: row.reviewerName,
    createdAt: row.createdAt.toISOString(),
  };
}

function proofSummary(
  proof: ProofRow,
  annotations: ProofAnnotationRow[],
  comments: ProofCommentRow[],
) {
  const openCount = annotations.filter((a) => !a.resolved).length;
  return {
    id: proof.id,
    packageId: proof.packageId,
    version: proof.version,
    fileName: proof.fileName,
    objectPath: proof.objectPath,
    contentType: proof.contentType,
    fileSize: proof.fileSize,
    pageCount: proof.pageCount,
    status: proof.status,
    uploadedByName: proof.uploadedByName,
    createdAt: proof.createdAt.toISOString(),
    annotationCount: annotations.length,
    openCount,
    resolvedCount: annotations.length - openCount,
    commentCount: comments.length,
  };
}

async function loadProofDetail(proofId: number) {
  const [proof] = await db
    .select()
    .from(proofsTable)
    .where(eq(proofsTable.id, proofId));
  if (!proof) return null;

  const [annotations, comments, decisions] = await Promise.all([
    db
      .select()
      .from(proofAnnotationsTable)
      .where(eq(proofAnnotationsTable.proofId, proofId))
      .orderBy(asc(proofAnnotationsTable.createdAt)),
    db
      .select()
      .from(proofCommentsTable)
      .where(eq(proofCommentsTable.proofId, proofId))
      .orderBy(asc(proofCommentsTable.createdAt)),
    db
      .select()
      .from(proofDecisionsTable)
      .where(eq(proofDecisionsTable.proofId, proofId))
      .orderBy(desc(proofDecisionsTable.createdAt)),
  ]);

  return {
    ...proofSummary(proof, annotations, comments),
    annotations: annotations.map((a) => mapAnnotation(a, comments)),
    generalComments: comments
      .filter((c) => c.annotationId === null)
      .map(mapComment),
    decisions: decisions.map(mapDecision),
  };
}

// GET /packages/:id/proofs
router.get(
  "/packages/:id/proofs",
  requirePermission("proofs:read"),
  async (req: Request, res: Response): Promise<void> => {
    const packageId = requireIntParam(req.params["id"], res);
    if (packageId === null) return;
    if (!(await accessiblePackage(req, res, packageId))) return;

    const proofs = await db
      .select()
      .from(proofsTable)
      .where(eq(proofsTable.packageId, packageId))
      .orderBy(desc(proofsTable.version));

    const [annotations, comments] = await Promise.all([
      db
        .select()
        .from(proofAnnotationsTable)
        .innerJoin(
          proofsTable,
          eq(proofAnnotationsTable.proofId, proofsTable.id),
        )
        .where(eq(proofsTable.packageId, packageId)),
      db
        .select()
        .from(proofCommentsTable)
        .innerJoin(proofsTable, eq(proofCommentsTable.proofId, proofsTable.id))
        .where(eq(proofsTable.packageId, packageId)),
    ]);

    const annByProof = new Map<number, ProofAnnotationRow[]>();
    for (const row of annotations) {
      const a = row.proof_annotations;
      const list = annByProof.get(a.proofId) ?? [];
      list.push(a);
      annByProof.set(a.proofId, list);
    }
    const comByProof = new Map<number, ProofCommentRow[]>();
    for (const row of comments) {
      const c = row.proof_comments;
      const list = comByProof.get(c.proofId) ?? [];
      list.push(c);
      comByProof.set(c.proofId, list);
    }

    res.json(
      proofs.map((p) =>
        proofSummary(p, annByProof.get(p.id) ?? [], comByProof.get(p.id) ?? []),
      ),
    );
  },
);

// POST /packages/:id/proofs
router.post(
  "/packages/:id/proofs",
  requirePermission("proofs:write"),
  async (req: Request, res: Response): Promise<void> => {
    const packageId = requireIntParam(req.params["id"], res);
    if (packageId === null) return;

    const parsed = CreateProofBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const data = parsed.data;

    // Only allow linking objects from the private uploads namespace that this
    // server mints presigned URLs for — never an arbitrary client-supplied path.
    if (!data.objectPath.startsWith("/objects/")) {
      res.status(400).json({ error: "Invalid object path" });
      return;
    }

    if (!(await accessiblePackage(req, res, packageId))) return;

    // Compute the next version and insert; retry on the (package_id, version)
    // unique conflict that a concurrent upload can trigger.
    let inserted: ProofRow | undefined;
    let nextVersion = 1;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const [{ value: currentMax } = { value: 0 }] = await db
        .select({ value: max(proofsTable.version) })
        .from(proofsTable)
        .where(eq(proofsTable.packageId, packageId));
      nextVersion = (currentMax ?? 0) + 1;

      try {
        [inserted] = await db
          .insert(proofsTable)
          .values({
            organizationId: orgId(req),
            packageId,
            version: nextVersion,
            fileName: data.fileName,
            objectPath: data.objectPath,
            contentType: data.contentType,
            fileSize: data.fileSize ?? 0,
            pageCount: data.pageCount ?? 1,
            status: "In Review",
            uploadedById: authorId(req),
            uploadedByName: authorName(req),
          })
          .returning();
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === "23505" && attempt < 4) continue; // unique_violation: retry
        throw err;
      }
    }

    if (!inserted) {
      res.status(500).json({ error: "Failed to create proof" });
      return;
    }

    await writeAudit(req, {
      action: "Proof uploaded",
      entityType: "proof",
      entityId: inserted.id,
      packageId,
      detail: `${data.fileName} uploaded as version ${nextVersion}.`,
    });

    const detail = await loadProofDetail(inserted.id);
    res.status(201).json(detail);
  },
);

// GET /proofs/:proofId
router.get(
  "/proofs/:proofId",
  requirePermission("proofs:read"),
  async (req: Request, res: Response): Promise<void> => {
    const proofId = requireIntParam(req.params["proofId"], res);
    if (proofId === null) return;
    if (!(await accessibleProof(req, res, proofId))) return;
    const detail = await loadProofDetail(proofId);
    res.json(detail);
  },
);

// POST /proofs/:proofId/annotations
router.post(
  "/proofs/:proofId/annotations",
  requirePermission("proofs:write"),
  async (req: Request, res: Response): Promise<void> => {
    const proofId = requireIntParam(req.params["proofId"], res);
    if (proofId === null) return;

    const parsed = CreateAnnotationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const data = parsed.data;

    if (!(await accessibleProof(req, res, proofId))) return;

    const [annotation] = await db
      .insert(proofAnnotationsTable)
      .values({
        proofId,
        page: data.page ?? 1,
        kind: data.kind,
        x: data.x,
        y: data.y,
        w: data.w ?? 0,
        h: data.h ?? 0,
        color: data.color ?? "#1F47FF",
        authorId: authorId(req),
        authorName: authorName(req),
      })
      .returning();

    if (!annotation) {
      res.status(500).json({ error: "Failed to create annotation" });
      return;
    }

    const comments: ProofCommentRow[] = [];
    if (data.body && data.body.trim()) {
      const [comment] = await db
        .insert(proofCommentsTable)
        .values({
          proofId,
          annotationId: annotation.id,
          body: data.body.trim(),
          authorId: authorId(req),
          authorName: authorName(req),
        })
        .returning();
      if (comment) comments.push(comment);
    }

    res.status(201).json(mapAnnotation(annotation, comments));
  },
);

// PATCH /annotations/:annotationId
router.patch(
  "/annotations/:annotationId",
  requirePermission("proofs:write"),
  async (req: Request, res: Response): Promise<void> => {
    const annotationId = requireIntParam(req.params["annotationId"], res);
    if (annotationId === null) return;

    const parsed = UpdateAnnotationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [existing] = await db
      .select()
      .from(proofAnnotationsTable)
      .where(eq(proofAnnotationsTable.id, annotationId));
    if (!existing) {
      res.status(404).json({ error: "Annotation not found" });
      return;
    }
    if (!(await accessibleProof(req, res, existing.proofId))) return;

    const [updated] = await db
      .update(proofAnnotationsTable)
      .set({
        ...(parsed.data.resolved !== undefined
          ? { resolved: parsed.data.resolved }
          : {}),
      })
      .where(eq(proofAnnotationsTable.id, annotationId))
      .returning();

    const comments = await db
      .select()
      .from(proofCommentsTable)
      .where(eq(proofCommentsTable.annotationId, annotationId))
      .orderBy(asc(proofCommentsTable.createdAt));

    res.json(mapAnnotation(updated!, comments));
  },
);

// DELETE /annotations/:annotationId
router.delete(
  "/annotations/:annotationId",
  requirePermission("proofs:write"),
  async (req: Request, res: Response): Promise<void> => {
    const annotationId = requireIntParam(req.params["annotationId"], res);
    if (annotationId === null) return;
    const [existing] = await db
      .select()
      .from(proofAnnotationsTable)
      .where(eq(proofAnnotationsTable.id, annotationId));
    if (!existing) {
      res.status(404).json({ error: "Annotation not found" });
      return;
    }
    if (!(await accessibleProof(req, res, existing.proofId))) return;
    await db
      .delete(proofAnnotationsTable)
      .where(eq(proofAnnotationsTable.id, annotationId));
    res.status(204).send();
  },
);

// POST /proofs/:proofId/comments
router.post(
  "/proofs/:proofId/comments",
  requirePermission("proofs:write"),
  async (req: Request, res: Response): Promise<void> => {
    const proofId = requireIntParam(req.params["proofId"], res);
    if (proofId === null) return;

    const parsed = CreateCommentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const data = parsed.data;

    if (!(await accessibleProof(req, res, proofId))) return;

    if (data.annotationId !== undefined && data.annotationId !== null) {
      const [ann] = await db
        .select()
        .from(proofAnnotationsTable)
        .where(
          and(
            eq(proofAnnotationsTable.id, data.annotationId),
            eq(proofAnnotationsTable.proofId, proofId),
          ),
        );
      if (!ann) {
        res.status(404).json({ error: "Annotation not found" });
        return;
      }
    }

    const [comment] = await db
      .insert(proofCommentsTable)
      .values({
        proofId,
        annotationId: data.annotationId ?? null,
        body: data.body.trim(),
        authorId: authorId(req),
        authorName: authorName(req),
      })
      .returning();

    res.status(201).json(mapComment(comment!));
  },
);

// POST /proofs/:proofId/decision
router.post(
  "/proofs/:proofId/decision",
  requirePermission("proofs:decide"),
  async (req: Request, res: Response): Promise<void> => {
    const proofId = requireIntParam(req.params["proofId"], res);
    if (proofId === null) return;

    const parsed = RecordProofDecisionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const data = parsed.data;

    const decisionMap: Record<string, string> = {
      approved: "Approved",
      changes_requested: "Changes Requested",
      rejected: "Rejected",
    };
    const proofStatus = decisionMap[data.decision];
    if (!proofStatus) {
      res.status(400).json({ error: "Invalid decision" });
      return;
    }

    const proof = await accessibleProof(req, res, proofId);
    if (!proof) return;

    const reviewer = authorName(req);

    await db.insert(proofDecisionsTable).values({
      proofId,
      decision: data.decision,
      note: data.note ?? null,
      reviewerId: authorId(req),
      reviewerName: reviewer,
    });

    await db
      .update(proofsTable)
      .set({ status: proofStatus })
      .where(eq(proofsTable.id, proofId));

    if (data.applyToPackage) {
      const packageStatus =
        data.decision === "approved" ? "Approved" : "Needs Revision";
      await db
        .update(packagesTable)
        .set({ status: packageStatus, reviewer })
        .where(eq(packagesTable.id, proof.packageId));
    }

    await writeAudit(req, {
      action: `Proof ${proofStatus.toLowerCase()}`,
      entityType: "proof",
      entityId: proofId,
      packageId: proof.packageId,
      detail:
        `Version ${proof.version}: ${proofStatus}` +
        (data.note ? ` — ${data.note}` : "") +
        (data.applyToPackage ? " (applied to package)" : ""),
    });

    const detail = await loadProofDetail(proofId);
    res.json(detail);
  },
);

export default router;
