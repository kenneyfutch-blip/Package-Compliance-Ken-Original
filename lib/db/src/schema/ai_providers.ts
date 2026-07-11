import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const aiProvidersTable = pgTable(
  "ai_providers",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    // "openai" | "openrouter" | "custom" — all OpenAI-compatible chat completions
    providerType: text("provider_type").notNull().default("openai"),
    model: text("model").notNull(),
    // Optional per-tier model overrides. Standard tier always uses `model`.
    // When null, fast/reasoning fall back to the managed default (managed
    // provider) or to `model` (custom single-model provider).
    fastModel: text("fast_model"),
    reasoningModel: text("reasoning_model"),
    baseUrl: text("base_url"),
    // Encrypted at rest (AES-256-GCM). Never returned to the client.
    apiKey: text("api_key"),
    // Last 4 chars of the plaintext key, for masked display only.
    keyLast4: text("key_last4"),
    // The built-in Replit-managed OpenAI provider (uses env credentials, no stored key).
    managed: boolean("managed").notNull().default(false),
    active: boolean("active").notNull().default(false),
    // "connected" | "error" | "unknown"
    status: text("status").notNull().default("unknown"),
    statusMessage: text("status_message"),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // At most one active provider at a time.
    oneActive: uniqueIndex("ai_providers_one_active")
      .on(table.active)
      .where(sql`${table.active}`),
  }),
);

export type AiProvider = typeof aiProvidersTable.$inferSelect;
export type InsertAiProvider = typeof aiProvidersTable.$inferInsert;
