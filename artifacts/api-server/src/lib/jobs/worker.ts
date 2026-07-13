import { randomUUID } from "node:crypto";
import type { JobRow } from "@workspace/db";
import { logger } from "../logger";
import {
  claimNextJob,
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
let started = false;

async function runOne(): Promise<boolean> {
  const job = await claimNextJob(WORKER_ID);
  if (!job) return false;
  const handler = handlers.get(job.type);
  if (!handler) {
    await markJobFailed(job, `No handler registered for job type "${job.type}"`);
    logger.warn({ jobId: job.id, type: job.type }, "No handler for job type");
    return true;
  }
  try {
    const result = await handler(job);
    await markJobCompleted(job.id, result ?? null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markJobFailed(job, message);
    logger.error({ err, jobId: job.id, type: job.type }, "Job failed");
  }
  return true;
}

// Drain all currently-due jobs, then wait for the next poll tick.
async function tick(): Promise<void> {
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
  void requeueStaleJobs()
    .then((n) => {
      if (n > 0) logger.info({ requeued: n }, "Requeued stale jobs");
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
