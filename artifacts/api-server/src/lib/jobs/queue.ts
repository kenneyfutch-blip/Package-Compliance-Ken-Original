import { db, jobsTable, type JobRow } from "@workspace/db";
import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm";

export interface EnqueueInput {
  type: string;
  payload?: Record<string, unknown>;
  organizationId?: number | null;
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  dedupeKey?: string;
}

// Append a job to the durable queue.
export async function enqueueJob(input: EnqueueInput): Promise<JobRow> {
  const [row] = await db
    .insert(jobsTable)
    .values({
      type: input.type,
      payload: input.payload ?? {},
      organizationId: input.organizationId ?? null,
      runAt: input.runAt ?? new Date(),
      priority: input.priority ?? 0,
      maxAttempts: input.maxAttempts ?? 3,
      dedupeKey: input.dedupeKey ?? null,
    })
    .returning();
  return row!;
}

// Enqueue a job of `type` only if there is no pending/running one already. Used
// to guarantee a single live recurring job (e.g. the escalation sweep) survives
// restarts without piling up duplicates.
export async function ensureScheduledJob(input: EnqueueInput): Promise<void> {
  const [existing] = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.type, input.type),
        or(eq(jobsTable.status, "pending"), eq(jobsTable.status, "running")),
      ),
    )
    .limit(1);
  if (existing) return;
  await enqueueJob(input);
}

// Enqueue a job only if none of `type` is already *pending*. Unlike
// ensureScheduledJob this ignores "running" rows, so a recurring handler can
// schedule its own next run while it is itself still running — without piling up
// duplicates if a prior run already enqueued the next one (e.g. after a crash +
// stale-job requeue replays the handler).
export async function ensurePendingJob(input: EnqueueInput): Promise<void> {
  const [existing] = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(eq(jobsTable.type, input.type), eq(jobsTable.status, "pending")))
    .limit(1);
  if (existing) return;
  await enqueueJob(input);
}

// Atomically claim the next due job using row-level locking so multiple workers
// (or multiple restarts) never run the same job twice.
export async function claimNextJob(workerId: string): Promise<JobRow | null> {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(and(eq(jobsTable.status, "pending"), lte(jobsTable.runAt, new Date())))
      .orderBy(desc(jobsTable.priority), asc(jobsTable.runAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    const [claimed] = await tx
      .update(jobsTable)
      .set({
        status: "running",
        lockedAt: new Date(),
        lockedBy: workerId,
        attempts: sql`${jobsTable.attempts} + 1`,
      })
      .where(eq(jobsTable.id, candidate.id))
      .returning();
    return claimed ?? null;
  });
}

export async function markJobCompleted(
  id: number,
  result: Record<string, unknown> | null,
): Promise<void> {
  await db
    .update(jobsTable)
    .set({ status: "completed", result, lockedAt: null, lockedBy: null })
    .where(eq(jobsTable.id, id));
}

// Fail a job: retry with exponential backoff while attempts remain, otherwise
// mark it permanently failed.
export async function markJobFailed(job: JobRow, error: string): Promise<void> {
  if (job.attempts < job.maxAttempts) {
    const backoffMs = Math.min(5 * 60_000, 2 ** job.attempts * 5_000);
    await db
      .update(jobsTable)
      .set({
        status: "pending",
        lastError: error,
        runAt: new Date(Date.now() + backoffMs),
        lockedAt: null,
        lockedBy: null,
      })
      .where(eq(jobsTable.id, job.id));
  } else {
    await db
      .update(jobsTable)
      .set({ status: "failed", lastError: error, lockedAt: null, lockedBy: null })
      .where(eq(jobsTable.id, job.id));
  }
}

// Recover jobs left "running" by a crashed/restarted worker so they can be
// retried instead of being stuck forever.
export async function requeueStaleJobs(olderThanMs = 5 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const rows = await db
    .update(jobsTable)
    .set({ status: "pending", lockedAt: null, lockedBy: null })
    .where(and(eq(jobsTable.status, "running"), lte(jobsTable.lockedAt, cutoff)))
    .returning({ id: jobsTable.id });
  return rows.length;
}
