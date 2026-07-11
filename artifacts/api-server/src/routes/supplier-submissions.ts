import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  suppliersTable,
  supplierSubmissionsTable,
  packagesTable,
} from "@workspace/db";
import { eq, and, desc, inArray, type SQL } from "drizzle-orm";
import { mapSupplierSubmission } from "../lib/mappers";
import { requirePermission, orgId, getAuthContext } from "../lib/rbac/context";
import { writeAudit } from "../lib/audit";

const router: IRouter = Router();

const SUBMISSION_STATUSES = [
  "Submitted",
  "UnderReview",
  "ChangesRequested",
  "Approved",
  "Rejected",
];
// Statuses an internal reviewer may transition a submission into.
const REVIEW_DECISIONS = ["UnderReview", "ChangesRequested", "Approved", "Rejected"];

function parseId(raw: string | string[] | undefined): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}
function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

// Scoping for submission reads: whole org for internal roles, own supplier only
// for a supplier_user.
function submissionConds(req: Request): SQL[] {
  const ctx = getAuthContext(req);
  const conds: SQL[] = [eq(supplierSubmissionsTable.organizationId, ctx.organizationId)];
  if (ctx.roleKey === "supplier_user") {
    conds.push(eq(supplierSubmissionsTable.supplierId, ctx.supplierId ?? -1));
  }
  return conds;
}

// GET /supplier-submissions — submission queue. Supplier users see only their
// own; internal roles see the whole org and can filter.
router.get(
  "/supplier-submissions",
  requirePermission("submissions:read"),
  async (req: Request, res: Response): Promise<void> => {
    const conds = submissionConds(req);
    const status = str(req.query["status"]);
    if (status && SUBMISSION_STATUSES.includes(status)) {
      conds.push(eq(supplierSubmissionsTable.status, status));
    }
    const supplierIdRaw = req.query["supplierId"];
    if (supplierIdRaw !== undefined && getAuthContext(req).roleKey !== "supplier_user") {
      const sid = Number(supplierIdRaw);
      if (Number.isFinite(sid)) conds.push(eq(supplierSubmissionsTable.supplierId, sid));
    }

    const rows = await db
      .select()
      .from(supplierSubmissionsTable)
      .where(and(...conds))
      .orderBy(desc(supplierSubmissionsTable.createdAt))
      .limit(300);

    // Resolve supplier names in a single batched query (no N+1).
    const supplierIds = [...new Set(rows.map((r) => r.supplierId))];
    const nameById = new Map<number, string>();
    if (supplierIds.length) {
      const suppliers = await db
        .select({ id: suppliersTable.id, name: suppliersTable.name })
        .from(suppliersTable)
        .where(
          and(
            inArray(suppliersTable.id, supplierIds),
            eq(suppliersTable.organizationId, orgId(req)),
          ),
        );
      for (const s of suppliers) nameById.set(s.id, s.name);
    }

    res.json(
      rows.map((r) =>
        mapSupplierSubmission(r, { supplierName: nameById.get(r.supplierId) ?? null }),
      ),
    );
  },
);

