import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// One run of the AI Workspace agent, recorded for the "Agent Activity" feed on
// the Workspace dashboard and for the audit trail. This is TELEMETRY about agent
// behavior — which provider/model answered, which tools it invoked, how many
// actions it proposed — NOT the conversation content, which lives in
// ai_conversation_messages.
//
// Org-scoped and owned by the initiating user (users.id), mirroring the
// conversation it belongs to. Rows are written fire-and-forget: a failed insert
// must never break the chat (see recordAgentRun), exactly like ai_usage.
export const workspaceAgentRunsTable = pgTable(
  "workspace_agent_runs",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id"),
    userId: integer("user_id"),
    // The conversation this run answered a turn for (nullable — the run is
    // meaningful telemetry even if the conversation is later deleted).
    conversationId: integer("conversation_id"),
    // Provider-agnostic agent identity: which registered provider answered
    // (e.g. "openai"). A future Claude provider records "anthropic" here without
    // any schema change.
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    specialist: text("specialist").notNull().default("general"),
    // succeeded | failed
    status: text("status").notNull().default("succeeded"),
    // Distinct read tools + actions the agent invoked this run, as a name array.
    toolsUsed: jsonb("tools_used"),
    citationCount: integer("citation_count").notNull().default(0),
    // How many state-changing actions the agent PROPOSED this run (proposals are
    // awaiting confirmation; this is not a count of executed actions).
    proposalCount: integer("proposal_count").notNull().default(0),
    durationMs: integer("duration_ms"),
    // Failure detail when status = failed.
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("workspace_agent_runs_org_idx").on(t.organizationId, t.createdAt),
    index("workspace_agent_runs_owner_idx").on(t.organizationId, t.userId),
  ],
);

export type WorkspaceAgentRunRow = typeof workspaceAgentRunsTable.$inferSelect;
export type InsertWorkspaceAgentRun =
  typeof workspaceAgentRunsTable.$inferInsert;
