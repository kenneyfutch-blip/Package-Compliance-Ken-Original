import { Router, type IRouter, type Request, type Response } from "express";
import { db, suppliersTable, packagesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { CreateSupplierBody } from "@workspace/api-zod";
import { mapSupplier, mapPackage } from "../lib/mappers";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}

router.get("/suppliers", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select()
    .from(suppliersTable)
    .orderBy(desc(suppliersTable.complianceScore));
  res.json(rows.map(mapSupplier));
});

router.post(
  "/suppliers",
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
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const [supplier] = await db
      .select()
      .from(suppliersTable)
      .where(eq(suppliersTable.id, id));
    if (!supplier) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }
    const packages = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.vendor, supplier.name))
      .orderBy(desc(packagesTable.createdAt));
    res.json({ ...mapSupplier(supplier), packages: packages.map(mapPackage) });
  },
);

export default router;
