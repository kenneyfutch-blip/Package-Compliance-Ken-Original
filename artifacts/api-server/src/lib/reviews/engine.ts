import {
  db,
  reviewAssignmentsTable,
  reviewHistoryTable,
  reviewMetricsTable,
  teamsTable,
  teamMembersTable,
  usersTable,
  packagesTable,
  type ReviewAssignmentRow,
} from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { notifyUsers } from "./notify";

// Default number of concurrent reviews a specialist is expected to carry before
// they are considered at capacity. There is no per-user capacity field yet, so
// this org-wide default drives utilization + overload signals.
export const DEFAULT_CAPACITY = 8;

// SLA window (in hours) selected by assignment priority.
export const SLA_HOURS_BY_PRIORITY: Record<string, number> = {
  low: 96,
  normal: 48,
  high: 24,
  critical: 12,
};
export const DEFAULT_SLA_HOURS = 48;

// Difference in active review counts between the most- and least-loaded members
// of a team before we recommend rebalancing.
export const REBALANCE_THRESHOLD = 3;

// Statuses that represent live, in-flight work owned by a member.
export const ACTIVE_STATUSES = ["Assigned", "InProgress", "Escalated"];

export type SlaStatus = "none" | "on_track" | "at_risk" | "breached";

// Point-in-time SLA state for an assignment, derived from its due date. Completed
// reviews report whether they beat their deadline; live reviews report how close
// they are to breaching.
export function slaStatusFor(
  a: {
    status: string;
    dueAt: Date | null;
    completedAt: Date | null;
    slaHours: number;
  },
  now: Date = new Date(),
): SlaStatus {
  if (!a.dueAt) return "none";
  const due = new Date(a.dueAt).getTime();
  if (a.status === "Completed") {
    const done = a.completedAt ? new Date(a.completedAt).getTime() : now.getTime();
    return done <= due ? "on_track" : "breached";
  }
  const t = now.getTime();
  if (t > due) return "breached";
  const windowMs = a.slaHours * 3_600_000;
  const remaining = due - t;
  return remaining <= windowMs * 0.25 ? "at_risk" : "on_track";
}

// Resolve the team a category should route to, returning the team row when the
// named team exists in the org.
export async function resolveTeamForCategory(
  organizationId: number,
  teamName: string | null,
): Promise<{ id: number; name: string } | null> {
  if (!teamName) return null;
  const [team] = await db
    .select({ id: teamsTable.id, name: teamsTable.name })
    .from(teamsTable)
    .where(
      and(eq(teamsTable.organizationId, organizationId), eq(teamsTable.name, teamName)),
    )
    .limit(1);
  return team ?? null;
}

// Active assignment counts keyed by assignee, scoped to an org and optionally a
// single team.
async function activeCountsByMember(
  organizationId: number,
  teamId?: number,
): Promise<Map<number, number>> {
  const conds = [
    eq(reviewAssignmentsTable.organizationId, organizationId),
    isNotNull(reviewAssignmentsTable.assigneeUserId),
    inArray(reviewAssignmentsTable.status, ACTIVE_STATUSES),
  ];
  if (teamId !== undefined) conds.push(eq(reviewAssignmentsTable.teamId, teamId));
  const rows = await db
    .select({
      assigneeUserId: reviewAssignmentsTable.assigneeUserId,
      c: sql<number>`count(*)::int`,
    })
    .from(reviewAssignmentsTable)
    .where(and(...conds))
    .groupBy(reviewAssignmentsTable.assigneeUserId);
  const map = new Map<number, number>();
  for (const r of rows) {
    if (r.assigneeUserId !== null) map.set(r.assigneeUserId, r.c);
  }
  return map;
}

// Members of a team (active users only), with their names, ordered by id.
async function teamMembers(
  organizationId: number,
  teamId: number,
): Promise<{ userId: number; name: string; email: string | null; roleKey: string }[]> {
  return db
    .select({
      userId: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      roleKey: usersTable.roleKey,
    })
    .from(teamMembersTable)
    .innerJoin(usersTable, eq(teamMembersTable.userId, usersTable.id))
    .where(
      and(
        eq(teamMembersTable.teamId, teamId),
        eq(usersTable.organizationId, organizationId),
        eq(usersTable.active, true),
      ),
    )
    .orderBy(usersTable.id);
}

