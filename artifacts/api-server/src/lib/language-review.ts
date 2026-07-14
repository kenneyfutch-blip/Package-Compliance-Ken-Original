import {
  db,
  packagesTable,
  regulationsTable,
  languageReviewsTable,
  languageFindingsTable,
  glossaryEntriesTable,
  type PackageRow,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { analyzeLanguage, type LanguageReviewResult } from "./language-ai";
import { writeSystemAudit } from "./audit";
import { logger } from "./logger";

// Shared, request-free core of the AI Language Review Engine so both the HTTP
// route (manual "Language Review" / re-run button) and the background upload
// analysis job persist reviews through a single, latest-only transaction. Keeping
// one persistence path is critical: divergent copies could leave a package with a
// mix of old and new findings.

export async function loadLanguageRegulations() {
  return db.select().from(regulationsTable);
}

// The org's active Approved Language & Glossary entries, fed to the review engine
// so it reasons against authoritative wording.
export async function loadApprovedLanguage(organizationId: number) {
  return db
    .select()
    .from(glossaryEntriesTable)
    .where(
      and(
        eq(glossaryEntriesTable.organizationId, organizationId),
        eq(glossaryEntriesTable.status, "active"),
      ),
    );
}

export interface PersistedLanguageReview {
  reviewId: number;
  findingCount: number;
  criticalCount: number;
  regulationRefs: string[];
}

// Persist a language review result: replace prior findings, write the review
// aggregate, and denormalize the score onto the package — all atomically so a
// concurrent re-run can never leave a mix of old and new rows (latest-only).
// Does NOT write the audit event; the caller writes it with the appropriate
// actor identity (real user for the HTTP route, system actor for the job).
export async function persistLanguageReviewCore(
  pkg: PackageRow,
  result: LanguageReviewResult,
  organizationId: number,
): Promise<PersistedLanguageReview> {
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

  const regulationRefs = Array.from(
    new Set(
      result.findings
        .map((f) => f.regulationReference)
        .filter((r): r is string => Boolean(r)),
    ),
  );

  return {
    reviewId,
    findingCount: result.findings.length,
    criticalCount: counts.critical,
    regulationRefs,
  };
}

// The analysis inputs the engine reasons against. Loaded once and optionally
// passed into analyzeAndPersistLanguageReview so bulk runs don't reload per item.
export async function loadLanguageContext(organizationId: number) {
  const [regulations, approvedLanguage] = await Promise.all([
    loadLanguageRegulations(),
    loadApprovedLanguage(organizationId),
  ]);
  return { regulations, approvedLanguage };
}

export interface LanguageReviewRun {
  result: LanguageReviewResult;
  persisted: PersistedLanguageReview;
}

// Single shared orchestration: load context (unless supplied), run the engine,
// and persist (latest-only). Does NOT write audit — the caller writes it with the
// appropriate actor identity (real user for the HTTP route, system for the job).
// Both the manual "Language Review" route and the background upload job go through
// here so their regulation/glossary loading and analysis inputs can never diverge.
export async function analyzeAndPersistLanguageReview(
  pkg: PackageRow,
  organizationId: number,
  ctx?: Awaited<ReturnType<typeof loadLanguageContext>>,
): Promise<LanguageReviewRun> {
  const { regulations, approvedLanguage } =
    ctx ?? (await loadLanguageContext(organizationId));
  const result = await analyzeLanguage(pkg, regulations, approvedLanguage);
  const persisted = await persistLanguageReviewCore(pkg, result, organizationId);
  return { result, persisted };
}

// Full request-free language review for a single package, used by the background
// upload analysis job so spelling/grammar/etc. are ready on first upload without
// a manual re-run. Returns null when there is no extracted text to review.
export async function runLanguageReview(params: {
  pkg: PackageRow;
  organizationId: number;
  actor?: string;
}): Promise<PersistedLanguageReview | null> {
  const { pkg, organizationId, actor } = params;
  if (!pkg.extractedText?.trim()) return null;

  const { result, persisted } = await analyzeAndPersistLanguageReview(
    pkg,
    organizationId,
  );

  await writeSystemAudit(organizationId, {
    action: "Language review completed",
    entityType: "language_review",
    entityId: persisted.reviewId,
    packageId: pkg.id,
    actor: actor ?? "System",
    detail: `Language score ${result.score}, ${persisted.findingCount} finding(s) (${persisted.criticalCount} critical).`,
    regulationRefs: persisted.regulationRefs,
  }).catch((err) =>
    logger.error({ err, packageId: pkg.id }, "Language review audit write failed"),
  );

  return persisted;
}