// POST /supplier-submissions — a supplier submits packaging for review. Supplier
// users are hard-bound to their own supplier id; internal roles may submit on
// behalf of any supplier in their org. Creates a linked package that flows into
// the normal compliance pipeline.
router.post(
  "/supplier-submissions",
  requirePermission("submissions:write"),
  async (req: Request, res: Response): Promise<void> => {
    const ctx = getAuthContext(req);
    const title = str(req.body?.title);
    if (!title) {
      res.status(400).json({ error: "A submission title is required" });
      return;
    }

    // Determine the target supplier with strict scoping.
    let supplierId: number;
    if (ctx.roleKey === "supplier_user") {
      if (ctx.supplierId == null) {
        res.status(403).json({ error: "Your account is not linked to a supplier" });
        return;
      }
      supplierId = ctx.supplierId;
    } else {
      const sid = Number(req.body?.supplierId);
      if (!Number.isFinite(sid)) {
        res.status(400).json({ error: "supplierId is required" });
        return;
      }
      supplierId = sid;
    }

    // Verify the supplier exists in the caller's org (and matches supplier_user's).
    const [supplier] = await db
      .select()
      .from(suppliersTable)
      .where(and(eq(suppliersTable.id, supplierId), eq(suppliersTable.organizationId, ctx.organizationId)));
    if (!supplier) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }

    const category = str(req.body?.category);
    const notes = str(req.body?.notes);
    const artworkUrl = str(req.body?.artworkUrl);

    // Spawn a package so the submission enters the standard review pipeline.
    // Both inserts run in one transaction so a submission never exists without
    // its linked package (and vice versa) under a partial failure.
    const sku = `SUB-${supplier.id}-${Date.now().toString(36).toUpperCase()}`;
    const { pkg, row } = await db.transaction(async (tx) => {
      const [pkg] = await tx
        .insert(packagesTable)
        .values({
          organizationId: ctx.organizationId,
          sku,
          name: title,
          brand: supplier.name,
          vendor: supplier.name,
          category: category ?? "Uncategorized",
          country: supplier.country,
          status: "Uploaded",
          artworkUrl,
        })
        .returning();

      const [row] = await tx
        .insert(supplierSubmissionsTable)
        .values({
          organizationId: ctx.organizationId,
          supplierId,
          packageId: pkg!.id,
          submittedByUserId: ctx.userId,
          submittedByName: ctx.name || ctx.email || "Supplier",
          title,
          category,
          notes,
          artworkUrl,
          status: "Submitted",
        })
        .returning();
      return { pkg: pkg!, row: row! };
    });

    await writeAudit(req, {
      action: "Submission.Create",
      entityType: "supplier",
      entityId: supplierId,
      packageId: pkg!.id,
      detail: `Submission "${title}" from ${supplier.name}`,
      after: { title, status: "Submitted" },
    });

    res.status(201).json(mapSupplierSubmission(row!, { supplierName: supplier.name }));
  },
);

// PATCH /supplier-submissions/:id — internal review decision + feedback. Not
// available to supplier users (they lack submissions:review).
router.patch(
  "/supplier-submissions/:id",
  requirePermission("submissions:review"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const ctx = getAuthContext(req);

    const [existing] = await db
      .select()
      .from(supplierSubmissionsTable)
      .where(
        and(
          eq(supplierSubmissionsTable.id, id),
          eq(supplierSubmissionsTable.organizationId, ctx.organizationId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }

    const status = req.body?.status;
    if (!REVIEW_DECISIONS.includes(status)) {
      res.status(400).json({ error: "Invalid review decision" });
      return;
    }
    const reviewNotes = str(req.body?.reviewNotes);
    const terminal = status === "Approved" || status === "Rejected";

    const [row] = await db
      .update(supplierSubmissionsTable)
      .set({
        status,
        reviewNotes,
        reviewerUserId: ctx.userId,
        reviewerName: ctx.name || ctx.email || "Reviewer",
        reviewedAt: terminal ? new Date() : existing.reviewedAt,
      })
      .where(
        and(
          eq(supplierSubmissionsTable.id, id),
          eq(supplierSubmissionsTable.organizationId, ctx.organizationId),
        ),
      )
      .returning();

    // Reflect the decision onto the linked package's compliance status.
    if (existing.packageId) {
      const pkgStatus =
        status === "Approved" ? "Passed" : status === "Rejected" ? "Failed" : "Needs Review";
      await db
        .update(packagesTable)
        .set({ complianceStatus: pkgStatus })
        .where(
          and(
            eq(packagesTable.id, existing.packageId),
            eq(packagesTable.organizationId, ctx.organizationId),
          ),
        );
    }

    await writeAudit(req, {
      action: "Submission.Review",
      entityType: "supplier",
      entityId: existing.supplierId,
      packageId: existing.packageId,
      detail: `Submission "${existing.title}" -> ${status}`,
      before: { status: existing.status },
      after: { status, reviewNotes },
    });

    res.json(mapSupplierSubmission(row!));
  },
);

export default router;
