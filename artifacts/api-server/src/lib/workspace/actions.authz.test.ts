import test from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { setAuthContext, type AuthContext } from "../rbac/context";
import {
  availableActionsFor,
  findAction,
  callerMayRunAction,
} from "./actions";

// Security regression guard for the AI Workspace ACTION layer (Phase 3). Actions
// let the assistant PROPOSE and, on explicit confirmation, INITIATE platform
// operations. The two enforcement layers exercised here:
//   1. Offer gating (availableActionsFor) — a caller is only offered actions
//      whose required permissions they ALL hold, and a supplier_user is NEVER
//      offered a non-supplier-safe (all state-changing) action.
//   2. Confirm-time re-check (callerMayRunAction) — the confirm endpoint
//      re-validates permission + supplier gate independently of what was offered
//      during the stream (defense in depth against a forged/replayed confirm).

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

const SENSITIVE = [
  "create_review",
  "assign_reviewer",
  "escalate_review",
  "create_task",
  "generate_report",
];
const NON_SENSITIVE = [
  "summarize_findings",
  "draft_approval_notes",
  "compare_versions",
  "prepare_executive_summary",
];
const ALL_PERMS = [
  "packages:read",
  "packages:write",
  "violations:read",
  "reports:write",
];

// --- Offer gating -----------------------------------------------------------

test("no permissions: no actions are offered", () => {
  const actions = availableActionsFor(reqWith(ctx({ permissions: new Set() })));
  assert.equal(actions.length, 0);
});

test("a fully-permitted internal user is offered every action", () => {
  const actions = availableActionsFor(
    reqWith(ctx({ permissions: new Set(ALL_PERMS) })),
  );
  const names = actions.map((a) => a.name).sort();
  for (const n of [...SENSITIVE, ...NON_SENSITIVE]) {
    assert.ok(names.includes(n), `expected action ${n} to be offered`);
  }
});

test("every state-changing action is sensitive AND internal-only", () => {
  const actions = availableActionsFor(
    reqWith(ctx({ permissions: new Set(ALL_PERMS) })),
  );
  for (const name of SENSITIVE) {
    const a = actions.find((x) => x.name === name)!;
    assert.ok(a, `action ${name} missing`);
    assert.equal(a.sensitive, true, `${name} must be sensitive`);
    assert.equal(a.supplierSafe, false, `${name} must be internal-only`);
    assert.ok(
      a.requiredPerms.length >= 1,
      `${name} must require at least one permission`,
    );
  }
});

test("read-only/derived actions are non-sensitive and supplier-safe", () => {
  const actions = availableActionsFor(
    reqWith(ctx({ permissions: new Set(ALL_PERMS) })),
  );
  for (const name of NON_SENSITIVE) {
    const a = actions.find((x) => x.name === name)!;
    assert.ok(a, `action ${name} missing`);
    assert.equal(a.sensitive, false, `${name} must be non-sensitive`);
    assert.equal(a.supplierSafe, true, `${name} must be supplier-safe`);
  }
});

test("a supplier user is NEVER offered any sensitive action, even holding every permission", () => {
  const actions = availableActionsFor(
    reqWith(
      ctx({
        roleKey: "supplier_user",
        supplierId: 7,
        permissions: new Set(ALL_PERMS),
      }),
    ),
  );
  const names = actions.map((a) => a.name);
  for (const name of SENSITIVE) {
    assert.ok(!names.includes(name), `supplier must not be offered ${name}`);
  }
});

test("a supplier user IS offered supplier-safe derived actions they have permission for", () => {
  const actions = availableActionsFor(
    reqWith(
      ctx({
        roleKey: "supplier_user",
        supplierId: 7,
        permissions: new Set(["packages:read", "violations:read"]),
      }),
    ),
  );
  const names = actions.map((a) => a.name);
  assert.ok(names.includes("summarize_findings"));
  assert.ok(names.includes("draft_approval_notes"));
  assert.ok(names.includes("compare_versions"));
  assert.ok(names.includes("prepare_executive_summary"));
});

test("an action is offered only when ALL its required permissions are held", () => {
  // generate_report requires reports:write; a reviewer without it is not offered
  // it, but is offered the packages:write actions.
  const actions = availableActionsFor(
    reqWith(ctx({ permissions: new Set(["packages:write"]) })),
  );
  const names = actions.map((a) => a.name);
  assert.ok(names.includes("create_review"));
  assert.ok(names.includes("assign_reviewer"));
  assert.ok(!names.includes("generate_report"));
});

// --- Confirm-time re-check (defense in depth) -------------------------------

test("callerMayRunAction denies a caller lacking the required permission", () => {
  const generateReport = findAction("generate_report")!;
  // Holds packages:write but NOT reports:write.
  const req = reqWith(ctx({ permissions: new Set(["packages:write"]) }));
  assert.equal(callerMayRunAction(req, generateReport), false);
});

test("callerMayRunAction allows a caller holding every required permission", () => {
  const createReview = findAction("create_review")!;
  const req = reqWith(ctx({ permissions: new Set(["packages:write"]) }));
  assert.equal(callerMayRunAction(req, createReview), true);
});

test("callerMayRunAction denies a supplier a state-changing action even with the permission bits", () => {
  const assignReviewer = findAction("assign_reviewer")!;
  const req = reqWith(
    ctx({
      roleKey: "supplier_user",
      supplierId: 7,
      permissions: new Set(ALL_PERMS),
    }),
  );
  assert.equal(callerMayRunAction(req, assignReviewer), false);
});

test("findAction resolves known actions and rejects unknown", () => {
  assert.ok(findAction("create_review"));
  assert.equal(findAction("drop_database"), undefined);
});
