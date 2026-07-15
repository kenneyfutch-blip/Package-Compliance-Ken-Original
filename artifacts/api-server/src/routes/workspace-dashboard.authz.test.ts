import test from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { setAuthContext, type AuthContext } from "../lib/rbac/context";
import { packageConds, opsTeamScope } from "../lib/rbac/scope";
import { resolveDashboardAccess } from "./workspace-dashboard-access";

// Security regression guard for the AI Workspace dashboard (GET /workspace/home).
// The dashboard aggregates existing data into sections and must NEVER widen
// access: review/report sections reuse the exact permission gates and tenant/
// supplier/team scoping of the pages they mirror, and own-data sections are
// scoped to the caller. There is no live DB in this harness (and the seed has no
// supplier_user rows), so — like the storage/proofing authz guards — these tests
// exercise the exact primitives the route relies on, resolved through the single
// pure access plan (resolveDashboardAccess) that the handler builds every query
// from. A regression that drops a gate or a scope predicate fails here.

function ctx(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 1,
    clerkUserId: "clerk_1",
    email: "u@dollartree.com",
    name: "U",
    organizationId: 1,
    roleKey: "reviewer",
    roleName: "Reviewer",
    permissions: new Set<string>(),
    supplierId: null,
    supplierName: null,
    teamIds: [],
    ...overrides,
  };
}

function reqWith(authContext: AuthContext): Request {
  const r = {} as Request;
  setAuthContext(r, authContext);
  return r;
}

// --- Section visibility gates -----------------------------------------------

test("a caller with no permissions cannot see the review or report sections", () => {
  const access = resolveDashboardAccess(reqWith(ctx({ permissions: new Set() })));
  assert.equal(access.canReviews, false);
  assert.equal(access.canReports, false);
});

test("packages:read reveals the review sections; reports:read reveals reports", () => {
  const reviewer = resolveDashboardAccess(
    reqWith(ctx({ permissions: new Set(["packages:read"]) })),
  );
  assert.equal(reviewer.canReviews, true);
  assert.equal(reviewer.canReports, false);

  const reporter = resolveDashboardAccess(
    reqWith(ctx({ permissions: new Set(["reports:read"]) })),
  );
  assert.equal(reporter.canReviews, false);
  assert.equal(reporter.canReports, true);
});

test("a supplier user without packages:read is not shown any review section", () => {
  const access = resolveDashboardAccess(
    reqWith(ctx({ roleKey: "supplier_user", supplierId: 7, permissions: new Set() })),
  );
  assert.equal(access.canReviews, false);
});

// --- Own-data scoping (conversations / activity / proposals) -----------------

test("the access plan carries the caller's own org + user id for own-data sections", () => {
  const access = resolveDashboardAccess(
    reqWith(ctx({ organizationId: 42, userId: 99 })),
  );
  assert.equal(access.organizationId, 42);
  assert.equal(access.userId, 99);
  // The review scope threads the same identity through to listAssignments.
  assert.equal(access.reviewScope.organizationId, 42);
  assert.equal(access.reviewScope.userId, 99);
});

// --- Review scope: supplier isolation ---------------------------------------

test("a supplier user's review scope adds a supplier predicate on top of the org predicate", () => {
  const supplier = resolveDashboardAccess(
    reqWith(ctx({ roleKey: "supplier_user", supplierId: 7, permissions: new Set(["packages:read"]) })),
  );
  const internal = resolveDashboardAccess(
    reqWith(ctx({ roleKey: "reviewer", permissions: new Set(["packages:read"]) })),
  );
  // Internal role: org-only package scope (1 predicate). Supplier: org + supplier
  // (2 predicates) — the extra predicate is what confines them to their own rows.
  assert.equal(internal.reviewScope.packageScope.length, 1);
  assert.equal(supplier.reviewScope.packageScope.length, 2);
});

test("packageConds (the review scope primitive) is supplier-scoped only for supplier users", () => {
  assert.equal(packageConds(reqWith(ctx({ roleKey: "reviewer" }))).length, 1);
  assert.equal(
    packageConds(reqWith(ctx({ roleKey: "compliance_specialist" }))).length,
    1,
  );
  assert.equal(
    packageConds(reqWith(ctx({ roleKey: "supplier_user", supplierId: 7 }))).length,
    2,
  );
  // Deny-by-default: an UNLINKED supplier still gets the supplier predicate (it
  // resolves to a sentinel id that matches no row), never falls back to org-wide.
  assert.equal(
    packageConds(reqWith(ctx({ roleKey: "supplier_user", supplierId: null })))
      .length,
    2,
  );
});

// --- Review scope: team isolation -------------------------------------------

test("a team-scoped reviewer's review scope is restricted to their own teams + themselves", () => {
  const access = resolveDashboardAccess(
    reqWith(
      ctx({ roleKey: "reviewer", userId: 5, teamIds: [3, 4], permissions: new Set(["packages:read"]) }),
    ),
  );
  assert.deepEqual(access.reviewScope.teamScope, { teamIds: [3, 4], userId: 5 });
});

test("org-wide oversight roles are NOT team-restricted (they see every team's reviews)", () => {
  for (const roleKey of ["platform_admin", "compliance_director", "executive_viewer"]) {
    const access = resolveDashboardAccess(
      reqWith(ctx({ roleKey, teamIds: [1], permissions: new Set(["packages:read"]) })),
    );
    assert.equal(
      access.reviewScope.teamScope,
      null,
      `${roleKey} must not be team-restricted`,
    );
  }
});

test("a supplier user has no team scope (isolation is enforced by the supplier predicate instead)", () => {
  const access = resolveDashboardAccess(
    reqWith(ctx({ roleKey: "supplier_user", supplierId: 7, teamIds: [1], permissions: new Set(["packages:read"]) })),
  );
  assert.equal(access.reviewScope.teamScope, null);
});

test("opsTeamScope (the team scope primitive) matches the review scope for every role class", () => {
  const reviewer = reqWith(ctx({ roleKey: "reviewer", userId: 5, teamIds: [2] }));
  assert.deepEqual(opsTeamScope(reviewer), { teamIds: [2], userId: 5 });
  assert.equal(opsTeamScope(reqWith(ctx({ roleKey: "platform_admin" }))), null);
  assert.equal(
    opsTeamScope(reqWith(ctx({ roleKey: "supplier_user", supplierId: 7 }))),
    null,
  );
});