// Choose the least-loaded active member of a team for load-balanced assignment.
export async function pickLeastLoadedMember(
  organizationId: number,
  teamId: number,
): Promise<number | null> {
  const members = await teamMembers(organizationId, teamId);
  if (members.length === 0) return null;
  const counts = await activeCountsByMember(organizationId, teamId);
  let best: { userId: number; load: number } | null = null;
  for (const m of members) {
    const load = counts.get(m.userId) ?? 0;
    if (!best || load < best.load) best = { userId: m.userId, load };
  }
  return best?.userId ?? null;
}

export interface AssignParams {
  organizationId: number;
  packageId: number;
  // undefined = leave unchanged; null = clear.
  teamId?: number | null;
  assigneeUserId?: number | null;
  backupUserId?: number | null;
  managerUserId?: number | null;
  priority?: string;
  slaHours?: number;
  actorUserId?: number | null;
  actorName: string;
  detail?: string | null;
  // Structured reason + free-text note recorded on the history entry.
  reason?: string | null;
  comments?: string | null;
  auto?: boolean;
  // A human-readable package name used only to compose notification copy.
  packageName?: string | null;
}

// Create or update the active assignment for a package and append the transition
// to review_history. Reassignment to a new member restarts the SLA clock and
// clears any prior escalation so the new owner gets a fresh window.
export async function assignReview(p: AssignParams): Promise<ReviewAssignmentRow> {
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(reviewAssignmentsTable)
      .where(
        and(
          eq(reviewAssignmentsTable.packageId, p.packageId),
          eq(reviewAssignmentsTable.organizationId, p.organizationId),
        ),
      )
      .limit(1)
      .for("update");

    const priority = p.priority ?? existing?.priority ?? "normal";
    const slaHours =
      p.slaHours ??
      existing?.slaHours ??
      SLA_HOURS_BY_PRIORITY[priority] ??
      DEFAULT_SLA_HOURS;
    const teamId =
      p.teamId !== undefined ? p.teamId : (existing?.teamId ?? null);
    const assigneeUserId =
      p.assigneeUserId !== undefined
        ? p.assigneeUserId
        : (existing?.assigneeUserId ?? null);
    const backupUserId =
      p.backupUserId !== undefined
        ? p.backupUserId
        : (existing?.backupUserId ?? null);
    const managerUserId =
      p.managerUserId !== undefined
        ? p.managerUserId
        : (existing?.managerUserId ?? null);

    const prevAssignee = existing?.assigneeUserId ?? null;
    const prevManager = existing?.managerUserId ?? null;
    const prevBackup = existing?.backupUserId ?? null;
    const prevPriority = existing?.priority ?? null;
    const prevDueAt = existing?.dueAt ? new Date(existing.dueAt).getTime() : null;
    const assigneeChanged = prevAssignee !== assigneeUserId;
    const teamChanged = (existing?.teamId ?? null) !== teamId;

    const assignedAt = assigneeUserId
      ? assigneeChanged || !existing?.assignedAt
        ? now
        : existing.assignedAt
      : null;
    const dueAt = assignedAt
      ? new Date(assignedAt.getTime() + slaHours * 3_600_000)
      : null;
    const escalationLevel = assigneeChanged ? 0 : (existing?.escalationLevel ?? 0);
    const lastEscalatedAt = assigneeChanged
      ? null
      : (existing?.lastEscalatedAt ?? null);
    const keepInProgress =
      !assigneeChanged && existing?.status === "InProgress";
    const status = assigneeUserId
      ? keepInProgress
        ? "InProgress"
        : "Assigned"
      : teamId
        ? "Assigned"
        : "Unassigned";
    const startedAt = keepInProgress ? existing?.startedAt ?? null : null;

    let row: ReviewAssignmentRow;
    if (existing) {
      const [updated] = await tx
        .update(reviewAssignmentsTable)
        .set({
          teamId,
          assigneeUserId,
          backupUserId,
          managerUserId,
          status,
          priority,
          slaHours,
          assignedAt,
          dueAt,
          startedAt,
          completedAt: null,
          escalationLevel,
          lastEscalatedAt,
          autoRouted: p.auto ?? existing.autoRouted,
        })
        .where(eq(reviewAssignmentsTable.id, existing.id))
        .returning();
      row = updated!;
    } else {
      const [inserted] = await tx
        .insert(reviewAssignmentsTable)
        .values({
          organizationId: p.organizationId,
          packageId: p.packageId,
          teamId,
          assigneeUserId,
          backupUserId,
          managerUserId,
          status,
          priority,
          slaHours,
          assignedAt,
          dueAt,
          escalationLevel,
          autoRouted: p.auto ?? false,
        })
        .returning();
      row = inserted!;
    }

    const action = !existing
      ? assigneeUserId
        ? "assigned"
        : "routed"
      : assigneeChanged
        ? "reassigned"
        : teamChanged
          ? "routed"
          : "assigned";

    await tx.insert(reviewHistoryTable).values({
      organizationId: p.organizationId,
      packageId: p.packageId,
      assignmentId: row.id,
      action,
      fromTeamId: existing?.teamId ?? null,
      toTeamId: teamId,
      fromUserId: prevAssignee,
      toUserId: assigneeUserId,
      actorUserId: p.actorUserId ?? null,
      actorName: p.actorName,
      detail: p.detail ?? null,
      reason: p.reason ?? null,
      comments: p.comments ?? null,
      escalationLevel,
    });

    const priorityChanged = existing != null && prevPriority !== priority;
    const dueMs = dueAt ? dueAt.getTime() : null;
    const dueChanged =
      existing != null && !assigneeChanged && prevDueAt !== dueMs && dueMs !== null;

    return {
      row,
      changes: {
        assigneeChanged,
        priorityChanged,
        dueChanged,
        prevAssignee,
        assigneeUserId,
        managerUserId,
        managerChanged: prevManager !== managerUserId,
        backupUserId,
        backupChanged: prevBackup !== backupUserId,
        priority,
        dueAt,
      },
    };
  });

  // Fire per-user notifications after the assignment commits (best-effort). The
  // actor themselves is filtered out downstream so people are not pinged about
  // their own actions.
  await emitAssignmentNotifications(p, result.changes);

  return result.row;
}

