import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

// Personal access tokens for the MCP (Model Context Protocol) gateway.
// A token acts AS a specific user in a specific organization — never a
// god-token. Only a SHA-256 hash is stored; the plaintext is shown exactly
// once at creation. Revocation is a soft timestamp so the row (and its
// audit linkage) is never destroyed.
export const mcpTokensTable = pgTable(
  "mcp_tokens",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    // First characters of the plaintext (e.g. "mcp_ab12…") so users can tell
    // tokens apart in the UI without the secret ever being stored.
    tokenPrefix: text("token_prefix").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_mcp_tokens_hash").on(t.tokenHash),
    index("idx_mcp_tokens_user").on(t.userId),
  ],
);

// Consumed confirmation tokens for sensitive MCP actions. A confirmation
// token is single-use: execution atomically inserts its hash here (unique
// index), and a second attempt with the same token conflicts and is refused.
// Rows are prunable once past expiry; DB-backed so the guarantee survives
// restarts and holds across multiple server instances.
export const mcpConfirmationsUsedTable = pgTable(
  "mcp_confirmations_used",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: integer("user_id").notNull(),
    action: text("action").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_mcp_confirmations_hash").on(t.tokenHash),
    index("idx_mcp_confirmations_expires").on(t.expiresAt),
  ],
);

// Per-tool-call audit ledger for AI tool access — every tool invocation from
// the MCP gateway AND the in-app AI Workspace is recorded here: who, which
// tool, which tenant, the inputs, whether permission checks passed, and the
// outcome. Complements (does not replace) the append-only audit_events trail.
export const mcpToolCallsTable = pgTable(
  "mcp_tool_calls",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id),
    userId: integer("user_id").notNull(),
    // "mcp" (external gateway) or "workspace" (in-app AI agent).
    source: text("source").notNull(),
    tool: text("tool").notNull(),
    args: jsonb("args").$type<Record<string, unknown>>().notNull().default({}),
    permissionOk: boolean("permission_ok").notNull(),
    success: boolean("success").notNull(),
    // Size of the returned payload (chars), never the payload itself — results
    // can contain org data and the ledger must stay cheap to retain.
    resultChars: integer("result_chars"),
    errorText: text("error_text"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_mcp_calls_org_created").on(t.organizationId, t.createdAt),
    index("idx_mcp_calls_user").on(t.userId),
    index("idx_mcp_calls_tool").on(t.tool),
  ],
);
