import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  suppliersTable,
  packagesTable,
  supplierContactsTable,
  supplierSubmissionsTable,
  supplierScorecardsTable,
  supplierStatusHistoryTable,
} from "@workspace/db";
import { eq, and, desc, type SQL } from "drizzle-orm";
import { z } from "zod";

// Schema-validated supplier bodies (no ad-hoc casting of req.body). Optional
// text fields accept string | null; empty strings normalize to null below.
const optionalText = (max: number) => z.string().trim().max(max).nullish();
const supplierBodySchema = z.object({
  name: z.string().trim().max(300).optional(),
  status: z.string().optional(),
  code: optionalText(100),
  category: optionalText(200),
  riskLevel: optionalText(50),
  contactEmail: optionalText(320),
  country: optionalText(100),
  externalSource: optionalText(200),
  externalId: optionalText(200),
});
import {
  mapSupplier,
  mapPackage,
  mapSupplierContact,
  mapSupplierSubmission,
  mapSupplierScorecard,
  mapSupplierStatusEvent,
} from "../lib/mappers";
import { requirePermission, orgId, getAuthContext } from "../lib/rbac/context";
import { writeAudit } from "../lib/audit";

const router: IRouter = Router();

const SUPPLIER_STATUSES = ["Prospective", "Active", "Suspended", "Offboarded"];

function parseId(raw: string | string[] | undefined): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function clampScore(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Tenant + supplier scoping. Internal roles see their whole org; a supplier_user
// is hard-limited to their own supplier row so they can never read another
// supplier's data even by guessing ids.
function supplierConds(req: Request): SQL[] {
  const ctx = getAuthContext(req);
  const conds: SQL[] = [eq(suppliersTable.organizationId, ctx.organizationId)];
  if (ctx.roleKey === "supplier_user") {
    conds.push(eq(suppliersTable.id, ctx.supplierId ?? -1));
  }
  return conds;
}

// Loads a supplier the caller is allowed to see, or null.
async function loadAccessibleSupplier(req: Request, id: number) {
  const [supplier] = await db
    .select()
    .from(suppliersTable)
    .where(and(eq(suppliersTable.id, id), ...supplierConds(req)));
  return supplier ?? null;
}

router.get(
  "/suppliers",
  requirePermission("suppliers:read"),
  async (req: Request, res: Response): Promise<void> => {
    const rows = await db
      .select()
      .from(suppliersTable)
      .where(and(...supplierConds(req)))
      .orderBy(desc(suppliersTable.complianceScore));
    res.json(rows.map(mapSupplier));
  },
);

router.post(
  "/suppliers",
  requirePermission("suppliers:write"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = supplierBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
      return;
    }
    const body = parsed.data;
    const name = str(body.name);
    if (!name) {
      res.status(400).json({ error: "Supplier name is required" });
      return;
    }
    const status = SUPPLIER_STATUSES.includes(body.status as never)
      ? (body.status as string)
      : "Active";
    const [row] = await db
      .insert(suppliersTable)
      .values({
        organizationId: orgId(req),
        name,
        code: str(body.code),
        category: str(body.category),
        riskLevel: str(body.riskLevel) ?? "Low",
        status,
        contactEmail: str(body.contactEmail),
        country: str(body.country),
        externalSource: str(body.externalSource),
        externalId: str(body.externalId),
      })
      .returning();
    await writeAudit(req, {
      action: "Supplier.Create",
      entityType: "supplier",
      entityId: row!.id,
      detail: `Created supplier ${row!.name}`,
      after: { name: row!.name, status: row!.status, riskLevel: row!.riskLevel },
    });
    res.status(201).json(mapSupplier(row!));
  },
);

