import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { aiConversationsTable } from "./ai_conversations";

// A state-changing action the AI Workspace has PROPOSED to the user and is
// awaiting an explicit confirm/cancel decision on. This is the authoritative
// record for the confirmation protocol: the confirm endpoint re-derives the
// action name and parameters from THIS row (never from the client body), so a
// proposal cannot be forged or its parameters tampered with after the fact.
//
// Rows are owned by a single user and scoped to an organization, mirroring the
// conversation they belong to. Non-sensitive (read-only/derived) outputs are
// NOT recorded here — they execute inline during the stream and never need a
// gate.
export const workspaceActionProposalsTable = pgTable(
  "workspace_action_proposals",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => aiConversationsTable.id),
    organizationId: integer("organization_id"),
    // The owning user (internal users.id). A proposal can only be confirmed or
    // cancelled by its owner, within its organization.
    userId: integer("user_id").notNull(),
    // The assistant message that surfaced this proposal (for re-rendering the
    // confirm card on conversation reload). Nullable to tolerate ordering.
    messageId: integer("message_id"),
    // Registry action name (validated against the server-side action registry at
    // confirm time; an unknown name is rejected).
    actionName: text("action_name").notNull(),
    // The exact parameters the action will run with, as proposed. Authoritative:
    // the confirm handler executes with these, not with anything the client sends.
    params: jsonb("params").notNull(),
    // Human-readable summary of exactly what will happen, shown in the card.
    summary: text("summary").notNull(),
    // pending | executed | cancelled | failed
    status: text("status").notNull().default("pending"),
    // Reference to the created/updated record after a successful execution:
    // { kind, id, label, href }. Nullable until executed.
    resultRef: jsonb("result_ref"),
    // Human-readable result text appended to the conversation after execution.
    resultText: text("result_text"),
    // Failure detail when status = failed.
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    index("workspace_action_proposals_conv_idx").on(t.conversationId),
    index("workspace_action_proposals_owner_idx").on(
      t.organizationId,
      t.userId,
    ),
  ],
);

export type WorkspaceActionProposalRow =
  typeof workspaceActionProposalsTable.$inferSelect;
export type InsertWorkspaceActionProposal =
  typeof workspaceActionProposalsTable.$inferInsert;
