import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  packagesTable,
  regulationsTable,
  languageReviewsTable,
  languageFindingsTable,
  type PackageRow,
  type LanguageFindingRow,
} from "@workspace/db";
import { eq, and, or, ilike, gte, lte, desc, inArray, isNotNull, type SQL } from "drizzle-orm";
import { analyzeLanguage, type LanguageReviewResult } from "../lib/language-ai";
import { logger } from "../lib/logger";
import { requirePermission, orgId } from "../lib/rbac/context";
import { packageConds } from "../lib/rbac/scope";
import { writeAudit } from "../lib/audit";
import { parsePagination } from "../lib/pagination";
import { cachedDashboard } from "../lib/cache/dashboard-cache";

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

function mapFinding(row: LanguageFindingRow, historicalUsage = 0) {
  return {
    id: row.id,
    reviewId: row.reviewId,
    packageId: row.packageId,
    issueType: row.issueType,
    severity: row.severity,
    originalText: row.originalText,
    suggestedText: row.suggestedText,
    reason: row.reason,
    regulationReference: row.regulationReference,
    confidenceScore: row.confidenceScore,
    claimRiskScore: row.claimRiskScore,
    reviewFlags: row.reviewFlags ?? null,
    bbox:
      row.bboxX != null && row.bboxY != null
        ? { x: row.bboxX, y: row.bboxY, w: row.bboxW ?? 0.2, h: row.bboxH ?? 0.08 }
        : null,
    status: row.status,
    approvedFix: row.approvedFix,
    historicalUsage,
    createdAt: row.createdAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  };
}

function mapReview(row: typeof languageReviewsTable.$inferSelect) {
  return {
    id: row.id,
    packageId: row.packageId,
    score: row.score,
    confidence: row.confidence,
    status: row.status,
    summary: row.summary,
    issueCount: row.issueCount,
    criticalCount: row.criticalCount,
    majorCount: row.majorCount,
    minorCount: row.minorCount,
    spellingCount: row.spellingCount,
    grammarCount: row.grammarCount,
    contextCount: row.contextCount,
    regulatoryCount: row.regulatoryCount,
    marketingCount: row.marketingCount,
    brandCount: row.brandCount,
    reviewer: row.reviewer,
    createdAt: row.createdAt?.toISOString?.() ?? null,
  };
}

async function loadRegulations() {
  return db.select().from(regulationsTable);
}

