import {
  db,
  packagesTable,
  reportsTable,
  violationsTable,
  type PackageRow,
  type JobRow,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { generateCompliancePdf } from "./compliancePdf";
import { ObjectStorageService } from "./objectStorage";
import { writeSystemAudit } from "./audit";
import {
  loadRegulations,
  ensureInitialVersion,
  applyAnalysis,
} from "./packageService";
import { analyzePackaging } from "./ai";
import { runExtraction, type ExtractionRunResult } from "./document-ai/service";
import { retrieveRelevantPolicies, formatPoliciesForPrompt } from "./policies/engine";
import {
  retrieveSimilarFindings,
  packageQueryText,
  formatMemoryForPrompt,
} from "./memory/engine";
import { gatherEcfrIntelligence, formatEcfrForPrompt } from "./ecfr";
import { autoAssignReview } from "./reviews/engine";
import { runLanguageReview } from "./language-review";
import { matchTeamName } from "./reviews/routing";
import { enqueueJob } from "./jobs/queue";
import { pokeJobWorker } from "./jobs/worker";
import { logger } from "./logger";

export const PACKAGE_ANALYSIS_TYPE = "package.analysis";

export interface PackageAnalysisPayload {
  packageId: number;
  organizationId: number;
  // Restricts compliance-memory recall to this supplier's own findings when a
  // supplier user uploaded the package, so suggestions never echo another
  // supplier's data. null = full-org recall (internal staff upload).
  supplierId?: number | null;
  actorUserId?: number | null;
  actorName?: string;
  // true = the thorough "Deep Analysis" re-run (active engine, escalation-capable,
  // no time cap); false/undefined = fast triage (managed fast model, ~30s cap).
  deep?: boolean;
}

// The recall helpers below mirror the request-scoped versions in routes/packages.ts
// but take the org/supplier explicitly so they can run inside a background job,
// which has no Express request. Each is non-fatal — a recall miss must never
// block analysis.
async function loadPriorKnowledge(
  pkg: PackageRow,
  organizationId: number,
  supplierId: number | null,
): Promise<string | undefined> {
  try {
    const similar = await retrieveSimilarFindings({
      organizationId,
      queryText: packageQueryText(pkg),
      limit: 6,
      excludePackageId: pkg.id,
      supplierId,
    });
    return formatMemoryForPrompt(similar) || undefined;
  } catch (err) {
    logger.error({ err }, "Compliance memory recall failed (job)");
    return undefined;
  }
}

async function loadInternalStandards(
  pkg: PackageRow,
  organizationId: number,
): Promise<string | undefined> {
  try {
    const policies = await retrieveRelevantPolicies({
      organizationId,
      queryText: packageQueryText(pkg),
      limit: 8,
    });
    return formatPoliciesForPrompt(policies) || undefined;
  } catch (err) {
    logger.error({ err }, "Internal policy recall failed (job)");
    return undefined;
  }
}

async function loadCfrRegulations(pkg: PackageRow): Promise<string | undefined> {
  try {
    const intel = await gatherEcfrIntelligence(pkg);
    return formatEcfrForPrompt(intel.sections) || undefined;
  } catch (err) {
    logger.error({ err }, "eCFR recall failed (job)");
    return undefined;
  }
}

export interface PackageAnalysisResult {
  analyzed: boolean;
  complianceStatus?: string;
  riskScore?: number;
}

// Full compliance analysis for a single package, independent of any HTTP request
// so it can run in the background job worker. Loads the four analysis inputs in
// parallel, runs the (potentially slow, escalation-capable) AI analysis, persists
// it, then routes the package to a review team at the correct priority.
export async function runPackageAnalysis(
  p: PackageAnalysisPayload,
): Promise<PackageAnalysisResult> {
  let [pkg] = await db
    .select()
    .from(packagesTable)
    .where(eq(packagesTable.id, p.packageId));
  if (!pkg) throw new Error(`Package ${p.packageId} not found`);
  // Tenancy guard: the job payload org must match the package's own org before we
  // recall memory/policies or persist analysis under that organization.
  if (pkg.organizationId != null && pkg.organizationId !== p.organizationId) {
    throw new Error(
      `Package ${p.packageId} organization mismatch (payload ${p.organizationId})`,
    );
  }

  let text = pkg.extractedText?.trim();
  // No client-supplied text (a scanned/flattened PDF or an image with no
  // selectable text layer). Read the artwork with the OCR provider NOW — this is
  // the slow step deliberately kept OUT of the upload request so uploads stay
  // fast. Runs req-free via the explicit organizationId.
  if (!text) {
    let run: ExtractionRunResult | undefined;
    try {
      run = await runExtraction({ pkg, organizationId: p.organizationId });
      const [refreshed] = await db
        .select()
        .from(packagesTable)
        .where(eq(packagesTable.id, pkg.id));
      if (refreshed) {
        pkg = refreshed;
        text = refreshed.extractedText?.trim();
      }
    } catch (err) {
      // OCR threw (object-store read blip, network, provider runtime error).
      // Never swallow it — re-throw so the durable job queue retries with
      // backoff. Swallowing strands the package needing a manual Reprocess.
      logger.error(
        { err, packageId: pkg.id },
        "Background OCR threw; letting the job queue retry",
      );
      throw err instanceof Error ? err : new Error(String(err));
    }
    // OCR returned but produced no text. Distinguish transient from permanent:
    //  - Failed  = provider errored AFTER the source was resolved → always retry.
    //  - Skipped = the source couldn't be resolved. Only retry when the artwork
    //    is a stored object ("/objects/...") that *should* resolve — a transient
    //    object-store read / upload-vs-analyze race (the case that was stranding
    //    packages for a manual Reprocess). Remote, data-URL, or absent artwork
    //    resolve to Skipped permanently (SSRF-blocked or nothing to fetch), so
    //    retrying can't help — those fall through to the manual-review routing.
    // Throwing lets handlePackageAnalysisJob retry up to maxAttempts, then route
    // to manual review. NotConfigured / Unsupported are permanent (fall through).
    const storedArtwork = (pkg.artworkUrl ?? "").startsWith("/objects/");
    if (
      !text &&
      (run?.outcome === "Failed" ||
        (run?.outcome === "Skipped" && storedArtwork))
    ) {
      throw new Error(
        `Background OCR produced no text for package ${pkg.id} (outcome=${run.outcome}); retrying via job queue`,
      );
    }
  }
  if (!text) {
    // Still nothing readable after OCR: don't strand the package in "AI Review".
    // Route it for manual handling instead of retrying analysis forever.
    logger.warn(
      { packageId: pkg.id },
      "Package analysis skipped: no extracted text after OCR",
    );
    await db
      .update(packagesTable)
      .set({ status: "Needs Review" })
      .where(eq(packagesTable.id, pkg.id))
      .catch(() => {});
    try {
      await autoAssignReview({
        organizationId: p.organizationId,
        packageId: pkg.id,
        category: pkg.category,
        teamName: matchTeamName(pkg.category),
        priority: "normal",
        actorUserId: p.actorUserId ?? null,
        actorName: p.actorName ?? "System",
        packageName: pkg.name,
      });
    } catch (err) {
      logger.error(
        { err, packageId: pkg.id },
        "Auto-assignment after empty OCR failed",
      );
    }
    return { analyzed: false };
  }

  const [regulations, priorKnowledge, internalStandards, cfrRegulations] =
    await Promise.all([
      loadRegulations(),
      loadPriorKnowledge(pkg, p.organizationId, p.supplierId ?? null),
      loadInternalStandards(pkg, p.organizationId),
      loadCfrRegulations(pkg),
    ]);

  const result = await analyzePackaging(
    pkg,
    regulations,
    priorKnowledge,
    internalStandards,
    cfrRegulations,
    { deep: p.deep ?? false },
  );
  const version = await ensureInitialVersion(pkg);
  await applyAnalysis(pkg, result, version.id, p.organizationId);

  // Route to a team now that criticality is known. Mirrors applyAnalysis's own
  // critical-count logic so a Critical finding lands the review at top priority.
  const criticalCount = result.violations.filter(
    (v) =>
      (v.findingClass === "issue" || v.findingClass === "warning") &&
      v.severity === "critical",
  ).length;
  const category = result.category ?? pkg.category;
  try {
    await autoAssignReview({
      organizationId: p.organizationId,
      packageId: pkg.id,
      category,
      teamName: matchTeamName(category),
      priority: criticalCount > 0 ? "critical" : "normal",
      actorUserId: p.actorUserId ?? null,
      actorName: p.actorName ?? "System",
      packageName: pkg.name,
    });
  } catch (err) {
    logger.error({ err, packageId: pkg.id }, "Auto-assignment after analysis failed");
  }

  // Run the AI Language Review (spelling / grammar / context / regulatory /
  // marketing / brand) as part of the initial upload analysis so the Language
  // Quality panel is populated on first upload — no manual "Language Review"
  // re-run needed. Non-fatal: a language-review failure must never strand the
  // package or fail the compliance job that already succeeded above.
  try {
    await runLanguageReview({
      pkg,
      organizationId: p.organizationId,
      actor: p.actorName ?? "System",
    });
  } catch (err) {
    logger.error({ err, packageId: pkg.id }, "Background language review failed");
  }

  // Auto-file a compliance report the moment analysis finishes, so EVERY
  // upload shows up on the Reports page with a downloadable document — no one
  // has to remember to export. Non-fatal by design: the analysis already
  // succeeded, so a report hiccup must never fail the job (which would re-run
  // the whole — and billable — AI analysis).
  try {
    await autoGenerateComplianceReport(pkg.id, p.organizationId);
  } catch (err) {
    logger.error(
      { err, packageId: pkg.id },
      "Auto report generation after analysis failed",
    );
  }

  return {
    analyzed: true,
    complianceStatus: result.complianceStatus,
    riskScore: result.riskScore,
  };
}

// Build the same PDF the manual "Generate Report" flow produces, from the
// package's freshly-persisted analysis results, upload it to object storage,
// and file it on the Reports page. Req-free (runs inside the background job).
async function autoGenerateComplianceReport(
  packageId: number,
  organizationId: number,
): Promise<void> {
  // Re-read the package: applyAnalysis just updated grade/risk/summary and the
  // in-memory row predates that.
  const [pkg] = await db
    .select()
    .from(packagesTable)
    .where(eq(packagesTable.id, packageId));
  if (!pkg) return;
  const findings = await db
    .select()
    .from(violationsTable)
    .where(eq(violationsTable.packageId, packageId))
    .orderBy(desc(violationsTable.createdAt));
  const title = `Compliance Report - ${pkg.name}`;
  const pdfBytes = await generateCompliancePdf({
    title,
    generatedBy: "System (auto, post-analysis)",
    generatedAt: new Date(),
    pkg: {
      name: pkg.name,
      sku: pkg.sku,
      brand: pkg.brand,
      vendor: pkg.vendor,
      category: pkg.category,
      grade: pkg.grade,
      riskScore: pkg.riskScore,
      complianceStatus: pkg.complianceStatus,
      approvalStatus: pkg.approvalStatus,
      summary: pkg.summary,
    },
    findings: findings.map((v) => ({
      title: v.title,
      description: v.description,
      severity: v.severity,
      engine: v.engine,
      status: v.status,
      regulationRef: v.regulationRef,
      recommendation: v.recommendation,
      suggestedText: v.suggestedText,
      detectedText: v.detectedText,
      confidence: v.confidence,
      humanReviewRecommended: v.humanReviewRecommended,
      disclaimer: v.disclaimer,
    })),
  });
  const objectStorage = new ObjectStorageService();
  const uploadURL = await objectStorage.getObjectEntityUploadURL();
  const putResponse = await fetch(uploadURL, {
    method: "PUT",
    body: Buffer.from(pdfBytes),
    headers: { "Content-Type": "application/pdf" },
  });
  if (!putResponse.ok) {
    throw new Error(`Report upload failed: ${putResponse.status}`);
  }
  const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
  const [report] = await db
    .insert(reportsTable)
    .values({
      organizationId,
      packageId,
      title,
      type: "Compliance",
      format: "PDF",
      objectPath,
      summary:
        pkg.summary ??
        `Compliance report for ${pkg.name} with ${findings.length} finding(s) (grade ${pkg.grade ?? "N/A"}).`,
    })
    .returning();
  await writeSystemAudit(organizationId, {
    action: "Report generated",
    entityType: "report",
    entityId: report!.id,
    packageId,
    detail: `${title} (auto-generated after AI analysis).`,
  });
}

// Enqueue a durable background analysis job and wake the worker so it starts
// without waiting for the next poll tick.
export async function enqueuePackageAnalysis(
  p: PackageAnalysisPayload,
): Promise<void> {
  await enqueueJob({
    type: PACKAGE_ANALYSIS_TYPE,
    organizationId: p.organizationId,
    payload: { ...p },
    priority: 5,
  });
  pokeJobWorker();
}

// Worker handler. On permanent failure (last attempt), release the package from
// the "AI Review" holding state so it doesn't appear to analyze forever; the
// specialist can then re-run analysis manually.
export async function handlePackageAnalysisJob(
  job: JobRow,
): Promise<Record<string, unknown>> {
  const payload = job.payload as Partial<PackageAnalysisPayload> | null;
  if (
    !payload ||
    typeof payload.packageId !== "number" ||
    typeof payload.organizationId !== "number"
  ) {
    throw new Error("Invalid package.analysis payload");
  }
  try {
    const result = await runPackageAnalysis(payload as PackageAnalysisPayload);
    return { ...result };
  } catch (err) {
    if (job.attempts >= job.maxAttempts) {
      await db
        .update(packagesTable)
        .set({ status: "Needs Review" })
        .where(eq(packagesTable.id, payload.packageId))
        .catch(() => {});
    }
    throw err;
  }
}
