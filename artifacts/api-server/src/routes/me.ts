import { Router, type IRouter, type Request, type Response } from "express";
import { db, organizationsTable, suppliersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuthContext } from "../lib/rbac/context";

const router: IRouter = Router();

// GET /me — the caller's identity, organization, role, and effective
// permissions. Drives role-aware navigation and route gating on the client.
router.get("/me", async (req: Request, res: Response): Promise<void> => {
  const ctx = getAuthContext(req);

  const [org] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, ctx.organizationId));

  let supplierName: string | null = null;
  if (ctx.supplierId != null) {
    const [supplier] = await db
      .select({ name: suppliersTable.name })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, ctx.supplierId));
    supplierName = supplier?.name ?? null;
  }

  res.json({
    id: ctx.userId,
    name: ctx.name,
    email: ctx.email,
    role: ctx.roleName,
    roleKey: ctx.roleKey,
    permissions: [...ctx.permissions].sort(),
    organizationId: ctx.organizationId,
    organizationName: org?.name ?? null,
    supplierId: ctx.supplierId,
    supplierName,
  });
});

export default router;
