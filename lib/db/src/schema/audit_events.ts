import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

// Append-only audit trail. Rows are never updated or deleted (enforced at the
// application layer via the audit writer and, defensively, by a database
// trigger installed at server startup). Captures who did what to which entity,
// with before/after snapshots and any regulations referenced.
export const auditEventsTable = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(
    () => organizationsTable.id,
  ),
  packageId: integer("package_id"),
  entityType: text("entity_type").notNull().default("package"),
  entityId: integer("entity_id"),
  actor: text("actor").notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  detail: text("detail"),
  before: jsonb("before").$type<Record<string, unknown> | null>(),
  after: jsonb("after").$type<Record<string, unknown> | null>(),
  regulationRefs: jsonb("regulation_refs").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AuditEventRow = typeof auditEventsTable.$inferSelect;
export type InsertAuditEvent = typeof auditEventsTable.$inferInsert;
