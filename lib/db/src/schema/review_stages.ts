import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { teamsTable } from "./teams";
import { departmentsTable } from "./departments";
import { specialistProfilesTable } from "./specialists";

// Stage-based review configuration (e.g. Packaging Review -> Compliance Review ->
// Regulatory Review -> Final Approval). Each stage names who is responsible, the
// approval authority required, its SLA, and the escalation path.
export const reviewStagesTable = pgTable("review_stages", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  stageOrder: integer("stage_order").notNull().default(1),
  assignedTeamId: integer("assigned_team_id").references(() => teamsTable.id, {
    onDelete: "set null",
  }),
  assignedDepartmentId: integer("assigned_department_id").references(
    () => departmentsTable.id,
    { onDelete: "set null" },
  ),
  assignedSpecialistId: integer("assigned_specialist_id").references(
    () => specialistProfilesTable.id,
    { onDelete: "set null" },
  ),
  approvalAuthority: text("approval_authority"),
  slaHours: integer("sla_hours").notNull().default(48),
  escalationPath: text("escalation_path"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ReviewStageRow = typeof reviewStagesTable.$inferSelect;
