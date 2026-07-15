import test, { mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  db,
  aiConversationsTable,
  reviewAssignmentsTable,
  reportsTable,
  workspaceActionProposalsTable,
  workspaceAgentRunsTable,
} from "@workspace/db";
import { setAuthContext, type AuthContext } from "../../lib/rbac/context";
import { openAiAgentProvider } from "../../lib/agents/openai-provider";
import dashboardRouter from "../workspace-dashboard";

// Security regression guard for the AI Workspace DASHBOARD (`GET /workspace/home`).
//
// The dashboard aggregates 8 sections and must surface ONLY what the caller can
// already see elsewhere:
//   * Own-data sections (conversations, saved investigations, suggested actions,
//     agent + specialist activity) are scoped to org + the calling user.
//   * The review/assignment sections reuse the reviews page scoping
//     (packageConds supplier restriction + opsTeamScope team restriction).
//   * The report/review sections are permission-gated (visible=false + empty when
//     the caller lacks the permission), and recentReports mirrors the real
//     /reports contract (org + reports:read only).
//
// The seed has no supplier_user rows, so this isolation can't be curl-tested. We
// drive the actual handler with a fake DB query builder that RECORDS the table
// and the WHERE predicate of every query, then assert the scoping that reached
// each section's SQL — proving the guarantee at the query layer, not just in the
// section wiring.

// ---------------------------------------------------------------------------
// Auth context + request/response helpers (same shape as actions.authz.test.ts).
// ---------------------------------------------------------------------------

function ctx(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 42,
    clerkUserId: "clerk_42",
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
  const r = {
    method: "GET",
    url: "/workspace/home",
    query: {},
    params: {},
  } as unknown as Request;
  setAuthContext(r, authContext);
  return r;
}

type HomeItem = { id: string };
type HomeSection = {
  key: string;
  visible: boolean;
  items: HomeItem[];
};
type HomeResponse = { sections: HomeSection[] };

function mockRes(): { res: Response; body: () => HomeResponse } {
  let payload: unknown;
  const res = {
    status() {
      return res;
    },
    json(b: unknown) {
      payload = b;
      return res;
    },
  } as unknown as Response;
  return { res, body: () => payload as HomeResponse };
}

// ---------------------------------------------------------------------------
// Fake DB query builder.
//
// Every db.select(...) call is intercepted and returns a thenable builder whose
// chain methods (from/joins/where/orderBy/groupBy/limit/offset) all return the
// same builder. On `from(table)` it records which table is being queried; on
// `where(cond)` it records the predicate. Awaiting the builder resolves to an
// empty result set — the security guarantee under test lives in the WHERE clause
// (recorded here), not in any returned rows.
// ---------------------------------------------------------------------------

interface RecordedQuery {
  table: unknown;
  where: SQL | undefined;
}

let recorded: RecordedQuery[] = [];

function fakeSelect(): unknown {
  const q: RecordedQuery = { table: undefined, where: undefined };
  recorded.push(q);
  const builder: Record<string, unknown> = {};
  const passthrough = () => builder;
  for (const m of [
    "from",
    "innerJoin",
    "leftJoin",
    "rightJoin",
    "fullJoin",
    "orderBy",
    "groupBy",
    "having",
    "limit",
    "offset",
    "for",
  ]) {
    builder[m] = (...args: unknown[]) => {
      if (m === "from") q.table = args[0];
      return passthrough();
    };
  }
  builder["where"] = (cond: SQL) => {
    q.where = cond;
    return passthrough();
  };
  // Thenable: `await db.select()...` resolves to an empty row set.
  builder["then"] = (resolve: (rows: unknown[]) => unknown) => resolve([]);
  return builder;
}

const dialect = new PgDialect();

// Render a recorded WHERE predicate to its parameterized SQL text + params.
function renderWhere(q: RecordedQuery | undefined): { sql: string; params: unknown[] } {
  if (!q || !q.where) return { sql: "", params: [] };
  const built = dialect.sqlToQuery(q.where);
  return { sql: built.sql, params: built.params };
}

function queriesFor(table: unknown): RecordedQuery[] {
  return recorded.filter((q) => q.table === table);
}

// Invoke the real GET /workspace/home handler with a mocked DB + provider.
async function callHome(authContext: AuthContext): Promise<HomeResponse> {
  recorded = [];
  const handler = getRouteHandler("/workspace/home", "get");
  const req = reqWith(authContext);
  const { res, body } = mockRes();
  await handler(req, res, () => {});
  return body();
}

