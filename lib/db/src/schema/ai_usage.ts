import {
  pgTable,
  serial,
  text,
  integer,
  real,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

// Per-request AI usage & cost ledger. One row is written for every real model
// invocation (cache hits incur no tokens/cost and are not logged). Writes are
// fire-and-forget and must never block or fail the underlying AI response, so
// organizationId/userId are nullable (a request made outside an auth context —
// e.g. seeding — still records model/token/cost telemetry).
export const aiUsageTable = pgTable(
  "ai_usage",
  {
    id: serial("id").primaryKey(),
    // Opaque per-request id (uuid) for correlation/debugging.
    requestId: text("request_id").notNull(),
    organizationId: integer("organization_id").references(
      () => organizationsTable.id,
    ),
    userId: integer("user_id"),
    // The AI workload / operation (e.g. packaging_analysis, language_review,
    // ocr, copilot, field_extraction, version_compare).
    workload: text("workload").notNull(),
    // Friendly compliance review type label, when the caller supplies one.
    reviewType: text("review_type"),
    model: text("model").notNull(),
    // Resolved tier: fast | standard | reasoning (null for non-tiered calls
    // where the tier is not meaningful).
    tier: text("tier"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    // Estimated cost in USD (rate-card estimate, not billed spend).
    costUsd: real("cost_usd").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    success: boolean("success").notNull().default(true),
    errorMessage: text("error_message"),
    // Compliance risk score (0-100) for workloads that produce one.
    riskScore: real("risk_score"),
    // Model confidence (0-100) for workloads that produce one.
    confidence: real("confidence"),
    // Whether a tier escalation was triggered for this request.
    escalated: boolean("escalated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Reads are org-scoped and time-ordered (spend/volume over time); retention
    // sweeps range-scan by createdAt.
    index("idx_ai_usage_org_created").on(t.organizationId, t.createdAt),
    index("idx_ai_usage_org_workload").on(t.organizationId, t.workload),
    index("idx_ai_usage_org_model").on(t.organizationId, t.model),
  ],
);

export type AiUsageRow = typeof aiUsageTable.$inferSelect;
export type InsertAiUsage = typeof aiUsageTable.$inferInsert;
