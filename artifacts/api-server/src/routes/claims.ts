import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  packagesTable,
  regulationsTable,
  claimAnalysesTable,
  claimFindingsTable,
  type PackageRow,
  type ClaimFindingRow,
  type ClaimAnalysisRow,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  analyzeClaims,
  RISK_RANK,
  type ClaimsAnalysisResult,
  type ClaimRiskLevel,
} from "../lib/claims-ai";
import { logger } from "../lib/logger";
import { requirePermission, orgId } from "../lib/rbac/context";
import { packageConds } from "../lib/rbac/scope";
import { writeAudit } from "../lib/audit";

const router: IRouter = Router();

function requireId(
  raw: string | string[] | undefined,
  res: Response,
): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  return id;
}

// Load a package the caller is allowed to see (org + supplier scoped).
async function loadOwnedPackage(
  req: Request,
  id: number,
): Promise<PackageRow | null> {
  const [pkg] = await db
    .select()
    .from(packagesTable)
    .where(and(eq(packagesTable.id, id), ...packageConds(req)));
  return pkg ?? null;
}

function mapFinding(row: ClaimFindingRow) {
  return {
    id: row.id,
    analysisId: row.analysisId,
    packageId: row.packageId,
    claimType: row.claimType,
    claimText: row.claimText,
    jurisdiction: row.jurisdiction,
    riskLevel: row.riskLevel,
    regulationReference: row.regulationReference,
    remediation: row.remediation,
    confidence: row.confidence,
    escalated: row.escalated,
    status: row.status,
    createdAt: row.createdAt?.toISOString?.() ?? null,
  };
}

function mapAnalysis(row: ClaimAnalysisRow) {
  return {
    id: row.id,
    packageId: row.packageId,
    status: row.status,
    summary: row.summary,
    confidence: row.confidence,
    claimsFound: row.claimsFound,
    lowCount: row.lowCount,
    mediumCount: row.mediumCount,
    highCount: row.highCount,
    criticalCount: row.criticalCount,
    highestRisk: row.highestRisk,
    escalated: row.escalated,
    tier: row.tier,
    model: row.model,
    createdAt: row.createdAt?.toISOString?.() ?? null,
  };
}

async function loadRegulations() {
  return db.select().from(regulationsTable);
}

// Persist a claims analysis: replace prior analysis/findings atomically
// (latest-only), then append an audit event.
async function persistAnalysis(
  req: Request,
  pkg: PackageRow,
  result: ClaimsAnalysisResult,
  organizationId: number,
): Promise<number> {
  const counts = { Low: 0, Medium: 0, High: 0, Critical: 0 } as Record<
    ClaimRiskLevel,
    number
  >;
  let worst = 0;
  for (const f of result.findings) {
    counts[f.riskLevel] += 1;
    worst = Math.max(worst, RISK_RANK[f.riskLevel]);
  }
  const highestRisk: ClaimRiskLevel | null =
    (Object.keys(RISK_RANK) as ClaimRiskLevel[]).find(
      (k) => RISK_RANK[k] === worst,
    ) ?? null;
  const orch = result.orchestration;

  const analysisId = await db.transaction(async (tx) => {
    await tx
      .delete(claimFindingsTable)
      .where(eq(claimFindingsTable.packageId, pkg.id));
    await tx
      .delete(claimAnalysesTable)
      .where(eq(claimAnalysesTable.packageId, pkg.id));

    const [analysis] = await tx
      .insert(claimAnalysesTable)
      .values({
        organizationId,
        packageId: pkg.id,
        status: "Complete",
        summary: result.summary,
        confidence: result.confidence,
        claimsFound: result.findings.length,
        lowCount: counts.Low,
        mediumCount: counts.Medium,
        highCount: counts.High,
        criticalCount: counts.Critical,
        highestRisk,
        escalated: orch?.escalated ?? false,
        tier: orch?.finalTier ?? null,
        model: orch?.finalModel ?? null,
      })
      .returning();

    if (result.findings.length > 0) {
      await tx.insert(claimFindingsTable).values(
        result.findings.map((f) => ({
          organizationId,
          analysisId: analysis!.id,
          packageId: pkg.id,
          claimType: f.claimType,
          claimText: f.claimText,
          jurisdiction: f.jurisdiction,
          riskLevel: f.riskLevel,
          regulationReference: f.regulationReference,
          remediation: f.remediation,
          confidence: f.confidence,
          // A finding "drove" the escalation if it is High/Critical and the
          // run actually escalated to the reasoning tier.
          escalated:
            (orch?.escalated ?? false) &&
            RISK_RANK[f.riskLevel] >= RISK_RANK.High,
          status: "Open",
        })),
      );
    }

    return analysis!.id;
  });

  await writeAudit(req, {
    action: "Claims compliance analysis completed",
    entityType: "claim_analysis",
    entityId: analysisId,
    packageId: pkg.id,
    detail: `${result.findings.length} claim(s) audited (${counts.Critical} critical, ${counts.High} high)${orch?.escalated ? "; escalated to reasoning tier" : ""}.`,
    regulationRefs: Array.from(
      new Set(
        result.findings
          .map((f) => f.regulationReference)
          .filter((r): r is string => Boolean(r)),
      ),
    ),
  });

  return analysisId;
}

async function buildDetail(pkg: PackageRow) {
  const [analysis] = await db
    .select()
    .from(claimAnalysesTable)
    .where(eq(claimAnalysesTable.packageId, pkg.id))
    .orderBy(desc(claimAnalysesTable.id))
    .limit(1);

  const findings = analysis
    ? await db
        .select()
        .from(claimFindingsTable)
        .where(eq(claimFindingsTable.analysisId, analysis.id))
        .orderBy(desc(claimFindingsTable.id))
    : [];

  return {
    package: {
      id: pkg.id,
      sku: pkg.sku,
      name: pkg.name,
      vendor: pkg.vendor,
      artworkUrl: pkg.artworkUrl,
    },
    analysis: analysis ? mapAnalysis(analysis) : null,
    findings: findings.map(mapFinding),
  };
}

// GET /packages/:id/claims — latest claims analysis + findings for one package.
router.get(
  "/packages/:id/claims",
  requirePermission("violations:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const pkg = await loadOwnedPackage(req, id);
    if (!pkg) {
      res.status(404).json({ error: "Package not found" });
      return;
    }
    res.json(await buildDetail(pkg));
  },
);

// POST /packages/:id/claims — run the Claims Compliance Engine and persist.
router.post(
  "/packages/:id/claims",
  requirePermission("packages:analyze"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const pkg = await loadOwnedPackage(req, id);
    if (!pkg) {
      res.status(404).json({ error: "Package not found" });
      return;
    }
    try {
      const regulations = await loadRegulations();
      const result = await analyzeClaims(pkg, regulations);
      await persistAnalysis(req, pkg, result, orgId(req));
    } catch (err) {
      logger.error({ err }, "Claims analysis failed");
      res
        .status(502)
        .json({ error: "AI claims analysis failed. Please retry." });
      return;
    }
    res.json(await buildDetail(pkg));
  },
);

export default router;
