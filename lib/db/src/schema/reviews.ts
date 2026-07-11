import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

// The active review assignment for a package. Exactly one active row per package
// (enforced by the unique packageId); reassignment mutates this row in place and
// every transition is appended to review_history. Replaces the legacy free-text
// packages.reviewer field as the system of record for who owns a review.
export const reviewAssignmentsTable = pgTable("review_assignments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  packageId: integer("package_id").notNull().unique(),
  // Team the work is routed to. Null means it could not be routed and needs
  // manual triage.
  teamId: integer("team_id"),
  // Individual specialist the work is balanced onto. Null while only team-routed.
  assigneeUserId: integer("assignee_user_id"),
  // Unassigned | Assigned | InProgress | Completed | Escalated
  status: text("status").notNull().default("Unassigned"),
  // low | normal | high | critical — drives the SLA window.
  priority: text("priority").notNull().default("normal"),
  slaHours: integer("sla_hours").notNull().default(48),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  dueAt: timestamp("due_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  // 0 none, 1 manager (24h), 2 director (48h), 3 leadership (72h). Monotonic so
  // each tier only fires once.
  escalationLevel: integer("escalation_level").notNull().default(0),
  lastEscalatedAt: timestamp("last_escalated_at", { withTimezone: true }),
  autoRouted: boolean("auto_routed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Append-only trail of every assignment/reassignment/escalation event, so a
// review's ownership history is fully auditable.
export const reviewHistoryTable = pgTable("review_history", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  packageId: integer("package_id").notNull(),
  assignmentId: integer("assignment_id"),
  // routed | assigned | reassigned | started | completed | escalated | unassigned
  action: text("action").notNull(),
  fromTeamId: integer("from_team_id"),
  toTeamId: integer("to_team_id"),
  fromUserId: integer("from_user_id"),
  toUserId: integer("to_user_id"),
  // Null actorUserId => system/automation actor.
  actorUserId: integer("actor_user_id"),
  actorName: text("actor_name").notNull().default("System"),
  detail: text("detail"),
  escalationLevel: integer("escalation_level"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One row captured when a review reaches a terminal state, powering workload and
// SLA reporting without recomputing from the live assignment each time.
export const reviewMetricsTable = pgTable("review_metrics", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  packageId: integer("package_id").notNull(),
  assignmentId: integer("assignment_id"),
  teamId: integer("team_id"),
  assigneeUserId: integer("assignee_user_id"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  reviewMinutes: integer("review_minutes"),
  slaHours: integer("sla_hours"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  metSla: boolean("met_sla"),
  escalationLevel: integer("escalation_level").notNull().default(0),
  criticalCount: integer("critical_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ReviewAssignmentRow = typeof reviewAssignmentsTable.$inferSelect;
export type InsertReviewAssignment = typeof reviewAssignmentsTable.$inferInsert;
export type ReviewHistoryRow = typeof reviewHistoryTable.$inferSelect;
export type InsertReviewHistory = typeof reviewHistoryTable.$inferInsert;
export type ReviewMetricRow = typeof reviewMetricsTable.$inferSelect;
export type InsertReviewMetric = typeof reviewMetricsTable.$inferInsert;