// Count how many times each suggested fix has previously been approved across
// the org, so reviewers see the historical resolution rate for a finding.
async function historicalUsageMap(
  organizationId: number,
  findings: LanguageFindingRow[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const texts = Array.from(
    new Set(
      findings
        .map((f) => f.approvedFix || f.suggestedText)
        .filter((t): t is string => Boolean(t)),
    ),
  );
  if (texts.length === 0) return map;
  // Only scan approved/resolved rows whose fix text is one we actually care
  // about, so this never degrades into a full-table scan.
  const rows = await db
    .select({
      approvedFix: languageFindingsTable.approvedFix,
      suggestedText: languageFindingsTable.suggestedText,
    })
    .from(languageFindingsTable)
    .where(
      and(
        eq(languageFindingsTable.organizationId, organizationId),
        inArray(languageFindingsTable.status, ["Approved", "Resolved"]),
        or(
          inArray(languageFindingsTable.approvedFix, texts),
          inArray(languageFindingsTable.suggestedText, texts),
        ),
      ),
    );
  const wanted = new Set(texts);
  for (const r of rows) {
    const key = r.approvedFix || r.suggestedText;
    if (key && wanted.has(key)) map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

// Persist a language review result: replace prior findings, write the review
// aggregate, denormalize the score onto the package, and append an audit event.
async function persistReview(
  req: Request,
  pkg: PackageRow,
  result: LanguageReviewResult,
  organizationId: number,
): Promise<number> {
  const counts = {
    critical: 0,
    major: 0,
    minor: 0,
    Spelling: 0,
    Grammar: 0,
    Context: 0,
    Regulatory: 0,
    "Marketing Claim": 0,
    "Brand Language": 0,
  } as Record<string, number>;
  for (const f of result.findings) {
    if (f.severity === "critical") counts.critical += 1;
    else if (f.severity === "major") counts.major += 1;
    else if (f.severity === "minor") counts.minor += 1;
    counts[f.issueType] = (counts[f.issueType] ?? 0) + 1;
  }

  // Replace prior reviews/findings atomically so concurrent re-runs can never
  // leave a mix of old and new rows (latest-only semantics).
  const reviewId = await db.transaction(async (tx) => {
    await tx
      .delete(languageFindingsTable)
      .where(eq(languageFindingsTable.packageId, pkg.id));
    await tx
      .delete(languageReviewsTable)
      .where(eq(languageReviewsTable.packageId, pkg.id));

    const [review] = await tx
      .insert(languageReviewsTable)
      .values({
        organizationId,
        packageId: pkg.id,
        score: result.score,
        confidence: result.confidence,
        status: "Complete",
        summary: result.summary,
        issueCount: result.findings.length,
        criticalCount: counts.critical,
        majorCount: counts.major,
        minorCount: counts.minor,
        spellingCount: counts.Spelling,
        grammarCount: counts.Grammar,
        contextCount: counts.Context,
        regulatoryCount: counts.Regulatory,
        marketingCount: counts["Marketing Claim"],
        brandCount: counts["Brand Language"],
      })
      .returning();

    if (result.findings.length > 0) {
      await tx.insert(languageFindingsTable).values(
        result.findings.map((f) => ({
          organizationId,
          reviewId: review!.id,
          packageId: pkg.id,
          issueType: f.issueType,
          severity: f.severity,
          originalText: f.originalText,
          suggestedText: f.suggestedText,
          reason: f.reason,
          regulationReference: f.regulationReference,
          confidenceScore: f.confidenceScore,
          claimRiskScore: f.claimRiskScore,
          reviewFlags: f.reviewFlags,
          bboxX: f.bbox?.x ?? null,
          bboxY: f.bbox?.y ?? null,
          bboxW: f.bbox?.w ?? null,
          bboxH: f.bbox?.h ?? null,
          status: "Open",
        })),
      );
    }

    await tx
      .update(packagesTable)
      .set({
        languageScore: result.score,
        languageIssueCount: result.findings.length,
        languageCriticalCount: counts.critical,
        languageAnalyzedAt: new Date(),
      })
      .where(eq(packagesTable.id, pkg.id));

    return review!.id;
  });

  await writeAudit(req, {
    action: "Language review completed",
    entityType: "language_review",
    entityId: reviewId,
    packageId: pkg.id,
    detail: `Language score ${result.score}, ${result.findings.length} finding(s) (${counts.critical} critical).`,
    regulationRefs: Array.from(
      new Set(
        result.findings
          .map((f) => f.regulationReference)
          .filter((r): r is string => Boolean(r)),
      ),
    ),
  });

  return reviewId;
}

async function buildDetail(req: Request, pkg: PackageRow) {
  const [review] = await db
    .select()
    .from(languageReviewsTable)
    .where(eq(languageReviewsTable.packageId, pkg.id))
    .orderBy(desc(languageReviewsTable.id))
    .limit(1);

  const findings = review
    ? await db
        .select()
        .from(languageFindingsTable)
        .where(eq(languageFindingsTable.reviewId, review.id))
        .orderBy(desc(languageFindingsTable.id))
    : [];

  const usage = await historicalUsageMap(orgId(req), findings);

  return {
    package: {
      id: pkg.id,
      sku: pkg.sku,
      name: pkg.name,
      vendor: pkg.vendor,
      artworkUrl: pkg.artworkUrl,
      languageScore: pkg.languageScore ?? review?.score ?? null,
    },
    review: review ? mapReview(review) : null,
    findings: findings.map((f) =>
      mapFinding(f, usage.get(f.approvedFix || f.suggestedText || "") ?? 0),
    ),
  };
}

// GET /packages/:id/language-review — latest review + findings for one package.
router.get(
  "/packages/:id/language-review",
  requirePermission("violations:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const pkg = await loadOwnedPackage(req, id);
    if (!pkg) {
      res.status(404).json({ error: "Package not found" });
      return;
    }
    res.json(await buildDetail(req, pkg));
  },
);

// POST /packages/:id/language-review — run the engine and persist results.
router.post(
  "/packages/:id/language-review",
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
      const result = await analyzeLanguage(pkg, regulations);
      await persistReview(req, pkg, result, orgId(req));
    } catch (err) {
      logger.error({ err }, "Language review failed");
      res.status(502).json({ error: "AI language review failed. Please retry." });
      return;
    }
    const [refreshed] = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.id, id));
    res.json(await buildDetail(req, refreshed!));
  },
);

