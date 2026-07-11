import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// SOP Document Management.
//
// First-class standard-operating-procedure documents managed inside the Resource
// Center. Unlike the short text entries in the "Internal SOP" regulatory library,
// these are real uploaded files (PDF / Office / text) with a full revision
// history: every uploaded file is preserved as an immutable version, any two can
// be compared, and the extracted text is searchable from unified search.
//
// The parent row (sop_documents) holds the stable metadata (title, category,
// owner) plus denormalized pointers to the CURRENT version's file so list/search
// queries touch a single table. Every revision — including the first — is also
// snapshotted into sop_document_versions so the lineage is never lost. Every row
// is org scoped (multi-tenant); all reads/writes filter on organizationId.
export const sopDocumentsTable = pgTable(
  "sop_documents",
  {
    id: serial("id").primaryKey(),
    // Tenant scope — every read/write filters on this.
    organizationId: integer("organization_id").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull().default("Uncategorized"),
    // Owning department / person responsible for the SOP.
    owner: text("owner"),
    // active | archived. Archived SOPs are hidden from the default list.
    status: text("status").notNull().default("active"),
    // The current (latest) version number. Bumped on every new upload.
    currentVersion: integer("current_version").notNull().default(1),
    // Denormalized snapshot of the CURRENT version's file, for fast listing.
    documentUrl: text("document_url"),
    fileName: text("file_name"),
    contentType: text("content_type"),
    // Text extracted from the current version's document (Document AI / decode).
    extractedText: text("extracted_text"),
    // Pending | Complete | Skipped | NotConfigured | Unsupported | Failed
    extractionStatus: text("extraction_status").notNull().default("Pending"),
    extractionEngine: text("extraction_engine"),
    // ISO date string (YYYY-MM-DD) — effective date of the current version.
    effectiveDate: text("effective_date"),
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
    index("idx_sopdoc_org").on(t.organizationId),
    index("idx_sopdoc_org_status").on(t.organizationId, t.status),
    index("idx_sopdoc_org_category").on(t.organizationId, t.category),
  ],
);

// Immutable revision history for an SOP document. Each uploaded file becomes one
// version row (including v1), recording who uploaded it and when, so the full
// lineage is auditable and any two versions can be compared.
export const sopDocumentVersionsTable = pgTable(
  "sop_document_versions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    sopDocumentId: integer("sop_document_id").notNull(),
    version: integer("version").notNull(),
    documentUrl: text("document_url"),
    fileName: text("file_name"),
    contentType: text("content_type"),
    extractedText: text("extracted_text"),
    extractionStatus: text("extraction_status").notNull().default("Pending"),
    extractionEngine: text("extraction_engine"),
    effectiveDate: text("effective_date"),
    changeNote: text("change_note"),
    createdBy: text("created_by"),
    createdById: text("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_sopver_document").on(t.sopDocumentId),
    index("idx_sopver_org").on(t.organizationId),
    // A given SOP can only snapshot each version number once. Prevents concurrent
    // uploads from producing duplicate lineage entries.
    uniqueIndex("uq_sopver_document_version").on(
      t.organizationId,
      t.sopDocumentId,
      t.version,
    ),
  ],
);

export type SopDocumentRow = typeof sopDocumentsTable.$inferSelect;
export type InsertSopDocument = typeof sopDocumentsTable.$inferInsert;
export type SopDocumentVersionRow = typeof sopDocumentVersionsTable.$inferSelect;
export type InsertSopDocumentVersion =
  typeof sopDocumentVersionsTable.$inferInsert;