// Pull the concrete handler out of the express Router stack so we can invoke it
// directly (no HTTP server, no auth middleware) and await its completion.
function getRouteHandler(
  path: string,
  method: string,
): (req: Request, res: Response, next: () => void) => Promise<void> {
  const stack = (dashboardRouter as unknown as { stack: any[] }).stack;
  for (const layer of stack) {
    if (layer?.route?.path === path) {
      for (const s of layer.route.stack) {
        if (s.method === method) return s.handle;
      }
    }
  }
  throw new Error(`handler not found for ${method.toUpperCase()} ${path}`);
}

function section(resp: HomeResponse, key: string): HomeSection {
  const s = resp.sections.find((x) => x.key === key);
  assert.ok(s, `section ${key} missing from response`);
  return s;
}

// ---------------------------------------------------------------------------
// Global mocks: never touch the real DB or the AI provider from a unit test.
// ---------------------------------------------------------------------------

mock.method(db, "select", fakeSelect);
// The dashboard resolves the active model for display via the provider; keep it
// local + fast so the test never reaches the network.
mock.method(openAiAgentProvider, "createSession", async () => ({
  model: "test-model",
  // The dashboard only reads `.model`; other session members are unused here.
}) as never);

afterEach(() => {
  recorded = [];
});

// Common roles used across tests.
const SUPPLIER = () =>
  ctx({
    roleKey: "supplier_user",
    supplierId: 7,
    permissions: new Set(["packages:read", "reports:read"]),
  });
const TEAM_OPS = () =>
  ctx({
    roleKey: "reviewer",
    userId: 42,
    teamIds: [10, 20],
    permissions: new Set(["packages:read", "reports:read"]),
  });
const ORG_WIDE = () =>
  ctx({
    roleKey: "platform_admin",
    userId: 42,
    teamIds: [10],
    permissions: new Set(["packages:read", "reports:read"]),
  });

// ===========================================================================
// Supplier isolation — review/assignment sections never widen past the supplier
// ===========================================================================

test("supplier user: every review/assignment query is restricted to their supplier id", async () => {
  await callHome(SUPPLIER());
  const q = queriesFor(reviewAssignmentsTable);
  // Both assignedReviews and recentReviews go through listAssignments.
  assert.ok(q.length >= 2, "expected assigned + recent review queries");
  for (const query of q) {
    const { sql, params } = renderWhere(query);
    assert.match(
      sql,
      /supplier_id/,
      "assignment query must restrict on packages.supplier_id",
    );
    assert.ok(
      params.includes(7),
      "assignment query must bind the caller's own supplier id (7)",
    );
    // A supplier caller is never team-scoped (opsTeamScope returns null); the
    // supplier restriction alone confines them.
    assert.doesNotMatch(
      sql,
      /team_id/,
      "supplier caller must not carry a team-scope predicate",
    );
  }
});

test("supplier user: never sees another supplier's id in any review query", async () => {
  await callHome(SUPPLIER());
  for (const query of queriesFor(reviewAssignmentsTable)) {
    const { params } = renderWhere(query);
    const otherSupplierIds = params.filter(
      (p) => typeof p === "number" && p !== 7 && p !== 1 && p !== 42,
    );
    // Only the caller's supplier id, org id, and own user id may appear.
    assert.deepEqual(
      otherSupplierIds,
      [],
      `no foreign ids may leak into supplier-scoped review query, saw ${JSON.stringify(params)}`,
    );
  }
});

test("unlinked supplier user (null supplierId) is denied by default, never org-wide", async () => {
  // A supplier_user with no linked supplier must match the sentinel -1 (which can
  // never equal a real row) rather than falling through to see everything.
  await callHome(
    ctx({
      roleKey: "supplier_user",
      supplierId: null,
      permissions: new Set(["packages:read"]),
    }),
  );
  const q = queriesFor(reviewAssignmentsTable);
  assert.ok(q.length >= 1);
  for (const query of q) {
    const { sql, params } = renderWhere(query);
    assert.match(sql, /supplier_id/);
    assert.ok(
      params.includes(-1),
      "unlinked supplier user must be scoped to the -1 sentinel (deny-by-default)",
    );
  }
});

// ===========================================================================
// Team scoping — a team-scoped ops user only sees their own teams' reviews
// ===========================================================================

test("team-scoped ops user: review queries are restricted to their team scope", async () => {
  await callHome(TEAM_OPS());
  const q = queriesFor(reviewAssignmentsTable);
  assert.ok(q.length >= 2);
  for (const query of q) {
    const { sql, params } = renderWhere(query);
    assert.match(sql, /team_id/, "team-scoped caller must carry a team predicate");
    // opsTeamScope restricts to their team ids OR work assigned directly to them.
    assert.ok(params.includes(10) && params.includes(20), "must bind own team ids");
    assert.ok(
      params.includes(42),
      "must also include the caller's user id (own direct assignments)",
    );
    // A non-supplier internal user is not supplier-restricted.
    assert.doesNotMatch(
      sql,
      /supplier_id/,
      "internal ops caller must not be supplier-restricted",
    );
  }
});

