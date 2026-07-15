import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

// A saved AI Workspace conversation. Conversations are owned by a single user
// (userId) and scoped to an organization. They are an ENHANCEMENT layered on top
// of the existing stateless assistant panel — the panel keeps working without
// ever touching these tables. Persistence here powers conversation history,
// search, favorites, specialist personas and (later phases) linked-record and
// action context.
export const aiConversationsTable = pgTable(
  "ai_conversations",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(
      () => organizationsTable.id,
    ),
    // The owning user (internal users.id). Conversations are private to their
    // owner; every read must filter by userId in addition to organizationId.
    userId: integer("user_id").notNull(),
    title: text("title").notNull().default("New conversation"),
    // Specialist persona key (see api-server specialists module). "general"
    // reproduces the current assistant behavior.
    specialist: text("specialist").notNull().default("general"),
    favorite: boolean("favorite").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    // Optional linked platform record that scopes the conversation's context
    // (validated against the caller's org at write time). Type is one of the
    // concrete validatable kinds: package | report | task.
    linkedRecordType: text("linked_record_type"),
    linkedRecordId: integer("linked_record_id"),
    linkedRecordLabel: text("linked_record_label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ai_conversations_org_user_idx").on(t.organizationId, t.userId),
    index("ai_conversations_updated_idx").on(t.updatedAt),
  ],
);

export type AiConversationRow = typeof aiConversationsTable.$inferSelect;
export type InsertAiConversation = typeof aiConversationsTable.$inferInsert;

// A single message within a conversation. Assistant messages may carry tool
// suggestions and attachments (same shapes the existing panel renders), stored
// as jsonb so the Workspace can re-render historical turns faithfully.
export const aiConversationMessagesTable = pgTable(
  "ai_conversation_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => aiConversationsTable.id),
    organizationId: integer("organization_id"),
    // "user" | "assistant"
    role: text("role").notNull(),
    content: text("content").notNull().default(""),
    // AssistantToolSuggestion[] captured for assistant turns (nullable).
    suggestions: jsonb("suggestions"),
    // Arbitrary attachment metadata echoed back for rendering (nullable).
    attachments: jsonb("attachments"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ai_conversation_messages_conv_idx").on(
      t.conversationId,
      t.createdAt,
    ),
  ],
);

export type AiConversationMessageRow =
  typeof aiConversationMessagesTable.$inferSelect;
export type InsertAiConversationMessage =
  typeof aiConversationMessagesTable.$inferInsert;
