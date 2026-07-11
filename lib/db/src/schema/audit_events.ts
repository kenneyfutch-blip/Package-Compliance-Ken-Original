import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
  index,
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
}, (t) => [
  // Audit is the highest-volume table. Reads are org-scoped and time-ordered;
  // archival/retention sweeps range-scan by createdAt.
  index("idx_audit_org_created").on(t.organizationId, t.createdAt),
  index("idx_audit_package").on(t.packageId),
  index("idx_audit_entity").on(t.entityType, t.entityId),
  index("idx_audit_created").on(t.createdAt),
]);

export type AuditEventRow = typeof auditEventsTable.$inferSelect;
export type InsertAuditEvent = typeof auditEventsTable.$inferInsert;
