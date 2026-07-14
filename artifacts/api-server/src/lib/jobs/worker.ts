import { randomUUID } from "node:crypto";
import type { JobRow } from "@workspace/db";
import { logger } from "../logger";
import {
  claimNextJob,
  heartbeatJob,
  markJobCompleted,
  markJobFailed,
  requeueStaleJobs,
} from "./queue";

// A job handler receives the claimed job and returns an optional result payload.
export type JobHandler = (
  job: JobRow,
) => Promise<Record<string, unknown> | null | void>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler);
}

const WORKER_ID = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
const POLL_INTERVAL_MS = 10_000;
// While a job runs, refresh its lock this often so the stale-job reclaim below
// can tell a live long-running job apart from one abandoned by a dead worker.
const HEARTBEAT_INTERVAL_MS = 30_000;
// A running job whose lock hasn't been refreshed within this window is treated
// as abandoned and requeued. Must comfortably exceed HEARTBEAT_INTERVAL_MS
// (several missed beats) so an active job — or one running on another instance
// when scaled out — is never reclaimed out from under a live worker.
const STALE_JOB_MS = 120_000;
let started = false;

async function runOne(): Promise<boolean> {
  const job = await claimNextJob(WORKER_ID);
  if (!job) return false;
  const handler = handlers.get(job.type);
  if (!handler) {
    await markJobFailed(job, `No handler registered for job type "${job.type}"`, WORKER_ID);
    logger.warn({ jobId: job.id, type: job.type }, "No handler for job type");
    return true;
  }
  // Keep the lock fresh for the duration of the handler so a slow (e.g.
  // reasoning-tier) analysis isn't mistaken for a stranded job and requeued.
  const heartbeat = setInterval(() => {
    void heartbeatJob(job.id, WORKER_ID).catch((err) =>
      logger.error({ err, jobId: job.id }, "Job heartbeat failed"),
    );
  }, HEARTBEAT_INTERVAL_MS);
  if (typeof heartbeat.unref === "function") heartbeat.unref();
  try {
    const result = await handler(job);
    const wrote = await markJobCompleted(job.id, result ?? null, WORKER_ID);
    if (!wrote) {
      logger.warn(
        { jobId: job.id, type: job.type },
        "Lost job ownership before completion (reclaimed by another worker); skipping terminal write",
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const wrote = await markJobFailed(job, message, WORKER_ID);
    if (!wrote) {
      logger.warn(
        { jobId: job.id, type: job.type },
        "Lost job ownership before failure could be recorded (reclaimed by another worker)",
      );
    }
    logger.error({ err, jobId: job.id, type: job.type }, "Job failed");
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}

// Drain all currently-due jobs, then wait for the next poll tick.
async function tick(): Promise<void> {
  // Recover jobs abandoned by a crashed/restarted worker BEFORE draining, so a
  // stranded job — and any package stuck in its "AI Review" holding state —
  // heals within a couple of minutes instead of waiting for the next restart.
  try {
    const requeued = await requeueStaleJobs(STALE_JOB_MS);
    if (requeued > 0) logger.warn({ requeued }, "Requeued stale jobs");
  } catch (err) {
    logger.error({ err }, "Stale-job reclaim failed");
  }
  try {
    // Process due jobs until the queue is momentarily empty (bounded per tick).
    for (let i = 0; i < 25; i++) {
      const ran = await runOne();
      if (!ran) break;
    }
  } catch (err) {
    logger.error({ err }, "Job worker tick error");
  }
}

// Start the in-process background job worker. Idempotent — safe to call once at
// server startup. Recovers stale in-flight jobs from a previous run first.
export function startJobWorker(): void {
  if (started) return;
  started = true;
  // Recover anything the previous process left mid-flight. Uses the same window
  // as the periodic sweep so a fast restart never yanks a job still running on
  // another instance (scale-out); the periodic tick catches the rest.
  void requeueStaleJobs(STALE_JOB_MS)
    .then((n) => {
      if (n > 0) logger.info({ requeued: n }, "Requeued stale jobs at startup");
    })
    .catch((err) => logger.error({ err }, "Failed to requeue stale jobs"));

  const loop = () => {
    void tick().finally(() => {
      setTimeout(loop, POLL_INTERVAL_MS);
    });
  };
  setTimeout(loop, 2_000);
  logger.info({ workerId: WORKER_ID }, "Background job worker started");
}

// Wake the worker to drain due jobs immediately instead of waiting for the next
// poll tick — used right after enqueuing a latency-sensitive job (e.g. package
// analysis) so results start landing without the poll delay. No-op until the
// worker has been started.
export function pokeJobWorker(): void {
  if (!started) return;
  void tick();
}