// Compose and send the per-user notifications implied by an assignment change:
// new assignee, previous assignee (reassigned away), backup, manager, and
// priority / due-date changes for the current owner.
async function emitAssignmentNotifications(
  p: AssignParams,
  c: {
    assigneeChanged: boolean;
    priorityChanged: boolean;
    dueChanged: boolean;
    prevAssignee: number | null;
    assigneeUserId: number | null;
    managerUserId: number | null;
    managerChanged: boolean;
    backupUserId: number | null;
    backupChanged: boolean;
    priority: string;
    dueAt: Date | null;
  },
): Promise<void> {
  const label = p.packageName ? `"${p.packageName}"` : "a package review";
  const actor = p.actorName || "A teammate";
  const skip = (id: number | null | undefined) =>
    id != null && id !== p.actorUserId ? id : null;
  const due = c.dueAt ? new Date(c.dueAt).toLocaleString() : null;

  try {
    if (c.assigneeChanged) {
      await notifyUsers({
        organizationId: p.organizationId,
        userIds: [skip(c.assigneeUserId)],
        packageId: p.packageId,
        title: "New review assigned to you",
        message: `${actor} assigned you ${label}${
          due ? `. Due ${due}.` : "."
        }${p.reason ? ` Reason: ${p.reason}.` : ""}`,
        type: "info",
      });
      await notifyUsers({
        organizationId: p.organizationId,
        userIds: [skip(c.prevAssignee)],
        packageId: p.packageId,
        title: "Review reassigned away",
        message: `${actor} reassigned ${label} to another reviewer.`,
        type: "info",
      });
    } else {
      if (c.priorityChanged) {
        await notifyUsers({
          organizationId: p.organizationId,
          userIds: [skip(c.assigneeUserId)],
          packageId: p.packageId,
          title: "Review priority changed",
          message: `${actor} set the priority of ${label} to ${c.priority}.`,
          type: c.priority === "critical" || c.priority === "high" ? "warning" : "info",
        });
      }
      if (c.dueChanged) {
        await notifyUsers({
          organizationId: p.organizationId,
          userIds: [skip(c.assigneeUserId)],
          packageId: p.packageId,
          title: "Review due date changed",
          message: `The deadline for ${label} is now ${due ?? "updated"}.`,
          type: "info",
        });
      }
    }

    if (c.managerChanged) {
      await notifyUsers({
        organizationId: p.organizationId,
        userIds: [skip(c.managerUserId)],
        packageId: p.packageId,
        title: "You are the responsible manager",
        message: `${actor} made you the responsible manager for ${label}.`,
        type: "info",
      });
    }
    if (c.backupChanged) {
      await notifyUsers({
        organizationId: p.organizationId,
        userIds: [skip(c.backupUserId)],
        packageId: p.packageId,
        title: "You are the backup reviewer",
        message: `${actor} named you backup reviewer for ${label}.`,
        type: "info",
      });
    }
  } catch {
    // Notifications are best-effort; never fail an assignment because a
    // notification insert failed.
  }
}

