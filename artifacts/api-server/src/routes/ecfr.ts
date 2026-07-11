import { Router, type IRouter, type Request, type Response } from "express";
import { db, packagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  pingEcfr,
  isEcfrConfigured,
  getEcfrStoredMeta,
  retrieveEcfrSections,
  gatherEcfrIntelligence,
  runEcfrSync,
  CURATED_PARTS,
} from "../lib/ecfr";
import { logger } from "../lib/logger";
import { requirePermission } from "../lib/rbac/context";
import { canAccessPackage } from "../lib/rbac/scope";

const router: IRouter = Router();

const DISCLAIMER =
  "Regulatory text from the Electronic Code of Federal Regulations (eCFR), an official U.S. government source. Content is synced periodically; verify against the current eCFR before making final compliance decisions.";

// GET /ecfr/status — admin panel: whether content is synced, when it last
// synced, how many sections per title, the CFR edition date, live reachability,
// and the curated parts catalog. Admin-scoped.
router.get(
  "/ecfr/status",
  requirePermission("ai_providers:read"),
  async (_req: Request, res: Response): Promise<void> => {
    const configured = isEcfrConfigured();
    const [reachable, meta] = await Promise.all([pingEcfr(), getEcfrStoredMeta()]);
    res.json({
      configured,
      reachable,
      synced: meta.totalSections > 0,
      totalSections: meta.totalSections,
      countsByTitle: meta.countsByTitle,
      lastSyncedAt: meta.lastSyncedAt,
      editionDate: meta.editionDate,
      curatedParts: CURATED_PARTS.map((p) => ({
        title: p.title,
        part: p.part,
        category: p.category,
        label: p.label,
      })),
      checkedAt: new Date().toISOString(),
      disclaimer: DISCLAIMER,
    });
  },
);

// POST /ecfr/sync — admin-triggered content refresh. Runs the same sync the
// weekly job runs. Admin-scoped.
router.post(
  "/ecfr/sync",
  requirePermission("ai_providers:write"),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await runEcfrSync();
      res.json(result);
    } catch (err) {
      logger.error({ err }, "eCFR manual sync failed");
      res.status(502).json({ error: "eCFR sync failed" });
    }
  },
);

// GET /ecfr/intelligence?packageId= — the synced CFR sections most relevant to a
// package. Read-permission; degrades gracefully (never throws on an empty/
// unreachable store).
router.get(
  "/ecfr/intelligence",
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

    const intelligence = await gatherEcfrIntelligence(pkg);
    res.json(intelligence);
  },
);

// GET /ecfr/search?q= — natural-language regulatory search over synced content.
// Read-permission.
router.get(
  "/ecfr/search",
  requirePermission("fda:read"),
  async (req: Request, res: Response): Promise<void> => {
    const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
    if (!q) {
      res.json({ query: "", results: [], disclaimer: DISCLAIMER });
      return;
    }
    const limitRaw = Number(req.query["limit"]);
    const limit =
      Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 25
        ? limitRaw
        : 10;

    const matches = await retrieveEcfrSections({ queryText: q, limit });
    res.json({
      query: q,
      results: matches.map((m) => ({
        citation: m.citation,
        heading: m.heading,
        snippet:
          m.text.length > 320 ? `${m.text.slice(0, 320).trimEnd()}…` : m.text,
        url: m.url,
        title: m.title,
        part: m.part,
        editionDate: m.editionDate,
        similarity: Number(m.similarity.toFixed(3)),
      })),
      disclaimer: DISCLAIMER,
    });
  },
);

export default router;
