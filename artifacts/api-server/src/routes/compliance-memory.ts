import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requirePermission, orgId, getAuthContext } from "../lib/rbac/context";
import { retrieveSimilarFindings } from "../lib/memory/engine";

const router: IRouter = Router();

// GET /compliance-memory — semantic search over captured findings.
// Returns the past approved findings most similar to the query text, so a
// reviewer can see how comparable issues were resolved before.
router.get(
  "/compliance-memory",
  requirePermission("packages:read"),
  async (req: Request, res: Response): Promise<void> => {
    const { q, limit } = req.query;
    const query = typeof q === "string" ? q.trim() : "";
    if (!query) {
      res.json([]);
      return;
    }
    const parsedLimit = Number(limit);
    const take =
      Number.isInteger(parsedLimit) && parsedLimit > 0 && parsedLimit <= 50
        ? parsedLimit
        : 10;

    // Supplier users may only ever recall their own supplier's findings, scoped
    // by supplier id (the authoritative link, not the vendor name).
    const ctx = getAuthContext(req);
    const supplierId =
      ctx.roleKey === "supplier_user" ? (ctx.supplierId ?? -1) : null;

    const results = await retrieveSimilarFindings({
      organizationId: orgId(req),
      queryText: query,
      limit: take,
      minSimilarity: 0.1,
      supplierId,
    });
    res.json(results);
  },
);

// GET /compliance-memory/stats — summary of the institutional knowledge base.
router.get(
  "/compliance-memory/stats",
  requirePermission("packages:read"),
  async (req: Request, res: Response): Promise<void> => {
    const organizationId = orgId(req);
    // Supplier users may only ever see stats for their own supplier's findings,
    // never org-wide totals or the count of other suppliers.
    const ctx = getAuthContext(req);
    const supplierId =
      ctx.roleKey === "supplier_user" ? (ctx.supplierId ?? -1) : null;
    const supplierCond =
      supplierId !== null ? sql` AND supplier_id = ${supplierId}` : sql``;
    const result = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE approval_status = 'Approved')::int AS approved,
        COUNT(DISTINCT engine)::int AS engines,
        COUNT(DISTINCT vendor)::int AS vendors
      FROM compliance_memory
      WHERE organization_id = ${organizationId}${supplierCond}
    `);
    const row =
      (result as unknown as { rows: Record<string, unknown>[] }).rows?.[0] ?? {};
    res.json({
      total: Number(row["total"] ?? 0),
      approved: Number(row["approved"] ?? 0),
      engines: Number(row["engines"] ?? 0),
      vendors: Number(row["vendors"] ?? 0),
    });
  },
);

export default router;
