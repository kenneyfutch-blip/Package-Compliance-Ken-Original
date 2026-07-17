import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  packageId: integer("package_id"),
  title: text("title").notNull(),
  type: text("type").notNull().default("Compliance"),
  format: text("format").notNull().default("PDF"),
  summary: text("summary"),
  // Object-storage path (/objects/...) of a generated artifact (e.g. an exported
  // annotated proof PDF), used to authorize downloads back to the owning package.
  objectPath: text("object_path"),
  // Lifecycle: NULL/NULL = active; archivedAt set = archived (hidden from the
  // default list, restorable); deletedAt set = in trash (restorable). Rows are
  // never hard-deleted here so generated documents stay recoverable.
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ReportRow = typeof reportsTable.$inferSelect;
export type InsertReport = typeof reportsTable.$inferInsert;