test("org-wide oversight role: review queries carry no team or supplier restriction", async () => {
  await callHome(ORG_WIDE());
  const q = queriesFor(reviewAssignmentsTable);
  assert.ok(q.length >= 2);
  for (const query of q) {
    const { sql } = renderWhere(query);
    assert.doesNotMatch(sql, /team_id/, "org-wide role sees all teams");
    assert.doesNotMatch(sql, /supplier_id/, "org-wide role is not supplier-scoped");
    assert.match(sql, /organization_id/, "org boundary is always enforced");
  }
});

// ===========================================================================
// Permission gating — sections the caller can't see are hidden AND unqueried
// ===========================================================================

test("without packages:read: review sections are visible=false, empty, and never queried", async () => {
  const resp = await callHome(ctx({ permissions: new Set(["reports:read"]) }));
  for (const key of ["assignedReviews", "recentReviews"]) {
    const s = section(resp, key);
    assert.equal(s.visible, false, `${key} must be hidden`);
    assert.equal(s.items.length, 0, `${key} must be empty`);
  }
  assert.equal(
    queriesFor(reviewAssignmentsTable).length,
    0,
    "no review query may run when the caller lacks packages:read",
  );
});

test("without reports:read: recentReports is visible=false, empty, and never queried", async () => {
  const resp = await callHome(ctx({ permissions: new Set(["packages:read"]) }));
  const s = section(resp, "recentReports");
  assert.equal(s.visible, false);
  assert.equal(s.items.length, 0);
  assert.equal(
    queriesFor(reportsTable).length,
    0,
    "no report query may run when the caller lacks reports:read",
  );
});

test("with the permissions, the gated sections become visible", async () => {
  const resp = await callHome(TEAM_OPS());
  assert.equal(section(resp, "assignedReviews").visible, true);
  assert.equal(section(resp, "recentReviews").visible, true);
  assert.equal(section(resp, "recentReports").visible, true);
});

// ===========================================================================
// recentReports mirrors the real /reports contract: org filter only
// ===========================================================================

test("recentReports scopes by organization only, matching the /reports endpoint", async () => {
  await callHome(TEAM_OPS());
  const q = queriesFor(reportsTable);
  assert.equal(q.length, 1, "exactly one reports query");
  const { sql, params } = renderWhere(q[0]);
  assert.match(sql, /organization_id/, "reports must be org-scoped");
  assert.ok(params.includes(1), "reports must bind the caller's org id");
  // The /reports endpoint filters on org only (no user/team/supplier filter);
  // the dashboard mirror must not narrow OR widen that.
  assert.doesNotMatch(sql, /user_id/, "reports are org-wide, not per-user");
  assert.doesNotMatch(sql, /team_id/, "reports are org-wide, not per-team");
  assert.doesNotMatch(sql, /supplier_id/, "reports are org-wide, not per-supplier");
});

// ===========================================================================
// Own-data sections — scoped to org + the calling user, always
// ===========================================================================

test("own-data sections are scoped to both the caller's org and user id", async () => {
  const authCtx = ctx({
    organizationId: 3,
    userId: 99,
    permissions: new Set<string>(),
  });
  await callHome(authCtx);

  // aiConversationsTable backs recentConversations AND savedInvestigations.
  const convQueries = queriesFor(aiConversationsTable);
  assert.ok(convQueries.length >= 2, "conversations + saved investigations");
  // workspaceActionProposalsTable backs suggestedActions.
  // workspaceAgentRunsTable backs agentActivity AND specialistActivity.
  const ownDataTables = [
    { table: aiConversationsTable, name: "aiConversations" },
    { table: workspaceActionProposalsTable, name: "actionProposals" },
    { table: workspaceAgentRunsTable, name: "agentRuns" },
  ];
  for (const { table, name } of ownDataTables) {
    const qs = queriesFor(table);
    assert.ok(qs.length >= 1, `${name} must be queried`);
    for (const q of qs) {
      const { sql, params } = renderWhere(q);
      assert.match(sql, /organization_id/, `${name} must be org-scoped`);
      assert.match(sql, /user_id/, `${name} must be scoped to the calling user`);
      assert.ok(params.includes(3), `${name} must bind the caller's org id`);
      assert.ok(params.includes(99), `${name} must bind the caller's user id`);
    }
  }
});

test("own-data sections are always visible regardless of permissions", async () => {
  const resp = await callHome(ctx({ permissions: new Set<string>() }));
  for (const key of [
    "recentConversations",
    "savedInvestigations",
    "suggestedActions",
    "agentActivity",
    "specialistActivity",
  ]) {
    assert.equal(section(resp, key).visible, true, `${key} is own-data, always visible`);
  }
});
