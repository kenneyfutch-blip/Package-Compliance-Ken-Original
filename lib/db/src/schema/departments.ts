import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

// A department within an organization (e.g. "Compliance", "Regulatory Affairs").
// Departments group specialists and own escalation responsibility. Membership is
// derived from specialist_profiles.departmentId rather than a join table.
export const departmentsTable = pgTable("departments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  // Optional links to the users who lead / own escalations for this department.
  leaderUserId: integer("leader_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  escalationOwnerUserId: integer("escalation_owner_user_id").references(
    () => usersTable.id,
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

export type DepartmentRow = typeof departmentsTable.$inferSelect;
