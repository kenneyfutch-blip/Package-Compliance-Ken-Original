import {
  pgTable,
  serial,
  text,
  integer,
  date,
  timestamp,
} from "drizzle-orm/pg-core";

// Actionable review tasks, auto-generated from findings or created manually.
export const reviewTasksTable = pgTable("review_tasks", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id").notNull(),
  versionId: integer("version_id"),
  title: text("title").notNull(),
  description: text("description"),
  assignedRole: text("assigned_role"),
  assignee: text("assignee"),
  dueDate: date("due_date", { mode: "string" }),
  // low | medium | high | critical
  priority: text("priority").notNull().default("medium"),
  // open | in_progress | done | blocked
  status: text("status").notNull().default("open"),
  // manual | ai
  source: text("source").notNull().default("manual"),
  violationId: integer("violation_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ReviewTaskRow = typeof reviewTasksTable.$inferSelect;
export type InsertReviewTask = typeof reviewTasksTable.$inferInsert;