// Route a package to the correct team by category and balance it onto that
// team's least-loaded member.
export async function autoAssignReview(p: {
  organizationId: number;
  packageId: number;
  category: string | null;
  teamName: string | null;
  priority?: string;
  actorUserId?: number | null;
  actorName?: string;
  packageName?: string | null;
}): Promise<ReviewAssignmentRow> {
  const team = await resolveTeamForCategory(p.organizationId, p.teamName);
  const assigneeUserId = team
    ? await pickLeastLoadedMember(p.organizationId, team.id)
    : null;
  return assignReview({
    organizationId: p.organizationId,
    packageId: p.packageId,
    teamId: team?.id ?? null,
    assigneeUserId,
    priority: p.priority,
    actorUserId: p.actorUserId ?? null,
    actorName: p.actorName ?? "System",
    packageName: p.packageName ?? null,
    reason: "Auto-routed by category",
    detail: team
      ? `Auto-routed to ${team.name} by category "${p.category ?? "Uncategorized"}"`
      : `No team matched category "${p.category ?? "Uncategorized"}"; needs manual triage`,
    auto: true,
  });
}

// Finalize a review, capturing metrics used for SLA + workload reporting.
export async function completeReview(p: {
  organizationId: number;
  packageId: number;
  actorUserId?: number | null;
  actorName: string;
  detail?: string | null;
}): Promise<ReviewAssignmentRow | null> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(reviewAssignmentsTable)
      .where(
        and(
          eq(reviewAssignmentsTable.packageId, p.packageId),
          eq(reviewAssignmentsTable.organizationId, p.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!existing || existing.status === "Completed") return existing ?? null;

    const [row] = await tx
      .update(reviewAssignmentsTable)
      .set({ status: "Completed", completedAt: now })
      .where(eq(reviewAssignmentsTable.id, existing.id))
      .returning();

    const reviewMinutes = existing.assignedAt
      ? Math.max(
          0,
          Math.round((now.getTime() - new Date(existing.assignedAt).getTime()) / 60000),
        )
      : null;
    const metSla = existing.dueAt ? now <= new Date(existing.dueAt) : null;

    const [pkg] = await tx
      .select({ c: packagesTable.criticalCount })
      .from(packagesTable)
      .where(eq(packagesTable.id, p.packageId))
      .limit(1);

    await tx.insert(reviewMetricsTable).values({
      organizationId: p.organizationId,
      packageId: p.packageId,
      assignmentId: existing.id,
      teamId: existing.teamId,
      assigneeUserId: existing.assigneeUserId,
      assignedAt: existing.assignedAt,
      completedAt: now,
      reviewMinutes,
      slaHours: existing.slaHours,
      dueAt: existing.dueAt,
      metSla,
      escalationLevel: existing.escalationLevel,
      criticalCount: pkg?.c ?? 0,
    });

    await tx.insert(reviewHistoryTable).values({
      organizationId: p.organizationId,
      packageId: p.packageId,
      assignmentId: existing.id,
      action: "completed",
      actorUserId: p.actorUserId ?? null,
      actorName: p.actorName,
      detail: p.detail ?? null,
      escalationLevel: existing.escalationLevel,
    });

    return row!;
  });
}

// Current assignment + full ownership history for a package.
export async function getPackageAssignment(
  organizationId: number,
  packageId: number,
) {
  const [assignment] = await db
    .select()
    .from(reviewAssignmentsTable)
    .where(
      and(
        eq(reviewAssignmentsTable.organizationId, organizationId),
        eq(reviewAssignmentsTable.packageId, packageId),
      ),
    )
    .limit(1);
  const history = await db
    .select()
    .from(reviewHistoryTable)
    .where(
      and(
        eq(reviewHistoryTable.organizationId, organizationId),
        eq(reviewHistoryTable.packageId, packageId),
      ),
    )
    .orderBy(reviewHistoryTable.createdAt, reviewHistoryTable.id);
  return { assignment: assignment ?? null, history };
}
