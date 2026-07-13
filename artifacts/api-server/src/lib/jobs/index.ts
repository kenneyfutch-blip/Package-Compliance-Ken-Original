import { logger } from "../logger";
import {
  ESCALATION_SWEEP_TYPE,
  SWEEP_INTERVAL_MS,
  runEscalationSweep,
} from "../reviews/escalation";
import {
  ECFR_SYNC_TYPE,
  ECFR_SYNC_INTERVAL_MS,
  runEcfrSync,
} from "../ecfr/sync";
import {
  PRESENCE_SWEEP_TYPE,
  PRESENCE_SWEEP_INTERVAL_MS,
  sweepPresenceAndLocks,
} from "../reviews/presence";
import {
  PACKAGE_ANALYSIS_TYPE,
  handlePackageAnalysisJob,
} from "../packageAnalysis";
import { ensurePendingJob, ensureScheduledJob } from "./queue";
import { registerJobHandler, startJobWorker } from "./worker";

export { enqueueJob } from "./queue";

// Register handlers, start the worker, and make sure the recurring escalation
// sweep is scheduled. Called once at server startup. Each sweep re-enqueues the
// next one, so a single pending job is enough to keep the cadence going.
export async function initJobs(): Promise<void> {
  registerJobHandler(ESCALATION_SWEEP_TYPE, async () => {
    const result = await runEscalationSweep();
    // Idempotent reschedule: only enqueue the next sweep if one is not already
    // pending, so a replayed handler (crash + stale requeue) cannot stack them.
    await ensurePendingJob({
      type: ESCALATION_SWEEP_TYPE,
      runAt: new Date(Date.now() + SWEEP_INTERVAL_MS),
    });
    return result;
  });

  // Weekly eCFR content sync. Each run re-enqueues the next, mirroring the
  // escalation-sweep pattern, so a single pending job keeps the cadence going.
  registerJobHandler(ECFR_SYNC_TYPE, async () => {
    const result = await runEcfrSync();
    await ensurePendingJob({
      type: ECFR_SYNC_TYPE,
      runAt: new Date(Date.now() + ECFR_SYNC_INTERVAL_MS),
    });
    return {
      parts: result.parts,
      partsSynced: result.partsSynced,
      sectionsStored: result.sectionsStored,
      failures: result.failures,
      at: result.at,
    };
  });

  // Housekeeping sweep that prunes aged-out reviewer presence and expired
  // advisory review locks. Read paths are already staleness-guarded; this only
  // bounds table growth. Re-enqueues its own next run like the other sweeps.
  registerJobHandler(PRESENCE_SWEEP_TYPE, async () => {
    const result = await sweepPresenceAndLocks();
    await ensurePendingJob({
      type: PRESENCE_SWEEP_TYPE,
      runAt: new Date(Date.now() + PRESENCE_SWEEP_INTERVAL_MS),
    });
    return result;
  });

  // On-demand (non-recurring) job: full compliance analysis for a package,
  // enqueued when a package is created with artwork text so the upload can
  // return immediately instead of blocking on the AI analysis.
  registerJobHandler(PACKAGE_ANALYSIS_TYPE, handlePackageAnalysisJob);

  startJobWorker();

  try {
    await ensureScheduledJob({ type: ESCALATION_SWEEP_TYPE });
  } catch (err) {
    logger.error({ err }, "Failed to schedule escalation sweep");
  }

  try {
    // Schedule an initial sync shortly after startup so a fresh deploy populates
    // eCFR content without waiting a week; recurring runs are weekly thereafter.
    await ensureScheduledJob({
      type: ECFR_SYNC_TYPE,
      runAt: new Date(Date.now() + 30_000),
    });
  } catch (err) {
    logger.error({ err }, "Failed to schedule eCFR sync");
  }

  try {
    await ensureScheduledJob({
      type: PRESENCE_SWEEP_TYPE,
      runAt: new Date(Date.now() + PRESENCE_SWEEP_INTERVAL_MS),
    });
  } catch (err) {
    logger.error({ err }, "Failed to schedule presence sweep");
  }
}
