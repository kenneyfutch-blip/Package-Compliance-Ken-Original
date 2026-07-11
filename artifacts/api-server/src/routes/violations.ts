import { Router, type IRouter, type Request, type Response } from "express";
import { db, violationsTable, packagesTable } from "@workspace/db";
import {
  eq,
  and,
  or,
  ilike,
  inArray,
  desc,
  sql,
  type SQL,
} from "drizzle-orm";

const router: IRouter = Router();

const RESOLVED_STATUSES = ["Resolved", "Fixed", "Accepted", "Closed"];
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function toInt(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// GET /violations — every violation across all packages, joined with package context.
router.get(
  "/violations",
  async (req: Request, res: Response): Promise<void> => {
    const { search, engine, severity, status, vendor, category, resolved } =
      req.query;
    const limit = Math.min(toInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const offset = toInt(req.query.offset, 0);
    const conditions: SQL[] = [];

    if (typeof search === "string" && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(
        or(
          ilike(violationsTable.title, term),
          ilike(violationsTable.description, term),
          ilike(violationsTable.detectedText, term),
          ilike(violationsTable.suggestedText, term),
          ilike(packagesTable.name, term),
          ilike(packagesTable.sku, term),
          ilike(packagesTable.vendor, term),
        )!,
      );
    }
    if (typeof engine === "string" && engine) {
      conditions.push(eq(violationsTable.engine, engine));
    }
    if (typeof severity === "string" && severity) {
      conditions.push(eq(violationsTable.severity, severity));
    }
    if (typeof status === "string" && status) {
      conditions.push(eq(violationsTable.status, status));
    }
    if (typeof vendor === "string" && vendor) {
      conditions.push(eq(packagesTable.vendor, vendor));
    }
    if (typeof category === "string" && category) {
      conditions.push(eq(packagesTable.category, category));
    }
    // Resolution is a violation-level state, not a package-level one.
    if (resolved === "true") {
      conditions.push(inArray(violationsTable.status, RESOLVED_STATUSES));
    } else if (resolved === "false") {
      conditions.push(eq(violationsTable.status, "Open"));
    }

    const severityRank = sql`CASE ${violationsTable.severity}
      WHEN 'critical' THEN 0
      WHEN 'major' THEN 1
      WHEN 'minor' THEN 2
      ELSE 3 END`;

    const rows = await db
      .select({
        id: violationsTable.id,
        packageId: violationsTable.packageId,
        severity: violationsTable.severity,
        engine: violationsTable.engine,
        title: violationsTable.title,
        description: violationsTable.description,
        regulationRef: violationsTable.regulationRef,
        recommendation: violationsTable.recommendation,
        detectedText: violationsTable.detectedText,
        suggestedText: violationsTable.suggestedText,
        status: violationsTable.status,
        createdAt: violationsTable.createdAt,
        packageSku: packagesTable.sku,
        packageName: packagesTable.name,
        vendor: packagesTable.vendor,
        category: packagesTable.category,
        packageStatus: packagesTable.status,
        complianceStatus: packagesTable.complianceStatus,
        grade: packagesTable.grade,
        riskScore: packagesTable.riskScore,
      })
      .from(violationsTable)
      .innerJoin(
        packagesTable,
        eq(violationsTable.packageId, packagesTable.id),
      )
      .where(conditions.length ? and(...conditions) : undefined)
      // Deterministic ordering: severity, then newest, with id as tie-breaker.
      .orderBy(severityRank, desc(violationsTable.createdAt), desc(violationsTable.id))
      .limit(limit)
      .offset(offset);

    res.json(
      rows.map((r) => ({
        ...r,
        createdAt: new Date(r.createdAt).toISOString(),
      })),
    );
  },
);

export default router;
