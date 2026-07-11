import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
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
});

export type JobRow = typeof jobsTable.$inferSelect;
export type InsertJob = typeof jobsTable.$inferInsert;
