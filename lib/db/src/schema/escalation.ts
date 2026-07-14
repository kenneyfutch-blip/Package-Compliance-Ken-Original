import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { departmentsTable } from "./departments";
import { specialistProfilesTable } from "./specialists";

// The Escalation Matrix: ordered rules that map a trigger condition (risk score,
// SLA breach, finding severity, no capacity) to who the work escalates to and at
// what escalation level.
export const escalationRulesTable = pgTable("escalation_rules", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  matrixOrder: integer("matrix_order").notNull().default(1),
  // trigger_type: risk_score | sla_breach | finding_severity | no_capacity
  triggerType: text("trigger_type").notNull(),
  // operator: greaterThan | greaterOrEqual | lessThan | equals | contains
  triggerOperator: text("trigger_operator").notNull().default("greaterThan"),
  triggerValue: text("trigger_value"),
  escalateToLevel: integer("escalate_to_level").notNull().default(2),
  escalateToRole: text("escalate_to_role"),
  escalateToSpecialistId: integer("escalate_to_specialist_id").references(
    () => specialistProfilesTable.id,
    { onDelete: "set null" },
  ),
  escalateToDepartmentId: integer("escalate_to_department_id").references(
    () => departmentsTable.id,
    { onDelete: "set null" },
  ),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type EscalationRuleRow = typeof escalationRulesTable.$inferSelect;
