import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  vector,
  index,
} from "drizzle-orm/pg-core";

// Dimension of the finding embeddings. Kept in sync with the embedder in
// artifacts/api-server/src/lib/memory/embedding.ts (EMBED_DIM). If the embedding
// model changes dimension, this and the embedder must change together and the
// column/index must be recreated.
export const COMPLIANCE_MEMORY_DIM = 512;

// Compliance Memory: institutional knowledge distilled from resolved reviews.
// Every finding (violation) and its approved fix is captured here with a vector
// embedding so future AI reviews can semantically recall how similar issues were
// resolved before. This is the durable, cross-review memory of the platform.
export const complianceMemoryTable = pgTable(
  "compliance_memory",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id"),
    // Source lineage. packageId/violationId are the review the memory came from;
    // they may point at rows that were later re-analyzed, so treat as history.
    packageId: integer("package_id"),
    violationId: integer("violation_id"),
    // Finding classification, denormalized for fast filtering alongside vector
    // search (e.g. "approved fixes for FDA allergen findings for this vendor").
    engine: text("engine").notNull(),
    severity: text("severity").notNull().default("minor"),
    category: text("category").notNull().default("Uncategorized"),
    vendor: text("vendor"),
    regulationRef: text("regulation_ref"),
    // The finding itself and the fix that resolved it.
    findingTitle: text("finding_title").notNull(),
    findingText: text("finding_text"),
    suggestedFix: text("suggested_fix"),
    approvedFix: text("approved_fix"),
    // Reviewer + outcome context.
    reviewer: text("reviewer"),
    reviewerId: text("reviewer_id"),
    // Terminal review decision for the package (e.g. Approved / Needs Revision).
    outcome: text("outcome"),
    // Whether the fix was accepted institutional knowledge: Approved | Rejected.
    approvalStatus: text("approval_status").notNull().default("Approved"),
    // The exact text that was embedded (for transparency/debugging/re-embedding).
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: COMPLIANCE_MEMORY_DIM }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_cmem_org").on(t.organizationId),
    index("idx_cmem_org_status").on(t.organizationId, t.approvalStatus),
    index("idx_cmem_org_category").on(t.organizationId, t.category),
    index("idx_cmem_org_engine").on(t.organizationId, t.engine),
    index("idx_cmem_vendor").on(t.vendor),
    index("idx_cmem_package").on(t.packageId),
    index("idx_cmem_created").on(t.createdAt),
  ],
);

export type ComplianceMemoryRow = typeof complianceMemoryTable.$inferSelect;
export type InsertComplianceMemory = typeof complianceMemoryTable.$inferInsert;
