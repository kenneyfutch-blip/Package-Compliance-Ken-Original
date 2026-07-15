import type { Request } from "express";
import { type SQL } from "drizzle-orm";
import { orgId, getAuthContext, hasPermission } from "../lib/rbac/context";
import { packageConds, opsTeamScope } from "../lib/rbac/scope";

// ---------------------------------------------------------------------------
// AI Workspace dashboard access plan.
//
// This is the single, pure (DB-free) place that decides — for one caller — which
// dashboard sections are visible and exactly how the cross-record sections are
// scoped. The GET /workspace/home handler MUST build every review/report query
// from this plan, so the dashboard can never widen access:
//   * canReviews / canReports gate the review and report sections by the SAME
//     permissions their underlying pages require.
//   * reviewScope carries the SAME tenant + supplier (packageConds) and team
//     (opsTeamScope) predicates the reviews surface applies to listAssignments.
//   * organizationId + userId scope every own-data section to the caller.
//
// Keeping this logic pure and separate from the route lets the authz tests prove
// the scoping without a live database, and guarantees a regression that drops a
// gate or a scope predicate is caught here rather than silently leaking rows.
// ---------------------------------------------------------------------------

export type ReviewScope = {
  organizationId: number;
  userId: number;
  // Package-scope predicates for listAssignments (org + supplier restriction).
  packageScope: SQL[];
  // Team scoping for internal callers; null = org-wide oversight / supplier
  // (the latter is handled entirely by packageScope).
  teamScope: { teamIds: number[]; userId: number } | null;
};

export type DashboardAccess = {
  organizationId: number;
  userId: number;
  canReviews: boolean;
  canReports: boolean;
  reviewScope: ReviewScope;
};

export function resolveDashboardAccess(req: Request): DashboardAccess {
  const organizationId = orgId(req);
  const { userId } = getAuthContext(req);
  return {
    organizationId,
    userId,
    // Mirror the permission gates of the pages each section links to.
    canReviews: hasPermission(req, "packages:read"),
    canReports: hasPermission(req, "reports:read"),
    reviewScope: {
      organizationId,
      userId,
      packageScope: packageConds(req),
      teamScope: opsTeamScope(req),
    },
  };
}
