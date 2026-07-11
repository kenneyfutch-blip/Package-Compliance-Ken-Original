import { Router, type IRouter, type Request, type Response } from "express";
import {
  fetchRecalls,
  FdaNotConfiguredError,
  FDA_CATEGORIES,
  type FdaCategory,
} from "../lib/openfda";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// GET /fda/recalls — proxy live openFDA enforcement (recall) data. The openFDA
// API key stays server-side; the browser only ever calls this route.
router.get("/fda/recalls", async (req: Request, res: Response): Promise<void> => {
  const categoryRaw = String(req.query["category"] ?? "food").toLowerCase();
  if (!FDA_CATEGORIES.includes(categoryRaw as FdaCategory)) {
    res
      .status(400)
      .json({ error: `category must be one of: ${FDA_CATEGORIES.join(", ")}` });
    return;
  }
  const category = categoryRaw as FdaCategory;

  const searchRaw = req.query["search"];
  const search = typeof searchRaw === "string" ? searchRaw : undefined;

  const limitNum = Number(req.query["limit"]);
  const limit = Number.isFinite(limitNum) && limitNum > 0 ? limitNum : 20;

  try {
    const { results, total } = await fetchRecalls({ category, search, limit });
    res.json({
      results,
      total,
      disclaimer:
        "Data provided by openFDA (U.S. Food & Drug Administration). Do not rely on openFDA to make decisions regarding medical care.",
    });
  } catch (err) {
    if (err instanceof FdaNotConfiguredError) {
      res.status(503).json({
        error: "FDA integration is not configured yet.",
      });
      return;
    }
    logger.error({ err }, "openFDA recall lookup failed");
    res.status(502).json({ error: "Failed to fetch FDA recall data" });
  }
});

export default router;
