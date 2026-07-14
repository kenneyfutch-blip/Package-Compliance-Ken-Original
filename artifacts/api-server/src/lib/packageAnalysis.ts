import { db, packagesTable, type PackageRow, type JobRow } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  loadRegulations,
  ensureInitialVersion,
  applyAnalysis,
} from "./packageService";
import { analyzePackaging } from "./ai";
import { runExtraction } from "./document-ai/service";
import { retrieveRelevantPolicies, formatPoliciesForPrompt } from "./policies/engine";
import {
  retrieveSimilarFindings,
  packageQueryText,
  formatMemoryForPrompt,
} from "./memory/engine";
import { gatherEcfrIntelligence, formatEcfrForPrompt } from "./ecfr";
import { autoAssignReview } from "./reviews/engine";
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
    try {
      await runExtraction({ pkg, organizationId: p.organizationId });
      const [refreshed] = await db
        .select()
        .from(packagesTable)
        .where(eq(packagesTable.id, pkg.id));
      if (refreshed) {
        pkg = refreshed;
        text = refreshed.extractedText?.trim();
      }
    } catch (err) {
      logger.error({ err, packageId: pkg.id }, "Background OCR failed");
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

  return {
    analyzed: true,
    complianceStatus: result.complianceStatus,
    riskScore: result.riskScore,
  };
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
