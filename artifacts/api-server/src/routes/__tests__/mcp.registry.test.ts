import test from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { ALL_TOOLS, availableToolsFor } from "../../lib/workspace/tools";
import { setAuthContext, type AuthContext } from "../../lib/rbac/context";
import {
  generatePlaintextToken,
  hashToken,
  displayPrefix,
} from "../../lib/mcp/tokens";

// Security contract for the MCP gateway / AI tool registry.
//
// The MCP layer exposes the workspace tool registry to external agents, so the
// registry itself is the security boundary. These tests pin the invariants the
// gateway depends on:
//   1. The registry can never grow a forbidden capability (deletes, SQL,
//      secrets, environment, role management, source code) without a test
//      failing loudly.
//   2. Every tool must declare at least one required permission — a tool with
//      no RBAC gate would be offered to everyone.
//   3. The offer gate actually filters by permissions and supplier safety.
//   4. Token plaintexts hash deterministically and are never their own hash.

const FORBIDDEN_NAME_PATTERNS: RegExp[] = [
  /delete/i,
  /remove/i,
  /drop/i,
  /purge/i,
  /truncate/i,
  /sql/i,
  /query_db/i,
  /secret/i,
  /credential/i,
  /api_key/i,
  /apikey/i,
  /token/i,
  /env/i,
  /environment/i,
  /config/i,
  /prompt/i,
  /source_code/i,
  /run_command/i,
  /exec/i,
  /shell/i,
  /role/i,
  /permission/i,
  /admin/i,
];

test("registry contains no forbidden tool capabilities", () => {
  for (const tool of ALL_TOOLS) {
    for (const pattern of FORBIDDEN_NAME_PATTERNS) {
      assert.ok(
        !pattern.test(tool.name),
        `Tool "${tool.name}" matches forbidden pattern ${pattern}. ` +
          "The MCP-exposed registry must never contain destructive, secret-, " +
          "config-, or privilege-related tools. If this tool is legitimate, " +
          "rename it AND get an explicit security review of what it exposes.",
      );
    }
  }
});

test("every registry tool declares at least one required permission", () => {
  for (const tool of ALL_TOOLS) {
    assert.ok(
      tool.requiredPerms.length > 0,
      `Tool "${tool.name}" has no requiredPerms — it would be offered to every caller.`,
    );
    assert.equal(typeof tool.supplierSafe, "boolean");
  }
});

function makeReq(ctx: AuthContext): Request {
  const req = {} as Request;
  setAuthContext(req, ctx);
  return req;
}

function ctxWith(overrides: Partial<AuthContext>): AuthContext {
  return {
    userId: 1,
    clerkUserId: "user_test",
    email: "t@dollartree.com",
    name: "Test",
    organizationId: 4,
    roleKey: "compliance_reviewer",
    roleName: "Reviewer",
    permissions: new Set<string>(),
    supplierId: null,
    supplierName: null,
    teamIds: [],
    ...overrides,
  };
}

test("offer gate: no permissions means no tools", () => {
  const offered = availableToolsFor(makeReq(ctxWith({ permissions: new Set() })));
  assert.equal(offered.length, 0);
});

test("offer gate: tools require ALL of their permissions", () => {
  const all = new Set(ALL_TOOLS.flatMap((t) => t.requiredPerms));
  const offered = availableToolsFor(makeReq(ctxWith({ permissions: all })));
  assert.equal(offered.length, ALL_TOOLS.length);
  // Remove one permission and every tool needing it must disappear.
  const [firstPerm] = all;
  const reduced = new Set(all);
  reduced.delete(firstPerm!);
  const offeredReduced = availableToolsFor(
    makeReq(ctxWith({ permissions: reduced })),
  );
  for (const t of offeredReduced) {
    assert.ok(!t.requiredPerms.includes(firstPerm!));
  }
});

test("offer gate: suppliers only ever see supplierSafe tools", () => {
  const all = new Set(ALL_TOOLS.flatMap((t) => t.requiredPerms));
  const offered = availableToolsFor(
    makeReq(
      ctxWith({
        roleKey: "supplier_user",
        supplierId: 7,
        supplierName: "Acme",
        permissions: all, // even with every permission granted
      }),
    ),
  );
  for (const t of offered) {
    assert.equal(t.supplierSafe, true, `supplier offered non-safe tool ${t.name}`);
  }
  assert.ok(offered.length < ALL_TOOLS.length);
});

test("mcp tokens: format, hashing, prefix", () => {
  const a = generatePlaintextToken();
  const b = generatePlaintextToken();
  assert.match(a, /^mcp_[0-9a-f]{48}$/);
  assert.notEqual(a, b);
  assert.equal(hashToken(a), hashToken(a));
  assert.notEqual(hashToken(a), hashToken(b));
  assert.notEqual(hashToken(a), a);
  assert.equal(displayPrefix(a), a.slice(0, 10));
});

// --- Supplier denial on the org-wide ledger endpoint ------------------------
// Even a supplier granted audit:read via a permission override must be denied:
// the ledger spans org-wide internal AI activity. Drive the real handler from
// the router stack (no live HTTP needed).
import mcpTokensRouter from "../mcp-tokens";

type Layer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: (req: Request, res: unknown, next: () => void) => unknown }[];
  };
};

function findHandlers(path: string, method: string) {
  const layers = (mcpTokensRouter as unknown as { stack: Layer[] }).stack;
  const layer = layers.find(
    (l) => l.route?.path === path && l.route.methods[method],
  );
  assert.ok(layer?.route, `route ${method.toUpperCase()} ${path} not found`);
  return layer!.route!.stack.map((s) => s.handle);
}

