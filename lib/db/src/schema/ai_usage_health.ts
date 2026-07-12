import { pgTable, text, bigint, integer, timestamp } from "drizzle-orm/pg-core";

// Fleet-wide AI usage-write health.
//
// The usage-write health signal (see api-server ai-usage.ts) is a per-process,
// in-memory counter: it only reflects the instance that happens to answer
// `GET /ai-usage/health`. With more than one API instance running, an admin can
// hit a healthy process while another is silently dropping telemetry writes, so
// under-reporting would go unnoticed.
//
// To make the signal fleet-wide, every instance periodically flushes its local
// counters into its OWN row here (keyed by a per-process instance id), and the
// health endpoint aggregates across all recently-seen instances. Writes are a
// cheap, throttled heartbeat off the AI path — never on the request/AI critical
// path — so this adds no latency to AI responses.
export const aiUsageWriteHealthTable = pgTable("ai_usage_write_health", {
  // Per-process instance id (e.g. "instance-<pid>-<rand>"). One row per running
  // API instance; stale rows (from restarted/dead instances) are ignored by the
  // aggregator via an updatedAt freshness window.
  instanceId: text("instance_id").primaryKey(),
  // Cumulative counters for this instance's current lifetime. bigint so a
  // long-lived, high-throughput instance never overflows.
  successes: bigint("successes", { mode: "number" }).notNull().default(0),
  failures: bigint("failures", { mode: "number" }).notNull().default(0),
  // Failed writes since this instance's last successful write. > 0 means this
  // instance is currently unhealthy.
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  lastFailureMessage: text("last_failure_message"),
  // Heartbeat timestamp; the aggregator only counts instances updated recently.
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AiUsageWriteHealthRow = typeof aiUsageWriteHealthTable.$inferSelect;
export type InsertAiUsageWriteHealth =
  typeof aiUsageWriteHealthTable.$inferInsert;
