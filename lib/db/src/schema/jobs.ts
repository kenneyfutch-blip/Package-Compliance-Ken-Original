import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

// A durable background job. This table IS the queue: a poller claims due rows
// (status=pending, runAt<=now) with row-level locking, runs the registered
// handler for `type`, and records success/failure with bounded retries. Both the
// escalation sweep and any future async work (batch AI, report generation,
// regulatory syncs) ride on this.
export const jobsTable = pgTable("jobs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  // pending | running | completed | failed | canceled
  status: text("status").notNull().default("pending"),
  priority: integer("priority").notNull().default(0),
  // Scheduled earliest execution time; enables delays and retry backoff.
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: text("locked_by"),
  lastError: text("last_error"),
  result: jsonb("result").$type<Record<string, unknown> | null>(),
  // Optional key used to avoid enqueuing duplicate recurring jobs of a type.
  dedupeKey: text("dedupe_key"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (t) => [
  // Claim query: WHERE status='pending' AND run_at<=now() ORDER BY priority DESC, run_at ASC.
  index("idx_jobs_claim").on(t.status, t.priority.desc(), t.runAt.asc()),
  // Stale-job reclaim: WHERE status='running' AND locked_at <= cutoff.
  index("idx_jobs_reclaim").on(t.status, t.lockedAt),
  // ensureScheduledJob / ensurePendingJob dedupe lookups by type+status(+dedupe_key).
  index("idx_jobs_type_status").on(t.type, t.status),
  // Deep-health recency probe (updated_at >= cutoff LIMIT 1) + retention prune.
  index("idx_jobs_updated_at").on(t.updatedAt),
]);

export type JobRow = typeof jobsTable.$inferSelect;
export type InsertJob = typeof jobsTable.$inferInsert;