function mockRes() {
  const state: { status?: number; body?: unknown } = {};
  return {
    state,
    status(code: number) {
      state.status = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  };
}

test("ledger endpoint denies suppliers even with audit:read", async () => {
  const handlers = findHandlers("/mcp/tool-calls", "get");
  const req = makeReq(
    ctxWith({
      roleKey: "supplier_user",
      supplierId: 7,
      permissions: new Set(["audit:read"]),
    }),
  );
  (req as { query?: unknown }).query = {};
  const res = mockRes();
  let denied = false;
  for (const h of handlers) {
    let nexted = false;
    await h(req, res as never, () => {
      nexted = true;
    });
    if (!nexted) {
      denied = true;
      break;
    }
  }
  assert.ok(denied, "handler chain ran to completion for a supplier");
  assert.equal(res.state.status, 403);
});

test("token creation denies suppliers", async () => {
  const handlers = findHandlers("/mcp/tokens", "post");
  const req = makeReq(
    ctxWith({ roleKey: "supplier_user", supplierId: 7, permissions: new Set() }),
  );
  (req as { body?: unknown }).body = { name: "x" };
  const res = mockRes();
  for (const h of handlers) {
    let nexted = false;
    await h(req, res as never, () => {
      nexted = true;
    });
    if (!nexted) break;
  }
  assert.equal(res.state.status, 403);
});

// --- Phase 2: action registry + confirmation-token contract -----------------
import { availableActionsFor } from "../../lib/workspace/actions";
import {
  issueConfirmationToken,
  verifyConfirmationToken,
} from "../../lib/mcp/confirmations";

const ACTION_FORBIDDEN_PATTERNS: RegExp[] = [
  /delete/i, /remove/i, /drop/i, /purge/i, /truncate/i, /sql/i,
  /secret/i, /credential/i, /api_key/i, /apikey/i, /token/i,
  /env/i, /config/i, /(^|_)exec(ute)?(_|$)/i, /shell/i, /role/i, /permission/i, /admin/i,
];

test("action registry contains no forbidden capabilities and all actions are gated", () => {
  // Offer every permission so the full registry is visible.
  const allPerms = new Set([
    "packages:read", "packages:write", "reports:write", "reports:read",
    "violations:read", "proofs:write", "suppliers:read",
  ]);
  const actions = availableActionsFor(makeReq(ctxWith({ permissions: allPerms })));
  assert.ok(actions.length > 0);
  for (const a of actions) {
    for (const pattern of ACTION_FORBIDDEN_PATTERNS) {
      assert.ok(
        !pattern.test(a.name),
        `Action "${a.name}" matches forbidden pattern ${pattern}.`,
      );
    }
    assert.ok(a.requiredPerms.length > 0, `Action "${a.name}" has no requiredPerms.`);
  }
});

test("suppliers are never offered state-changing actions", () => {
  const allPerms = new Set(["packages:write", "proofs:write", "reports:write", "packages:read", "violations:read"]);
  const offered = availableActionsFor(
    makeReq(ctxWith({ roleKey: "supplier_user", supplierId: 7, permissions: allPerms })),
  );
  for (const a of offered) {
    assert.equal(a.sensitive, false, `supplier offered sensitive action ${a.name}`);
    assert.equal(a.supplierSafe, true);
  }
});

test("confirmation tokens: bound to user, action, and exact args; expire", () => {
  process.env["SESSION_SECRET"] = process.env["SESSION_SECRET"] || "test-secret";
  const args = { packageId: 41, title: "check label" };
  const tok = issueConfirmationToken(40, "create_task", args);

  // Valid: same user/action/args (key order and confirmationToken ignored).
  assert.ok(verifyConfirmationToken(tok, 40, "create_task", { title: "check label", packageId: 41, confirmationToken: tok }));
  // Wrong user.
  assert.ok(!verifyConfirmationToken(tok, 41, "create_task", args));
  // Wrong action.
  assert.ok(!verifyConfirmationToken(tok, 40, "create_comment", args));
  // Changed args (bait-and-switch).
  assert.ok(!verifyConfirmationToken(tok, 40, "create_task", { packageId: 42, title: "check label" }));
  // Garbage tokens.
  assert.ok(!verifyConfirmationToken("confirm_123_deadbeef", 40, "create_task", args));
  assert.ok(!verifyConfirmationToken(undefined, 40, "create_task", args));
  // Expired.
  const old = issueConfirmationToken(40, "create_task", args, Date.now() - 11 * 60 * 1000);
  assert.ok(!verifyConfirmationToken(old, 40, "create_task", args));
});

// canonicalArgs must be deep-order-independent so nested-argument actions
// don't suffer brittle token mismatches.
import { canonicalArgs } from "../../lib/mcp/confirmations";

test("canonicalArgs: deep key-order independence, confirmationToken excluded", () => {
  const a = canonicalArgs({ b: { y: 2, x: 1 }, a: [{ q: 1, p: 2 }], confirmationToken: "t1" });
  const b = canonicalArgs({ a: [{ p: 2, q: 1 }], confirmationToken: "t2", b: { x: 1, y: 2 } });
  assert.equal(a, b);
  const c = canonicalArgs({ a: [{ p: 3, q: 1 }], b: { x: 1, y: 2 } });
  assert.notEqual(a, c);
});