// POST /packages/bulk-language-review — run the engine across many packages.
router.post(
  "/packages/bulk-language-review",
  requirePermission("packages:analyze"),
  async (req: Request, res: Response): Promise<void> => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((n: unknown) => Number(n)).filter(Number.isInteger)
      : [];
    if (ids.length === 0) {
      res.status(400).json({ error: "Provide ids: number[]" });
      return;
    }
    const pkgs = await db
      .select()
      .from(packagesTable)
      .where(and(inArray(packagesTable.id, ids), ...packageConds(req)));

    let processed = 0;
    let failed = 0;
    const regulations = await loadRegulations();
    for (const pkg of pkgs) {
      try {
        const result = await analyzeLanguage(pkg, regulations);
        await persistReview(req, pkg, result, orgId(req));
        processed += 1;
      } catch (err) {
        logger.error({ err, id: pkg.id }, "Bulk language review item failed");
        failed += 1;
      }
    }
    res.json({ processed, failed, total: pkgs.length });
  },
);

// GET /language-findings — filterable findings across the org (center + bulk).
router.get(
  "/language-findings",
  requirePermission("violations:read"),
  async (req: Request, res: Response): Promise<void> => {
    const { issueType, severity, status, minScore, maxScore, search } =
      req.query;
    const { limit, offset } = parsePagination(req);

    // Join findings -> packages and scope by caller-visible packages in SQL so
    // we never preload every package row into memory.
    const conds: SQL[] = [...packageConds(req)];
    if (typeof issueType === "string" && issueType)
      conds.push(eq(languageFindingsTable.issueType, issueType));
    if (typeof severity === "string" && severity)
      conds.push(eq(languageFindingsTable.severity, severity));
    if (typeof status === "string" && status)
      conds.push(eq(languageFindingsTable.status, status));
    const min = minScore != null ? Number(minScore) : null;
    const max = maxScore != null ? Number(maxScore) : null;
    if (min != null && !Number.isNaN(min))
      conds.push(gte(packagesTable.languageScore, min));
    if (max != null && !Number.isNaN(max))
      conds.push(lte(packagesTable.languageScore, max));
    if (typeof search === "string" && search.trim()) {
      const term = `%${search.trim()}%`;
      conds.push(
        or(
          ilike(languageFindingsTable.originalText, term),
          ilike(languageFindingsTable.suggestedText, term),
          ilike(languageFindingsTable.reason, term),
        )!,
      );
    }

    const rows = await db
      .select({
        finding: languageFindingsTable,
        sku: packagesTable.sku,
        name: packagesTable.name,
        vendor: packagesTable.vendor,
        languageScore: packagesTable.languageScore,
      })
      .from(languageFindingsTable)
      .innerJoin(
        packagesTable,
        eq(languageFindingsTable.packageId, packagesTable.id),
      )
      .where(and(...conds))
      .orderBy(desc(languageFindingsTable.id))
      .limit(limit)
      .offset(offset);

    const usage = await historicalUsageMap(
      orgId(req),
      rows.map((r) => r.finding),
    );

    res.json(
      rows.map((r) => ({
        ...mapFinding(
          r.finding,
          usage.get(r.finding.approvedFix || r.finding.suggestedText || "") ?? 0,
        ),
        packageSku: r.sku,
        packageName: r.name,
        packageVendor: r.vendor,
        languageScore: r.languageScore ?? null,
      })),
    );
  },
);

