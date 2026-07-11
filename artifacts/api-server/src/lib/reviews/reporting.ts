import {
  db,
  reviewAssignmentsTable,
  reviewMetricsTable,
  teamsTable,
  teamMembersTable,
  usersTable,
  packagesTable,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
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
    })
    .from(reviewAssignmentsTable)
    .innerJoin(packagesTable, eq(reviewAssignmentsTable.packageId, packagesTable.id))
    .leftJoin(teamsTable, eq(reviewAssignmentsTable.teamId, teamsTable.id))
    .leftJoin(usersTable, eq(reviewAssignmentsTable.assigneeUserId, usersTable.id))
    .where(and(...conds))
    .orderBy(desc(reviewAssignmentsTable.updatedAt));
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