router.get(
  "/suppliers/:id",
  requirePermission("suppliers:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const supplier = await loadAccessibleSupplier(req, id);
    if (!supplier) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }
    const org = orgId(req);
    const canSeeReviewNotes = getAuthContext(req).roleKey !== "supplier_user";

    const [packages, contacts, submissions, scorecards, statusHistory] =
      await Promise.all([
        db
          .select()
          .from(packagesTable)
          // Join strictly by supplier ID. No runtime name fallback: matching
          // free-text vendor names at read time can attach legacy rows to the
          // wrong supplier after a rename or name reuse. Legacy rows are linked
          // once by the startup backfill (backfillSupplierLinks) instead.
          .where(
            and(
              eq(packagesTable.organizationId, org),
              eq(packagesTable.supplierId, id),
            ),
          )
          .orderBy(desc(packagesTable.createdAt)),
        db
          .select()
          .from(supplierContactsTable)
          .where(and(eq(supplierContactsTable.supplierId, id), eq(supplierContactsTable.organizationId, org)))
          .orderBy(desc(supplierContactsTable.isPrimary), desc(supplierContactsTable.createdAt)),
        db
          .select()
          .from(supplierSubmissionsTable)
          .where(and(eq(supplierSubmissionsTable.supplierId, id), eq(supplierSubmissionsTable.organizationId, org)))
          .orderBy(desc(supplierSubmissionsTable.createdAt)),
        db
          .select()
          .from(supplierScorecardsTable)
          .where(and(eq(supplierScorecardsTable.supplierId, id), eq(supplierScorecardsTable.organizationId, org)))
          .orderBy(desc(supplierScorecardsTable.createdAt)),
        db
          .select()
          .from(supplierStatusHistoryTable)
          .where(and(eq(supplierStatusHistoryTable.supplierId, id), eq(supplierStatusHistoryTable.organizationId, org)))
          .orderBy(desc(supplierStatusHistoryTable.createdAt)),
      ]);

    res.json({
      ...mapSupplier(supplier),
      packages: packages.map(mapPackage),
      contacts: contacts.map(mapSupplierContact),
      submissions: submissions.map((s) => {
        const m = mapSupplierSubmission(s, { supplierName: supplier.name });
        // Supplier users see their own submissions but internal review notes are
        // still returned to them here so they can act on requested changes.
        return m;
      }),
      scorecards: scorecards.map(mapSupplierScorecard),
      statusHistory: canSeeReviewNotes ? statusHistory.map(mapSupplierStatusEvent) : [],
    });
  },
);

router.patch(
  "/suppliers/:id",
  requirePermission("suppliers:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const existing = await loadAccessibleSupplier(req, id);
    if (!existing) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }

    const parsed = supplierBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
      return;
    }
    const body = parsed.data;
    const update: Partial<typeof suppliersTable.$inferInsert> = {};
    if (body.name !== undefined) {
      const name = str(body.name);
      if (!name) {
        res.status(400).json({ error: "Supplier name cannot be empty" });
        return;
      }
      update.name = name;
    }
    if (body.code !== undefined) update.code = str(body.code);
    if (body.category !== undefined) update.category = str(body.category);
    if (body.riskLevel !== undefined) update.riskLevel = str(body.riskLevel) ?? existing.riskLevel;
    if (body.contactEmail !== undefined) update.contactEmail = str(body.contactEmail);
    if (body.country !== undefined) update.country = str(body.country);
    if (body.externalSource !== undefined) update.externalSource = str(body.externalSource);
    if (body.externalId !== undefined) update.externalId = str(body.externalId);

    // Status transition — records to the append-only status history.
    let statusChanged = false;
    if (body.status !== undefined && body.status !== existing.status) {
      if (!SUPPLIER_STATUSES.includes(body.status as never)) {
        res.status(400).json({ error: "Invalid supplier status" });
        return;
      }
      update.status = body.status;
      statusChanged = true;
    }

    if (Object.keys(update).length === 0) {
      res.json(mapSupplier(existing));
      return;
    }

    const [row] = await db
      .update(suppliersTable)
      .set(update)
      .where(and(eq(suppliersTable.id, id), eq(suppliersTable.organizationId, orgId(req))))
      .returning();

    const ctx = getAuthContext(req);
    if (statusChanged) {
      await db.insert(supplierStatusHistoryTable).values({
        organizationId: orgId(req),
        supplierId: id,
        fromStatus: existing.status,
        toStatus: update.status!,
        reason: str(req.body?.statusReason),
        actorUserId: ctx.userId,
        actorName: ctx.name || ctx.email || "Unknown",
      });
    }
    await writeAudit(req, {
      action: statusChanged ? "Supplier.StatusChange" : "Supplier.Update",
      entityType: "supplier",
      entityId: id,
      detail: statusChanged
        ? `Status ${existing.status} -> ${update.status}`
        : `Updated supplier ${row!.name}`,
      before: { name: existing.name, status: existing.status, riskLevel: existing.riskLevel },
      after: { name: row!.name, status: row!.status, riskLevel: row!.riskLevel },
    });
    res.json(mapSupplier(row!));
  },
);

