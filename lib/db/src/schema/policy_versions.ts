import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Immutable version history for internal policies. Each time a policy's document
// or rule text is superseded, the prior state is snapshotted here so the full
// lineage (metadata + rule text + document) and change notes are auditable.
export const policyVersionsTable = pgTable(
  "policy_versions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    policyId: integer("policy_id").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    category: text("category"),
    status: text("status"),
    summary: text("summary"),
    documentUrl: text("document_url"),
    fileName: text("file_name"),
    contentType: text("content_type"),
    extractedText: text("extracted_text"),
    effectiveDate: text("effective_date"),
    expirationDate: text("expiration_date"),
    changeNote: text("change_note"),
    createdBy: text("created_by"),
    createdById: text("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_polver_policy").on(t.policyId),
    index("idx_polver_org").on(t.organizationId),
    // A given policy can only snapshot each version number once. Prevents
    // concurrent publishes from producing duplicate lineage entries.
    uniqueIndex("uq_polver_policy_version").on(t.organizationId, t.policyId, t.version),
  ],
);

export type PolicyVersionRow = typeof policyVersionsTable.$inferSelect;
export type InsertPolicyVersion = typeof policyVersionsTable.$inferInsert;
