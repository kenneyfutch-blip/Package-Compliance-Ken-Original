import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

// A packaging artwork version. Each version carries its own file/artwork,
// page count, and extracted copy so reviewers can compare revisions over time.
export const packageVersionsTable = pgTable("package_versions", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id").notNull(),
  versionNumber: integer("version_number").notNull().default(1),
  label: text("label"),
  // Object-storage path (/objects/...) or a public URL to the artwork file.
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  // png | jpg | pdf | ai | indd
  fileType: text("file_type"),
  // Optional attached PDF/PNG export used to preview AI/INDD source files.
  previewUrl: text("preview_url"),
  // SHA-256 (hex) of the stored file bytes, captured at upload/restore time so
  // the exact artwork behind a version can be integrity-verified as compliance
  // evidence. Null for legacy/seed versions created before hashing existed.
  fileHash: text("file_hash"),
  pageCount: integer("page_count").notNull().default(1),
  extractedText: text("extracted_text"),
  notes: text("notes"),
  isCurrent: boolean("is_current").notNull().default(false),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PackageVersionRow = typeof packageVersionsTable.$inferSelect;
export type InsertPackageVersion = typeof packageVersionsTable.$inferInsert;
