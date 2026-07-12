import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  index,
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
  // Optional secondary reviewer who can step in for the primary assignee. Does
  // not affect the one-active-assignment invariant (still exactly one row per
  // package); purely an ownership annotation for visibility.
  backupUserId: integer("backup_user_id"),
  // The manager accountable for this review. Notified on escalation / approval
  // and surfaced in the ownership indicator so responsibility is never unclear.
  managerUserId: integer("manager_user_id"),
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
}, (t) => [
  // Workload queues filter by team/assignee + status; the escalation sweep scans
  // open assignments by due date.
  index("idx_review_assign_org_status").on(t.organizationId, t.status),
  index("idx_review_assign_team_status").on(t.teamId, t.status),
  index("idx_review_assign_user_status").on(t.assigneeUserId, t.status),
  index("idx_review_assign_due").on(t.dueAt),
]);

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
  // Why the (re)assignment happened (e.g. "rebalancing", "specialist match")
  // and any free-text note the actor added; both surfaced in assignment history.
  reason: text("reason"),
  comments: text("comments"),
  escalationLevel: integer("escalation_level"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  index("idx_review_hist_package").on(t.packageId),
  index("idx_review_hist_assignment").on(t.assignmentId),
]);

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
}, (t) => [
  index("idx_review_metrics_org").on(t.organizationId),
  index("idx_review_metrics_team").on(t.teamId),
  index("idx_review_metrics_user").on(t.assigneeUserId),
]);

// Live reviewer presence. Exactly one row per user (unique userId), updated by a
// client heartbeat while the reviewer is active. `state` is the client-reported
// activity; "offline"/"idle" are DERIVED at read time from lastSeenAt staleness
// and never persisted here (a client that stops heartbeating simply goes stale).
// This is ephemeral live state — not seeded and safe to prune.
export const reviewerPresenceTable = pgTable("reviewer_presence", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  userId: integer("user_id").notNull().unique(),
  // online | reviewing | approving | commenting | idle
  state: text("state").notNull().default("online"),
  // The package the reviewer is currently focused on, when working a specific
  // review (drives "currently reviewing" context); null when just online.
  packageId: integer("package_id"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  index("idx_presence_org").on(t.organizationId),
  index("idx_presence_last_seen").on(t.lastSeenAt),
]);

// Advisory (soft) review lock: marks that a package review is actively being
// worked, by whom, and since when. At most one active lock per package (unique
// packageId). The lock is kept alive by a heartbeat (lastHeartbeatAt) and
// expires automatically once heartbeats stop (see LOCK_TTL). It warns against
// duplicate work but never hard-blocks writes.
export const reviewLocksTable = pgTable("review_locks", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  packageId: integer("package_id").notNull().unique(),
  userId: integer("user_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  index("idx_review_locks_org").on(t.organizationId),
  index("idx_review_locks_user").on(t.userId),
  index("idx_review_locks_heartbeat").on(t.lastHeartbeatAt),
]);

export type ReviewAssignmentRow = typeof reviewAssignmentsTable.$inferSelect;
export type InsertReviewAssignment = typeof reviewAssignmentsTable.$inferInsert;
export type ReviewHistoryRow = typeof reviewHistoryTable.$inferSelect;
export type InsertReviewHistory = typeof reviewHistoryTable.$inferInsert;
export type ReviewMetricRow = typeof reviewMetricsTable.$inferSelect;
export type InsertReviewMetric = typeof reviewMetricsTable.$inferInsert;
export type ReviewerPresenceRow = typeof reviewerPresenceTable.$inferSelect;
export type InsertReviewerPresence = typeof reviewerPresenceTable.$inferInsert;
export type ReviewLockRow = typeof reviewLocksTable.$inferSelect;
export type InsertReviewLock = typeof reviewLocksTable.$inferInsert;
