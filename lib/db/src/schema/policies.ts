import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  vector,
  index,
} from "drizzle-orm/pg-core";

// Dimension of policy embeddings. Kept in sync with the shared embedder in
// artifacts/api-server/src/lib/memory/embedding.ts (EMBED_DIM). If the embedding
// model changes dimension, this and the embedder must change together and the
// column/index must be recreated.
export const POLICY_EMBED_DIM = 512;

// Internal Policy & Standards Engine.
//
// Company-specific standards (packaging, brand, supplier, legal, artwork, etc.)
// uploaded by compliance managers/administrators. These are validated alongside
// external regulations (FDA/EPA/eCFR) during package reviews and can generate
// violations even when no government regulation exists. Every policy is org
// scoped (multi-tenant) and carries a vector embedding so relevant standards can
// be semantically recalled for a package under review and for search.
export const policiesTable = pgTable(
  "policies",
  {
    id: serial("id").primaryKey(),
    // Tenant scope — every read/write filters on this.
    organizationId: integer("organization_id").notNull(),
    name: text("name").notNull(),
    // Free-form type label (e.g. "Packaging Standard", "Brand Guideline").
    policyType: text("policy_type"),
    // Coarse category used for routing/filtering (see POLICY_CATEGORIES).
    category: text("category").notNull().default("Uncategorized"),
    department: text("department"),
    owner: text("owner"),
    // Display source/authority label surfaced on generated findings, e.g.
    // "Dollar Tree Packaging Standard".
    source: text("source"),
    // The human-authored rule statement / description. This is the authoritative
    // text the compliance engine reasons over (short, precise), independent of
    // any uploaded document — so a policy influences reviews even with no file.
    summary: text("summary"),
    // draft | active | archived. Only "active" policies participate in analysis.
    status: text("status").notNull().default("active"),
    // Default severity applied to violations generated from this policy.
    defaultSeverity: text("default_severity").notNull().default("major"),
    tags: text("tags").array(),
    // ISO date strings (YYYY-MM-DD). Effective/expiration bound when a policy is
    // enforced; expired or not-yet-effective policies are excluded from recall.
    effectiveDate: text("effective_date"),
    expirationDate: text("expiration_date"),
    version: integer("version").notNull().default(1),
    // Uploaded source document (object-storage path) + its metadata.
    documentUrl: text("document_url"),
    fileName: text("file_name"),
    contentType: text("content_type"),
    // Text extracted from the uploaded document (Document AI / direct decode).
    extractedText: text("extracted_text"),
    // Pending | Processing | Complete | Failed | NotConfigured | Skipped | Unsupported
    extractionStatus: text("extraction_status").notNull().default("Pending"),
    extractionEngine: text("extraction_engine"),
    embedding: vector("embedding", { dimensions: POLICY_EMBED_DIM }),
    createdBy: text("created_by"),
    createdById: text("created_by_id"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_policies_org").on(t.organizationId),
    index("idx_policies_org_status").on(t.organizationId, t.status),
    index("idx_policies_org_category").on(t.organizationId, t.category),
  ],
);

export type PolicyRow = typeof policiesTable.$inferSelect;
export type InsertPolicy = typeof policiesTable.$inferInsert;