// GET /language-reviews — per-package review summaries for bulk review.
router.get(
  "/language-reviews",
  requirePermission("violations:read"),
  async (req: Request, res: Response): Promise<void> => {
    const { limit, offset } = parsePagination(req);
    const pkgs = await db
      .select()
      .from(packagesTable)
      .where(
        and(...packageConds(req), isNotNull(packagesTable.languageAnalyzedAt)),
      )
      .orderBy(desc(packagesTable.languageAnalyzedAt))
      .limit(limit)
      .offset(offset);

    res.json(
      pkgs
        .map((p) => ({
          packageId: p.id,
          sku: p.sku,
          name: p.name,
          vendor: p.vendor,
          languageScore: p.languageScore,
          issueCount: p.languageIssueCount,
          criticalCount: p.languageCriticalCount,
          status:
            (p.languageScore ?? 100) >= 90
              ? "Passed"
              : (p.languageScore ?? 100) >= 80
                ? "Needs Review"
                : "High Risk",
          analyzedAt: p.languageAnalyzedAt?.toISOString?.() ?? null,
        })),
    );
  },
);

// PATCH /language-findings/:id — update a finding's status / approved fix.
router.patch(
  "/language-findings/:id",
  requirePermission("violations:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;

    const [finding] = await db
      .select()
      .from(languageFindingsTable)
      .where(eq(languageFindingsTable.id, id));
    if (!finding) {
      res.status(404).json({ error: "Finding not found" });
      return;
    }
    // Enforce org/supplier scope via the parent package.
    const pkg = await loadOwnedPackage(req, finding.packageId);
    if (!pkg) {
      res.status(404).json({ error: "Finding not found" });
      return;
    }

    const status =
      typeof req.body?.status === "string" ? req.body.status : undefined;
    const approvedFix =
      typeof req.body?.approvedFix === "string"
        ? req.body.approvedFix
        : undefined;
    if (status === undefined && approvedFix === undefined) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }

    const [updated] = await db
      .update(languageFindingsTable)
      .set({
        ...(status !== undefined ? { status } : {}),
        ...(approvedFix !== undefined ? { approvedFix } : {}),
      })
      .where(eq(languageFindingsTable.id, id))
      .returning();

    await writeAudit(req, {
      action: "Language finding updated",
      entityType: "language_finding",
      entityId: id,
      packageId: finding.packageId,
      detail: `Status: ${updated!.status}${approvedFix !== undefined ? "; approved fix set" : ""}.`,
      before: { status: finding.status, approvedFix: finding.approvedFix },
      after: { status: updated!.status, approvedFix: updated!.approvedFix },
    });

    res.json(mapFinding(updated!));
  },
);

// GET /dashboard/language-quality — aggregate widget stats.
router.get(
  "/dashboard/language-quality",
  requirePermission("dashboard:read"),
  async (req: Request, res: Response): Promise<void> => {
    const payload = await cachedDashboard(req, "language-quality", async () => {
    const pkgs = await db
      .select()
      .from(packagesTable)
      .where(and(...packageConds(req)));
    const analyzed = pkgs.filter((p) => p.languageAnalyzedAt != null);

    const reviewed = analyzed.length;
    const averageScore =
      reviewed > 0
        ? Math.round(
            analyzed.reduce((sum, p) => sum + (p.languageScore ?? 0), 0) /
              reviewed,
          )
        : null;
    const criticalFindings = analyzed.reduce(
      (sum, p) => sum + (p.languageCriticalCount ?? 0),
      0,
    );

    const allowedIds = analyzed.map((p) => p.id);
    const byType = {
      spelling: 0,
      grammar: 0,
      context: 0,
      regulatory: 0,
      marketing: 0,
      brand: 0,
    };
    if (allowedIds.length > 0) {
      const reviews = await db
        .select()
        .from(languageReviewsTable)
        .where(inArray(languageReviewsTable.packageId, allowedIds));
      for (const r of reviews) {
        byType.spelling += r.spellingCount;
        byType.grammar += r.grammarCount;
        byType.context += r.contextCount;
        byType.regulatory += r.regulatoryCount;
        byType.marketing += r.marketingCount;
        byType.brand += r.brandCount;
      }
    }

    return { averageScore, reviewedCount: reviewed, criticalFindings, ...byType };
    });
    res.json(payload);
  },
);

export default router;
