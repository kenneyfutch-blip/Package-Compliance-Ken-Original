import { Router, type IRouter, type Request, type Response } from "express";
import { db, packagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  fetchRecalls,
  gatherFdaIntelligence,
  FdaNotConfiguredError,
  isFdaConfigured,
  pingFda,
  fdaCatalog,
  RECALL_CATEGORIES,
  type RecallCategory,
} from "../lib/fda";
import { logger } from "../lib/logger";
import { requirePermission } from "../lib/rbac/context";
import { canAccessPackage } from "../lib/rbac/scope";

const router: IRouter = Router();

const DISCLAIMER =
  "Data provided by openFDA (U.S. Food & Drug Administration). Do not rely on openFDA to make decisions regarding medical care.";

// GET /fda/status — admin panel: whether the FDA integration is configured,
// whether openFDA is reachable right now, and the full catalog of category ->
// dataset mappings the review engine consults.
router.get("/fda/status", requirePermission("fda:read"), async (_req: Request, res: Response): Promise<void> => {
  const configured = isFdaConfigured();
  const reachable = configured ? await pingFda() : false;
  res.json({
    configured,
    reachable,
    checkedAt: new Date().toISOString(),
    catalog: fdaCatalog(),
    disclaimer: DISCLAIMER,
  });
});

// GET /fda/recalls — proxy live openFDA enforcement (recall) data. The openFDA
// API key stays server-side; the browser only ever calls this route.
router.get("/fda/recalls", requirePermission("fda:read"), async (req: Request, res: Response): Promise<void> => {
  const categoryRaw = String(req.query["category"] ?? "food").toLowerCase();
  if (!RECALL_CATEGORIES.includes(categoryRaw as RecallCategory)) {
    res
      .status(400)
      .json({ error: `category must be one of: ${RECALL_CATEGORIES.join(", ")}` });
    return;
  }
  const category = categoryRaw as RecallCategory;

  const searchRaw = req.query["search"];
  const search = typeof searchRaw === "string" ? searchRaw : undefined;

  const limitNum = Number(req.query["limit"]);
  const limit = Number.isFinite(limitNum) && limitNum > 0 ? limitNum : 20;

  try {
    const { results, total } = await fetchRecalls({ category, search, limit });
    res.json({ results, total, disclaimer: DISCLAIMER });
  } catch (err) {
    if (err instanceof FdaNotConfiguredError) {
      res.status(503).json({ error: "FDA integration is not configured yet." });
      return;
    }
    logger.error({ err }, "openFDA recall lookup failed");
    res.status(502).json({ error: "Failed to fetch FDA recall data" });
  }
});

// GET /fda/intelligence?packageId= — assemble applicable FDA sources for a
// package (category auto-detected). Degrades gracefully: an FDA outage or a
// category with no FDA coverage returns a valid payload with available/message
// flags rather than an error, so a review can always continue.
router.get(
  "/fda/intelligence",
  requirePermission("fda:read"),
  async (req: Request, res: Response): Promise<void> => {
    const packageId = Number(req.query["packageId"]);
    if (!Number.isInteger(packageId) || packageId <= 0) {
      res.status(400).json({ error: "packageId is required" });
      return;
    }

    const [pkg] = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.id, packageId));

    if (!pkg || !canAccessPackage(req, pkg)) {
      res.status(404).json({ error: "Package not found" });
      return;
    }

    try {
      const intelligence = await gatherFdaIntelligence(pkg);
      res.json(intelligence);
    } catch (err) {
      // gatherFdaIntelligence swallows upstream failures; a throw here is
      // unexpected, so surface it rather than pretending data exists.
      logger.error({ err }, "FDA intelligence lookup failed");
      res.status(502).json({ error: "Failed to assemble FDA intelligence" });
    }
  },
);

export default router;
