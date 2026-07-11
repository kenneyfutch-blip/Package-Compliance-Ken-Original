import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const auditEventsTable = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id"),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AuditEventRow = typeof auditEventsTable.$inferSelect;
export type InsertAuditEvent = typeof auditEventsTable.$inferInsert;
