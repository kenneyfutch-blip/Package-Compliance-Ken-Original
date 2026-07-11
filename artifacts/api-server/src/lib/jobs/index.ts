import { logger } from "../logger";
import {
  ESCALATION_SWEEP_TYPE,
  SWEEP_INTERVAL_MS,
  runEscalationSweep,
} from "../reviews/escalation";
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

  startJobWorker();

  try {
    await ensureScheduledJob({ type: ESCALATION_SWEEP_TYPE });
  } catch (err) {
    logger.error({ err }, "Failed to schedule escalation sweep");
  }
}
