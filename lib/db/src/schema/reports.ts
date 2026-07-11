import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id"),
  title: text("title").notNull(),
  type: text("type").notNull().default("Compliance"),
  format: text("format").notNull().default("PDF"),
  summary: text("summary"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ReportRow = typeof reportsTable.$inferSelect;
export type InsertReport = typeof reportsTable.$inferInsert;
