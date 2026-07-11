import { Router, type IRouter, type Request, type Response } from "express";
import { db, packagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requirePermission } from "../lib/rbac/context";
import { canAccessPackage } from "../lib/rbac/scope";
import { mapExtraction } from "../lib/mappers";
import { extractionStatus } from "../lib/document-ai/providers/registry";
import {
  getLatestExtraction,
  listExtractions,
} from "../lib/document-ai/service";

const router: IRouter = Router();

function requireId(raw: string | string[] | undefined, res: Response): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  return id;
}

async function loadAccessiblePackage(
  req: Request,
  res: Response,
  id: number,
): Promise<boolean> {
  const [pkg] = await db
    .select()
    .from(packagesTable)
    .where(eq(packagesTable.id, id));
  if (!pkg || !canAccessPackage(req, pkg)) {
    res.status(404).json({ error: "Package not found" });
    return false;
  }
  return true;
}

// GET /document-ai/status — non-secret configuration status.
router.get(
  "/document-ai/status",
  requirePermission("packages:read"),
  async (_req: Request, res: Response): Promise<void> => {
    res.json(extractionStatus());
  },
);

// GET /packages/:id/extraction — latest cached extraction. NEVER runs Document
// AI; opening/viewing a package must not trigger reprocessing.
router.get(
  "/packages/:id/extraction",
  requirePermission("packages:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    if (!(await loadAccessiblePackage(req, res, id))) return;
    const extraction = await getLatestExtraction(id);
    res.json(extraction ? mapExtraction(extraction) : null);
  },
);

// GET /packages/:id/extractions — extraction history (newest first).
router.get(
  "/packages/:id/extractions",
  requirePermission("packages:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    if (!(await loadAccessiblePackage(req, res, id))) return;
    const rows = await listExtractions(id);
    res.json(rows.map(mapExtraction));
  },
);

export default router;