router.post(
  "/suppliers/:id/contacts",
  requirePermission("suppliers:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const supplier = await loadAccessibleSupplier(req, id);
    if (!supplier) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }
    const name = str(req.body?.name);
    if (!name) {
      res.status(400).json({ error: "Contact name is required" });
      return;
    }
    const isPrimary = req.body?.isPrimary === true;
    if (isPrimary) {
      // Only one primary contact per supplier.
      await db
        .update(supplierContactsTable)
        .set({ isPrimary: false })
        .where(and(eq(supplierContactsTable.supplierId, id), eq(supplierContactsTable.organizationId, orgId(req))));
    }
    const [row] = await db
      .insert(supplierContactsTable)
      .values({
        organizationId: orgId(req),
        supplierId: id,
        name,
        email: str(req.body?.email),
        phone: str(req.body?.phone),
        title: str(req.body?.title),
        isPrimary,
      })
      .returning();
    await writeAudit(req, {
      action: "Supplier.ContactAdd",
      entityType: "supplier",
      entityId: id,
      detail: `Added contact ${name}`,
    });
    res.status(201).json(mapSupplierContact(row!));
  },
);

router.delete(
  "/suppliers/:id/contacts/:contactId",
  requirePermission("suppliers:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const contactId = parseId(req.params["contactId"]);
    const supplier = await loadAccessibleSupplier(req, id);
    if (!supplier) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }
    const [deleted] = await db
      .delete(supplierContactsTable)
      .where(
        and(
          eq(supplierContactsTable.id, contactId),
          eq(supplierContactsTable.supplierId, id),
          eq(supplierContactsTable.organizationId, orgId(req)),
        ),
      )
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    await writeAudit(req, {
      action: "Supplier.ContactRemove",
      entityType: "supplier",
      entityId: id,
      detail: `Removed contact ${deleted.name}`,
    });
    res.status(204).end();
  },
);

router.post(
  "/suppliers/:id/scorecards",
  requirePermission("suppliers:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const supplier = await loadAccessibleSupplier(req, id);
    if (!supplier) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }
    const period = str(req.body?.period);
    const overallScore = clampScore(req.body?.overallScore);
    if (!period || overallScore === null) {
      res.status(400).json({ error: "period and overallScore are required" });
      return;
    }
    const ctx = getAuthContext(req);
    const [row] = await db
      .insert(supplierScorecardsTable)
      .values({
        organizationId: orgId(req),
        supplierId: id,
        period,
        overallScore,
        qualityScore: clampScore(req.body?.qualityScore),
        complianceScore: clampScore(req.body?.complianceScore),
        timelinessScore: clampScore(req.body?.timelinessScore),
        submissionsCount: Math.max(0, Math.round(Number(req.body?.submissionsCount) || 0)),
        approvedCount: Math.max(0, Math.round(Number(req.body?.approvedCount) || 0)),
        rejectedCount: Math.max(0, Math.round(Number(req.body?.rejectedCount) || 0)),
        notes: str(req.body?.notes),
        recordedByUserId: ctx.userId,
        recordedByName: ctx.name || ctx.email || "Unknown",
      })
      .returning();

    // Mirror the latest overall score onto the supplier for fast list rendering.
    await db
      .update(suppliersTable)
      .set({ complianceScore: overallScore })
      .where(and(eq(suppliersTable.id, id), eq(suppliersTable.organizationId, orgId(req))));

    await writeAudit(req, {
      action: "Supplier.ScorecardRecord",
      entityType: "supplier",
      entityId: id,
      detail: `Recorded ${period} scorecard (${overallScore})`,
      after: { period, overallScore },
    });
    res.status(201).json(mapSupplierScorecard(row!));
  },
);

export default router;
