import { Router, type IRouter, type Request, type Response } from "express";
import { db, suppliersTable, packagesTable } from "@workspace/db";
import { eq, and, desc, type SQL } from "drizzle-orm";
import { CreateSupplierBody } from "@workspace/api-zod";
import { mapSupplier, mapPackage } from "../lib/mappers";
import { requirePermission, orgId, getAuthContext } from "../lib/rbac/context";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}

// Tenant + supplier scoping for supplier queries.
function supplierConds(req: Request): SQL[] {
  const ctx = getAuthContext(req);
  const conds: SQL[] = [eq(suppliersTable.organizationId, ctx.organizationId)];
  if (ctx.roleKey === "supplier_user") {
    conds.push(eq(suppliersTable.id, ctx.supplierId ?? -1));
  }
  return conds;
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
    const parsed = CreateSupplierBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    const [row] = await db
      .insert(suppliersTable)
      .values({
        organizationId: orgId(req),
        name: d.name,
        code: d.code ?? null,
        category: d.category ?? null,
        riskLevel: d.riskLevel ?? "Low",
        contactEmail: d.contactEmail ?? null,
        country: d.country ?? null,
      })
      .returning();
    res.status(201).json(mapSupplier(row!));
  },
);

router.get(
  "/suppliers/:id",
  requirePermission("suppliers:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const [supplier] = await db
      .select()
      .from(suppliersTable)
      .where(and(eq(suppliersTable.id, id), ...supplierConds(req)));
    if (!supplier) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }
    const packages = await db
      .select()
      .from(packagesTable)
      .where(
        and(
          eq(packagesTable.vendor, supplier.name),
          eq(packagesTable.organizationId, orgId(req)),
        ),
      )
      .orderBy(desc(packagesTable.createdAt));
    res.json({ ...mapSupplier(supplier), packages: packages.map(mapPackage) });
  },
);

export default router;
