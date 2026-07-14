import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { departmentsTable } from "./departments";
import { specialistProfilesTable } from "./specialists";
import { reviewStagesTable } from "./review_stages";

// A single condition in a routing rule, e.g. { field: "issueType",
// operator: "equals", value: "Barcode" } or { field: "riskScore",
// operator: "greaterThan", value: "90" }.
export interface RoutingCondition {
  field: string;
  operator: string;
  value: string;
}

// Configurable IF/THEN routing rules. Conditions are ANDed together; rules are
// evaluated in ascending priority order (lower number = evaluated first). The
// matched rule's action determines where work is routed.
export const routingRulesTable = pgTable("routing_rules", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  priority: integer("priority").notNull().default(100),
  active: boolean("active").notNull().default(true),
  conditions: jsonb("conditions")
    .$type<RoutingCondition[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  // action_type: department | specialist | stage | escalate
  actionType: text("action_type").notNull().default("department"),
  actionDepartmentId: integer("action_department_id").references(
    () => departmentsTable.id,
    { onDelete: "set null" },
  ),
  actionSpecialistId: integer("action_specialist_id").references(
    () => specialistProfilesTable.id,
    { onDelete: "set null" },
  ),
  actionStageId: integer("action_stage_id").references(
    () => reviewStagesTable.id,
    { onDelete: "set null" },
  ),
  // Freeform target for escalate actions (e.g. a role or level).
  actionValue: text("action_value"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type RoutingRuleRow = typeof routingRulesTable.$inferSelect;
