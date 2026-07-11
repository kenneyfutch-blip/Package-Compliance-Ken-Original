import {
  db,
  reviewAssignmentsTable,
  reviewHistoryTable,
  reviewMetricsTable,
  teamsTable,
  teamMembersTable,
  usersTable,
  packagesTable,
} from "@workspace/db";
import { mapReviewAssignment } from "../mappers";
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  ACTIVE_STATUSES,
  DEFAULT_CAPACITY,
  REBALANCE_THRESHOLD,
} from "./engine";

export interface MemberWorkload {
  userId: number;
  name: string;
  email: string | null;
  roleKey: string;
  activeCount: number;
  inProgressCount: number;
  capacity: number;
  utilization: number;
  avgReviewMinutes: number | null;
  overloaded: boolean;
}

export interface ReassignmentRecommendation {
  fromUserId: number;
  fromName: string;
  toUserId: number;
  toName: string;
  suggestedMoves: number;
  reason: string;
}

export interface TeamWorkload {
  teamId: number;
  teamName: string;
  memberCount: number;
  activeCount: number;
  capacity: number;
  utilization: number;
  avgReviewMinutes: number | null;
  members: MemberWorkload[];
  recommendations: ReassignmentRecommendation[];
}

// Per-team and per-member active workload, capacity utilization, average review
// time, and concrete rebalancing recommendations when one specialist is
// overloaded relative to a lighter teammate.
// When teamIds is a list, results are restricted to those teams (team-scoped
// callers); when null the whole organization is reported (org-wide oversight).
export async function computeWorkload(
  organizationId: number,
  teamIds: number[] | null = null,
) {
  const teams = await db
    .select({ id: teamsTable.id, name: teamsTable.name })
    .from(teamsTable)
    .where(
      teamIds === null
        ? eq(teamsTable.organizationId, organizationId)
        : and(
            eq(teamsTable.organizationId, organizationId),
            inArray(teamsTable.id, teamIds),
          ),
    )
    .orderBy(teamsTable.name);

  // Active counts + in-progress counts per member, org-wide.
  const activeRows = await db
    .select({
      assigneeUserId: reviewAssignmentsTable.assigneeUserId,
      teamId: reviewAssignmentsTable.teamId,
      status: reviewAssignmentsTable.status,
    })
    .from(reviewAssignmentsTable)
    .where(
      and(
        eq(reviewAssignmentsTable.organizationId, organizationId),
        inArray(reviewAssignmentsTable.status, ACTIVE_STATUSES),
      ),
    );
  const activeByUser = new Map<number, number>();
  const inProgressByUser = new Map<number, number>();
  for (const r of activeRows) {
    if (r.assigneeUserId === null) continue;
    activeByUser.set(r.assigneeUserId, (activeByUser.get(r.assigneeUserId) ?? 0) + 1);
    if (r.status === "InProgress") {
      inProgressByUser.set(
        r.assigneeUserId,
        (inProgressByUser.get(r.assigneeUserId) ?? 0) + 1,
      );
    }
  }

  // Average completed review time per member.
  const avgRows = await db
    .select({
      assigneeUserId: reviewMetricsTable.assigneeUserId,
      avg: sql<string | null>`avg(${reviewMetricsTable.reviewMinutes})`,
    })
    .from(reviewMetricsTable)
    .where(eq(reviewMetricsTable.organizationId, organizationId))
    .groupBy(reviewMetricsTable.assigneeUserId);
  const avgByUser = new Map<number, number | null>();
  for (const r of avgRows) {
    if (r.assigneeUserId === null) continue;
    avgByUser.set(r.assigneeUserId, r.avg === null ? null : Math.round(Number(r.avg)));
  }

  const memberRows = await db
    .select({
      teamId: teamMembersTable.teamId,
      userId: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      roleKey: usersTable.roleKey,
    })
    .from(teamMembersTable)
    .innerJoin(usersTable, eq(teamMembersTable.userId, usersTable.id))
    .where(
      and(eq(usersTable.organizationId, organizationId), eq(usersTable.active, true)),
    )
    .orderBy(usersTable.id);

  const teamsOut: TeamWorkload[] = teams.map((team) => {
    const members: MemberWorkload[] = memberRows
      .filter((m) => m.teamId === team.id)
      .map((m) => {
        const activeCount = activeByUser.get(m.userId) ?? 0;
        return {
          userId: m.userId,
          name: m.name,
          email: m.email,
          roleKey: m.roleKey,
          activeCount,
          inProgressCount: inProgressByUser.get(m.userId) ?? 0,
          capacity: DEFAULT_CAPACITY,
          utilization:
            DEFAULT_CAPACITY > 0
              ? Math.round((activeCount / DEFAULT_CAPACITY) * 100) / 100
              : 0,
          avgReviewMinutes: avgByUser.get(m.userId) ?? null,
          overloaded: activeCount > DEFAULT_CAPACITY,
        };
      });

    const activeCount = members.reduce((s, m) => s + m.activeCount, 0);
    const capacity = members.length * DEFAULT_CAPACITY;
    const teamAvgVals = members
      .map((m) => m.avgReviewMinutes)
      .filter((v): v is number => v !== null);
    const avgReviewMinutes =
      teamAvgVals.length > 0
        ? Math.round(teamAvgVals.reduce((s, v) => s + v, 0) / teamAvgVals.length)
        : null;

    const recommendations = buildRecommendations(members);

    return {
      teamId: team.id,
      teamName: team.name,
      memberCount: members.length,
      activeCount,
      capacity,
      utilization:
        capacity > 0 ? Math.round((activeCount / capacity) * 100) / 100 : 0,
      avgReviewMinutes,
      members,
      recommendations,
    };
  });

  const unassignedConds: SQL[] = [
    eq(reviewAssignmentsTable.organizationId, organizationId),
    or(
      eq(reviewAssignmentsTable.status, "Unassigned"),
      isNull(reviewAssignmentsTable.assigneeUserId),
    )!,
  ];
  if (teamIds !== null) {
    unassignedConds.push(inArray(reviewAssignmentsTable.teamId, teamIds));
  }
  const [{ c: unassignedCount } = { c: 0 }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(reviewAssignmentsTable)
    .where(and(...unassignedConds));

  return {
    teams: teamsOut,
    unassignedCount: unassignedCount ?? 0,
    generatedAt: new Date().toISOString(),
  };
}

// Recommend moving reviews from the most-loaded member to the least-loaded when
// the gap exceeds the rebalance threshold.
function buildRecommendations(members: MemberWorkload[]): ReassignmentRecommendation[] {
  if (members.length < 2) return [];
  const sorted = [...members].sort((a, b) => a.activeCount - b.activeCount);
  const lightest = sorted[0]!;
  const heaviest = sorted[sorted.length - 1]!;
  const gap = heaviest.activeCount - lightest.activeCount;
  if (gap < REBALANCE_THRESHOLD) return [];
  const suggestedMoves = Math.floor(gap / 2);
  if (suggestedMoves < 1) return [];
  return [
    {
      fromUserId: heaviest.userId,
      fromName: heaviest.name,
      toUserId: lightest.userId,
      toName: lightest.name,
      suggestedMoves,
      reason: `${heaviest.name} has ${heaviest.activeCount} active reviews vs ${lightest.name}'s ${lightest.activeCount}. Move ${suggestedMoves} to balance the team.`,
    },
  ];
}

// List assignments with the package + team + assignee context needed to render
// them, filterable by status / team / assignee.
export async function listAssignments(
  organizationId: number,
  filters: { status?: string; teamId?: number; assigneeUserId?: number },
  // Extra package-scope predicates (e.g. supplier restriction) applied against
  // the joined packages table so callers only see assignments they may access.
  packageScope: SQL[] = [],
  // Team scoping for internal callers: when set, restricts to assignments for
  // the caller's own teams (plus any assigned directly to them). Null = no team
  // restriction (org-wide oversight roles, or supplier callers handled by
  // packageScope). See opsTeamScope in rbac/scope.ts.
  teamScope: { teamIds: number[]; userId: number } | null = null,
) {
  const conds = [
    eq(reviewAssignmentsTable.organizationId, organizationId),
    ...packageScope,
  ];
  if (teamScope !== null) {
    conds.push(
      or(
        inArray(reviewAssignmentsTable.teamId, teamScope.teamIds),
        eq(reviewAssignmentsTable.assigneeUserId, teamScope.userId),
      )!,
    );
  }
  if (filters.status) conds.push(eq(reviewAssignmentsTable.status, filters.status));
  if (filters.teamId !== undefined)
    conds.push(eq(reviewAssignmentsTable.teamId, filters.teamId));
  if (filters.assigneeUserId !== undefined)
    conds.push(eq(reviewAssignmentsTable.assigneeUserId, filters.assigneeUserId));

  const backupUsers = alias(usersTable, "backup_users");
  const managerUsers = alias(usersTable, "manager_users");

  return db
    .select({
      assignment: reviewAssignmentsTable,
      packageName: packagesTable.name,
      packageSku: packagesTable.sku,
      category: packagesTable.category,
      criticalCount: packagesTable.criticalCount,
      complianceStatus: packagesTable.complianceStatus,
      teamName: teamsTable.name,
      assigneeName: usersTable.name,
      backupName: backupUsers.name,
      managerName: managerUsers.name,
    })
    .from(reviewAssignmentsTable)
    .innerJoin(packagesTable, eq(reviewAssignmentsTable.packageId, packagesTable.id))
    .leftJoin(teamsTable, eq(reviewAssignmentsTable.teamId, teamsTable.id))
    .leftJoin(usersTable, eq(reviewAssignmentsTable.assigneeUserId, usersTable.id))
    .leftJoin(backupUsers, eq(reviewAssignmentsTable.backupUserId, backupUsers.id))
    .leftJoin(managerUsers, eq(reviewAssignmentsTable.managerUserId, managerUsers.id))
    .where(and(...conds))
    .orderBy(desc(reviewAssignmentsTable.updatedAt));
}

function startOfToday(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Personal workload snapshot for the signed-in reviewer: live queue metrics,
// their active assignments (ordered by urgency), and their recent ownership
// activity. Always scoped to a single user — never leaks other reviewers' work.
export async function computeMyWork(organizationId: number, userId: number) {
  const now = new Date();
  const today = startOfToday(now);

  const [live] = await db
    .select({
      assigned: sql<number>`count(*) filter (where ${reviewAssignmentsTable.status} in ('Assigned','InProgress','Escalated'))::int`,
      inProgress: sql<number>`count(*) filter (where ${reviewAssignmentsTable.status} = 'InProgress')::int`,
      escalated: sql<number>`count(*) filter (where ${reviewAssignmentsTable.escalationLevel} > 0 and ${reviewAssignmentsTable.status} <> 'Completed')::int`,
      overdue: sql<number>`count(*) filter (where ${reviewAssignmentsTable.status} in ('Assigned','InProgress','Escalated') and ${reviewAssignmentsTable.dueAt} < ${now})::int`,
      dueToday: sql<number>`count(*) filter (where ${reviewAssignmentsTable.status} in ('Assigned','InProgress','Escalated') and ${reviewAssignmentsTable.dueAt} >= ${now} and ${reviewAssignmentsTable.dueAt} < ${new Date(today.getTime() + 86_400_000)})::int`,
    })
    .from(reviewAssignmentsTable)
    .where(
      and(
        eq(reviewAssignmentsTable.organizationId, organizationId),
        eq(reviewAssignmentsTable.assigneeUserId, userId),
      ),
    );

  const [perf] = await db
    .select({
      completedToday: sql<number>`count(*) filter (where ${reviewMetricsTable.completedAt} >= ${today})::int`,
      avg: sql<string | null>`avg(${reviewMetricsTable.reviewMinutes})`,
      slaMet: sql<number>`count(*) filter (where ${reviewMetricsTable.metSla} is true)::int`,
      slaTotal: sql<number>`count(*) filter (where ${reviewMetricsTable.metSla} is not null)::int`,
    })
    .from(reviewMetricsTable)
    .where(
      and(
        eq(reviewMetricsTable.organizationId, organizationId),
        eq(reviewMetricsTable.assigneeUserId, userId),
      ),
    );

  const slaTotal = perf?.slaTotal ?? 0;

  const queueRows = await listAssignments(
    organizationId,
    { assigneeUserId: userId },
    [],
    null,
  );
  const activeQueue = queueRows.filter((r) =>
    ACTIVE_STATUSES.includes(r.assignment.status),
  );
  activeQueue.sort((a, b) => {
    const ad = a.assignment.dueAt ? new Date(a.assignment.dueAt).getTime() : Infinity;
    const bd = b.assignment.dueAt ? new Date(b.assignment.dueAt).getTime() : Infinity;
    return ad - bd;
  });

  const historyRows = await db
    .select({
      id: reviewHistoryTable.id,
      packageId: reviewHistoryTable.packageId,
      packageName: packagesTable.name,
      action: reviewHistoryTable.action,
      detail: reviewHistoryTable.detail,
      reason: reviewHistoryTable.reason,
      comments: reviewHistoryTable.comments,
      actorName: reviewHistoryTable.actorName,
      createdAt: reviewHistoryTable.createdAt,
    })
    .from(reviewHistoryTable)
    .leftJoin(packagesTable, eq(reviewHistoryTable.packageId, packagesTable.id))
    .where(
      and(
        eq(reviewHistoryTable.organizationId, organizationId),
        or(
          eq(reviewHistoryTable.actorUserId, userId),
          eq(reviewHistoryTable.toUserId, userId),
        ),
      ),
    )
    .orderBy(desc(reviewHistoryTable.createdAt))
    .limit(15);

  return {
    metrics: {
      assigned: live?.assigned ?? 0,
      inProgress: live?.inProgress ?? 0,
      overdue: live?.overdue ?? 0,
      dueToday: live?.dueToday ?? 0,
      escalated: live?.escalated ?? 0,
      completedToday: perf?.completedToday ?? 0,
      slaComplianceRate:
        slaTotal > 0 ? Math.round(((perf?.slaMet ?? 0) / slaTotal) * 100) / 100 : null,
      avgReviewMinutes:
        perf?.avg === null || perf?.avg === undefined
          ? null
          : Math.round(Number(perf.avg)),
    },
    queue: activeQueue.map((r) => ({
      assignment: mapAssignmentRow(r),
      packageName: r.packageName,
      packageSku: r.packageSku,
      category: r.category,
      criticalCount: r.criticalCount,
      complianceStatus: r.complianceStatus,
    })),
    recentActivity: historyRows.map((h) => ({
      id: h.id,
      packageId: h.packageId,
      packageName: h.packageName ?? `Package ${h.packageId}`,
      action: h.action,
      detail: h.detail,
      reason: h.reason,
      comments: h.comments,
      actorName: h.actorName,
      createdAt: (h.createdAt ? new Date(h.createdAt) : new Date()).toISOString(),
    })),
    generatedAt: now.toISOString(),
  };
}

// Shared DTO shaping for a listAssignments row so my-work + assignment lists
// emit the same assignment shape (with backup/manager names) the client expects.
function mapAssignmentRow(r: Awaited<ReturnType<typeof listAssignments>>[number]) {
  return mapReviewAssignment(r.assignment, {
    teamName: r.teamName,
    assigneeName: r.assigneeName,
    backupName: r.backupName,
    managerName: r.managerName,
  });
}

export interface OversightMember {
  userId: number;
  name: string;
  email: string | null;
  roleKey: string;
  teamNames: string[];
  assigned: number;
  inProgress: number;
  open: number;
  completedToday: number;
  critical: number;
  overdue: number;
  escalated: number;
  capacity: number;
  utilization: number;
  avgReviewMinutes: number | null;
  slaComplianceRate: number | null;
  lastActivityAt: string | null;
  status: "idle" | "available" | "busy" | "overloaded";
}

export interface OversightTeam {
  teamId: number;
  teamName: string;
  memberCount: number;
  assigned: number;
  open: number;
  completed: number;
  critical: number;
  overdue: number;
  capacity: number;
  utilization: number;
  avgReviewMinutes: number | null;
  slaComplianceRate: number | null;
}

// Manager-facing ownership + workload view: one row per reviewer (across all
// their teams) and one row per team. Team-scoped for managers, org-wide for
// oversight roles. Mirrors computeWorkload's scoping contract.
export async function computeOversight(
  organizationId: number,
  teamIds: number[] | null = null,
): Promise<{ members: OversightMember[]; teams: OversightTeam[]; generatedAt: string }> {
  const now = new Date();
  const today = startOfToday(now);
  const assignTeamCond =
    teamIds === null ? undefined : inArray(reviewAssignmentsTable.teamId, teamIds);
  const metricsTeamCond =
    teamIds === null ? undefined : inArray(reviewMetricsTable.teamId, teamIds);

  // Live assignment rows joined with package critical counts, aggregated in JS.
  const activeRows = await db
    .select({
      assigneeUserId: reviewAssignmentsTable.assigneeUserId,
      teamId: reviewAssignmentsTable.teamId,
      status: reviewAssignmentsTable.status,
      escalationLevel: reviewAssignmentsTable.escalationLevel,
      dueAt: reviewAssignmentsTable.dueAt,
      updatedAt: reviewAssignmentsTable.updatedAt,
      criticalCount: packagesTable.criticalCount,
    })
    .from(reviewAssignmentsTable)
    .innerJoin(packagesTable, eq(reviewAssignmentsTable.packageId, packagesTable.id))
    .where(
      and(
        eq(reviewAssignmentsTable.organizationId, organizationId),
        inArray(reviewAssignmentsTable.status, ACTIVE_STATUSES),
        assignTeamCond,
      ),
    );

  interface Agg {
    assigned: number;
    inProgress: number;
    escalated: number;
    overdue: number;
    critical: number;
    lastActivityAt: number | null;
  }
  const emptyAgg = (): Agg => ({
    assigned: 0,
    inProgress: 0,
    escalated: 0,
    overdue: 0,
    critical: 0,
    lastActivityAt: null,
  });
  const byUser = new Map<number, Agg>();
  const byTeamLive = new Map<number, Agg>();
  const bump = (map: Map<number, Agg>, key: number | null, r: (typeof activeRows)[number]) => {
    if (key === null) return;
    const a = map.get(key) ?? emptyAgg();
    a.assigned += 1;
    if (r.status === "InProgress") a.inProgress += 1;
    if ((r.escalationLevel ?? 0) > 0) a.escalated += 1;
    if (r.dueAt && new Date(r.dueAt).getTime() < now.getTime()) a.overdue += 1;
    if ((r.criticalCount ?? 0) > 0) a.critical += 1;
    const u = r.updatedAt ? new Date(r.updatedAt).getTime() : null;
    if (u && (a.lastActivityAt === null || u > a.lastActivityAt)) a.lastActivityAt = u;
    map.set(key, a);
  };
  for (const r of activeRows) {
    bump(byUser, r.assigneeUserId, r);
    bump(byTeamLive, r.teamId, r);
  }

  // Per-user completed-today + all-time avg/sla from metrics.
  const perfRows = await db
    .select({
      assigneeUserId: reviewMetricsTable.assigneeUserId,
      completedToday: sql<number>`count(*) filter (where ${reviewMetricsTable.completedAt} >= ${today})::int`,
      avg: sql<string | null>`avg(${reviewMetricsTable.reviewMinutes})`,
      slaMet: sql<number>`count(*) filter (where ${reviewMetricsTable.metSla} is true)::int`,
      slaTotal: sql<number>`count(*) filter (where ${reviewMetricsTable.metSla} is not null)::int`,
    })
    .from(reviewMetricsTable)
    .where(and(eq(reviewMetricsTable.organizationId, organizationId), metricsTeamCond))
    .groupBy(reviewMetricsTable.assigneeUserId);
  const perfByUser = new Map<
    number,
    { completedToday: number; avg: number | null; slaMet: number; slaTotal: number }
  >();
  for (const r of perfRows) {
    if (r.assigneeUserId === null) continue;
    perfByUser.set(r.assigneeUserId, {
      completedToday: r.completedToday,
      avg: r.avg === null ? null : Math.round(Number(r.avg)),
      slaMet: r.slaMet,
      slaTotal: r.slaTotal,
    });
  }

  // Users (active) in scope, with their team memberships. When team-scoped, only
  // members of those teams; otherwise all active users on any team.
  const memberRows = await db
    .select({
      userId: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      roleKey: usersTable.roleKey,
      teamId: teamMembersTable.teamId,
      teamName: teamsTable.name,
    })
    .from(teamMembersTable)
    .innerJoin(usersTable, eq(teamMembersTable.userId, usersTable.id))
    .leftJoin(teamsTable, eq(teamMembersTable.teamId, teamsTable.id))
    .where(
      and(
        eq(usersTable.organizationId, organizationId),
        eq(usersTable.active, true),
        teamIds === null ? undefined : inArray(teamMembersTable.teamId, teamIds),
      ),
    )
    .orderBy(usersTable.id);

  const memberMap = new Map<number, OversightMember>();
  for (const m of memberRows) {
    let entry = memberMap.get(m.userId);
    if (!entry) {
      const agg = byUser.get(m.userId) ?? emptyAgg();
      const perf = perfByUser.get(m.userId);
      const slaTotal = perf?.slaTotal ?? 0;
      entry = {
        userId: m.userId,
        name: m.name,
        email: m.email,
        roleKey: m.roleKey,
        teamNames: [],
        assigned: agg.assigned,
        inProgress: agg.inProgress,
        open: agg.assigned,
        completedToday: perf?.completedToday ?? 0,
        critical: agg.critical,
        overdue: agg.overdue,
        escalated: agg.escalated,
        capacity: DEFAULT_CAPACITY,
        utilization:
          DEFAULT_CAPACITY > 0
            ? Math.round((agg.assigned / DEFAULT_CAPACITY) * 100) / 100
            : 0,
        avgReviewMinutes: perf?.avg ?? null,
        slaComplianceRate:
          slaTotal > 0 ? Math.round(((perf?.slaMet ?? 0) / slaTotal) * 100) / 100 : null,
        lastActivityAt:
          agg.lastActivityAt !== null ? new Date(agg.lastActivityAt).toISOString() : null,
        status:
          agg.assigned === 0
            ? "idle"
            : agg.assigned > DEFAULT_CAPACITY
              ? "overloaded"
              : agg.assigned >= Math.ceil(DEFAULT_CAPACITY * 0.75)
                ? "busy"
                : "available",
      };
      memberMap.set(m.userId, entry);
    }
    if (m.teamName && !entry.teamNames.includes(m.teamName)) {
      entry.teamNames.push(m.teamName);
    }
  }
  const members = Array.from(memberMap.values());

  // Teams: live aggregates + completed / avg / sla from metrics.
  const teams = await db
    .select({ id: teamsTable.id, name: teamsTable.name })
    .from(teamsTable)
    .where(
      teamIds === null
        ? eq(teamsTable.organizationId, organizationId)
        : and(
            eq(teamsTable.organizationId, organizationId),
            inArray(teamsTable.id, teamIds),
          ),
    )
    .orderBy(teamsTable.name);

  const teamMetricRows = await db
    .select({
      teamId: reviewMetricsTable.teamId,
      completed: sql<number>`count(*)::int`,
      avg: sql<string | null>`avg(${reviewMetricsTable.reviewMinutes})`,
      slaMet: sql<number>`count(*) filter (where ${reviewMetricsTable.metSla} is true)::int`,
      slaTotal: sql<number>`count(*) filter (where ${reviewMetricsTable.metSla} is not null)::int`,
    })
    .from(reviewMetricsTable)
    .where(and(eq(reviewMetricsTable.organizationId, organizationId), metricsTeamCond))
    .groupBy(reviewMetricsTable.teamId);
  const teamMetricMap = new Map(teamMetricRows.map((r) => [r.teamId, r]));

  const memberCountByTeam = new Map<number, number>();
  for (const m of memberRows) {
    if (m.teamId === null) continue;
    memberCountByTeam.set(m.teamId, (memberCountByTeam.get(m.teamId) ?? 0) + 1);
  }

  const teamsOut: OversightTeam[] = teams.map((t) => {
    const live = byTeamLive.get(t.id) ?? emptyAgg();
    const tm = teamMetricMap.get(t.id);
    const memberCount = memberCountByTeam.get(t.id) ?? 0;
    const capacity = memberCount * DEFAULT_CAPACITY;
    const slaTotal = tm?.slaTotal ?? 0;
    return {
      teamId: t.id,
      teamName: t.name,
      memberCount,
      assigned: live.assigned,
      open: live.assigned,
      completed: tm?.completed ?? 0,
      critical: live.critical,
      overdue: live.overdue,
      capacity,
      utilization:
        capacity > 0 ? Math.round((live.assigned / capacity) * 100) / 100 : 0,
      avgReviewMinutes:
        tm?.avg === null || tm?.avg === undefined ? null : Math.round(Number(tm.avg)),
      slaComplianceRate:
        slaTotal > 0 ? Math.round(((tm?.slaMet ?? 0) / slaTotal) * 100) / 100 : null,
    };
  });

  return { members, teams: teamsOut, generatedAt: now.toISOString() };
}

export interface AssignmentRecommendation {
  requestedUserId: number | null;
  requestedName: string | null;
  requestedActiveCount: number;
  capacity: number;
  overCapacity: boolean;
  suggested: {
    userId: number;
    name: string;
    activeCount: number;
    capacity: number;
    teamNames: string[];
  }[];
  reason: string;
}

// Suggest better-balanced assignees. If the chosen reviewer is at/over capacity
// (or none was chosen), returns the least-loaded members in scope so the UI can
// steer the assignment toward a lighter teammate.
export async function recommendAssignee(
  organizationId: number,
  opts: { assigneeUserId?: number; teamId?: number },
  teamIds: number[] | null = null,
): Promise<AssignmentRecommendation> {
  const oversight = await computeOversight(organizationId, teamIds);
  let pool = oversight.members;
  if (opts.teamId !== undefined) {
    // Restrict to members of the requested team (by team name membership).
    const teamName = oversight.teams.find((t) => t.teamId === opts.teamId)?.teamName;
    if (teamName) pool = pool.filter((m) => m.teamNames.includes(teamName));
  }

  const requested =
    opts.assigneeUserId !== undefined
      ? (oversight.members.find((m) => m.userId === opts.assigneeUserId) ?? null)
      : null;
  const capacity = DEFAULT_CAPACITY;
  const requestedActiveCount = requested?.assigned ?? 0;
  const overCapacity = requested ? requested.assigned >= capacity : false;

  const suggested = [...pool]
    .filter((m) => m.userId !== opts.assigneeUserId && m.assigned < capacity)
    .sort((a, b) => a.assigned - b.assigned)
    .slice(0, 3)
    .map((m) => ({
      userId: m.userId,
      name: m.name,
      activeCount: m.assigned,
      capacity,
      teamNames: m.teamNames,
    }));

  let reason: string;
  if (!requested && opts.assigneeUserId === undefined) {
    reason =
      suggested.length > 0
        ? `${suggested[0]!.name} has the lightest load (${suggested[0]!.activeCount} active).`
        : "No available reviewers found in scope.";
  } else if (overCapacity) {
    reason = `${requested?.name ?? "This reviewer"} is at capacity (${requestedActiveCount}/${capacity}).${
      suggested.length > 0 ? ` Consider ${suggested[0]!.name} (${suggested[0]!.activeCount} active).` : ""
    }`;
  } else {
    reason = `${requested?.name ?? "This reviewer"} has capacity (${requestedActiveCount}/${capacity}).`;
  }

  return {
    requestedUserId: requested?.userId ?? null,
    requestedName: requested?.name ?? null,
    requestedActiveCount,
    capacity,
    overCapacity,
    suggested,
    reason,
  };
}

// Aggregate SLA + review-time metrics for reporting dashboards. When teamIds is
// a list, metrics are restricted to those teams (team-scoped callers); when null
// the whole organization is reported (org-wide oversight).
export async function computeMetrics(
  organizationId: number,
  teamIds: number[] | null = null,
) {
  const metricsTeamCond =
    teamIds === null ? undefined : inArray(reviewMetricsTable.teamId, teamIds);
  const assignTeamCond =
    teamIds === null ? undefined : inArray(reviewAssignmentsTable.teamId, teamIds);

  const [totals] = await db
    .select({
      totalCompleted: sql<number>`count(*)::int`,
      avg: sql<string | null>`avg(${reviewMetricsTable.reviewMinutes})`,
      slaMet: sql<number>`count(*) filter (where ${reviewMetricsTable.metSla} is true)::int`,
      slaBreached: sql<number>`count(*) filter (where ${reviewMetricsTable.metSla} is false)::int`,
    })
    .from(reviewMetricsTable)
    .where(and(eq(reviewMetricsTable.organizationId, organizationId), metricsTeamCond));

  const totalCompleted = totals?.totalCompleted ?? 0;
  const slaMet = totals?.slaMet ?? 0;
  const slaBreached = totals?.slaBreached ?? 0;
  const slaDenom = slaMet + slaBreached;

  const now = new Date();
  const [live] = await db
    .select({
      openReviews: sql<number>`count(*) filter (where ${reviewAssignmentsTable.status} in ('Assigned','InProgress','Escalated'))::int`,
      overdueReviews: sql<number>`count(*) filter (where ${reviewAssignmentsTable.status} in ('Assigned','InProgress','Escalated') and ${reviewAssignmentsTable.dueAt} < ${now})::int`,
      escalatedReviews: sql<number>`count(*) filter (where ${reviewAssignmentsTable.escalationLevel} > 0 and ${reviewAssignmentsTable.status} <> 'Completed')::int`,
    })
    .from(reviewAssignmentsTable)
    .where(and(eq(reviewAssignmentsTable.organizationId, organizationId), assignTeamCond));

  const byTeamRows = await db
    .select({
      teamId: reviewMetricsTable.teamId,
      teamName: teamsTable.name,
      completed: sql<number>`count(*)::int`,
      avg: sql<string | null>`avg(${reviewMetricsTable.reviewMinutes})`,
      slaMet: sql<number>`count(*) filter (where ${reviewMetricsTable.metSla} is true)::int`,
      slaTotal: sql<number>`count(*) filter (where ${reviewMetricsTable.metSla} is not null)::int`,
    })
    .from(reviewMetricsTable)
    .leftJoin(teamsTable, eq(reviewMetricsTable.teamId, teamsTable.id))
    .where(and(eq(reviewMetricsTable.organizationId, organizationId), metricsTeamCond))
    .groupBy(reviewMetricsTable.teamId, teamsTable.name);

  const recentRows = await db
    .select({
      packageId: reviewMetricsTable.packageId,
      packageName: packagesTable.name,
      teamName: teamsTable.name,
      assigneeName: usersTable.name,
      reviewMinutes: reviewMetricsTable.reviewMinutes,
      metSla: reviewMetricsTable.metSla,
      completedAt: reviewMetricsTable.completedAt,
    })
    .from(reviewMetricsTable)
    .leftJoin(packagesTable, eq(reviewMetricsTable.packageId, packagesTable.id))
    .leftJoin(teamsTable, eq(reviewMetricsTable.teamId, teamsTable.id))
    .leftJoin(usersTable, eq(reviewMetricsTable.assigneeUserId, usersTable.id))
    .where(and(eq(reviewMetricsTable.organizationId, organizationId), metricsTeamCond))
    .orderBy(desc(reviewMetricsTable.completedAt))
    .limit(15);

  return {
    totalCompleted,
    avgReviewMinutes:
      totals?.avg === null || totals?.avg === undefined
        ? null
        : Math.round(Number(totals.avg)),
    slaMet,
    slaBreached,
    slaComplianceRate:
      slaDenom > 0 ? Math.round((slaMet / slaDenom) * 100) / 100 : null,
    openReviews: live?.openReviews ?? 0,
    overdueReviews: live?.overdueReviews ?? 0,
    escalatedReviews: live?.escalatedReviews ?? 0,
    byTeam: byTeamRows.map((r) => ({
      teamId: r.teamId,
      teamName: r.teamName ?? "Unassigned",
      completed: r.completed,
      avgReviewMinutes: r.avg === null ? null : Math.round(Number(r.avg)),
      slaComplianceRate:
        r.slaTotal > 0 ? Math.round((r.slaMet / r.slaTotal) * 100) / 100 : null,
    })),
    recent: recentRows.map((r) => ({
      packageId: r.packageId,
      packageName: r.packageName ?? `Package ${r.packageId}`,
      teamName: r.teamName ?? null,
      assigneeName: r.assigneeName ?? null,
      reviewMinutes: r.reviewMinutes,
      metSla: r.metSla,
      completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
    })),
  };
}
