import test from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import type { PackageRow } from "@workspace/db";
import {
  requirePermission,
  requireAnyPermission,
  hasPermission,
  setAuthContext,
  type AuthContext,
} from "../lib/rbac/context";
import { canAccessPackage, packageConds } from "../lib/rbac/scope";

// Regression guard for proofing authorization. Every proofing route now runs a
// permission guard and scopes package access to the caller's organization (and,
// for Supplier Users, their own vendor). These tests exercise the exact
// primitives the routes rely on — canAccessPackage / packageConds for tenant &
// supplier scoping, and requirePermission / requireAnyPermission for the
// per-route permission gates — so a future change that loosens them fails here.

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
    ...overrides,
  };
}

function reqWith(authContext: AuthContext): Request {
  const r = {} as Request;
  setAuthContext(r, authContext);
  return r;
}

function pkg(overrides: Partial<PackageRow> = {}): PackageRow {
  return {
    id: 1,
    organizationId: 1,
    vendor: "Acme Co",
    ...overrides,
  } as unknown as PackageRow;
}

function mockRes() {
  const state: { code?: number; body?: unknown } = {};
  const res = {
    status(c: number) {
      state.code = c;
      return res;
    },
    json(b: unknown) {
      state.body = b;
      return res;
    },
  } as unknown as Response;
  return { res, state };
}

// --- Tenant + supplier scoping (loadOwnedPackage / assertPackageAccess) ---

test("canAccessPackage allows a same-org internal role", () => {
  const req = reqWith(ctx({ organizationId: 1, roleKey: "reviewer" }));
  assert.equal(canAccessPackage(req, pkg({ organizationId: 1 })), true);
});

test("canAccessPackage denies cross-org access (IDOR guard)", () => {
  const req = reqWith(ctx({ organizationId: 1 }));
  assert.equal(canAccessPackage(req, pkg({ organizationId: 2 })), false);
});

test("canAccessPackage allows a supplier user only for their own vendor", () => {
  const req = reqWith(
    ctx({ roleKey: "supplier_user", supplierName: "Acme Co", organizationId: 1 }),
  );
  assert.equal(
    canAccessPackage(req, pkg({ organizationId: 1, vendor: "Acme Co" })),
    true,
  );
});

test("canAccessPackage denies a supplier user another vendor's package", () => {
  const req = reqWith(
    ctx({ roleKey: "supplier_user", supplierName: "Acme Co", organizationId: 1 }),
  );
  assert.equal(
    canAccessPackage(req, pkg({ organizationId: 1, vendor: "Rival Inc" })),
    false,
  );
});

test("canAccessPackage denies a supplier user across organizations", () => {
  const req = reqWith(
    ctx({ roleKey: "supplier_user", supplierName: "Acme Co", organizationId: 1 }),
  );
  assert.equal(
    canAccessPackage(req, pkg({ organizationId: 2, vendor: "Acme Co" })),
    false,
  );
});

test("packageConds scopes internal roles to their org only", () => {
  const conds = packageConds(reqWith(ctx({ roleKey: "reviewer" })));
  assert.equal(conds.length, 1);
});

test("packageConds adds a vendor filter for supplier users", () => {
  const conds = packageConds(
    reqWith(ctx({ roleKey: "supplier_user", supplierName: "Acme Co" })),
  );
  assert.equal(conds.length, 2);
});

// --- Per-route permission gates (requirePermission / requireAnyPermission) ---

function runGuard(
  guard: (req: Request, res: Response, next: NextFunction) => void,
  permissions: string[],
  hasAuth = true,
) {
  const req = hasAuth
    ? reqWith(ctx({ permissions: new Set(permissions) }))
    : ({} as Request);
  const { res, state } = mockRes();
  let nexted = false;
  guard(req, res, () => {
    nexted = true;
  });
  return { nexted, ...state };
}

test("requirePermission blocks a reviewer lacking proofs:decide with 403", () => {
  const r = runGuard(requirePermission("proofs:decide"), ["proofs:read"]);
  assert.equal(r.nexted, false);
  assert.equal(r.code, 403);
});

test("requirePermission allows a caller holding the required key", () => {
  const r = runGuard(requirePermission("proofs:write"), ["proofs:write"]);
  assert.equal(r.nexted, true);
  assert.equal(r.code, undefined);
});

test("requirePermission returns 401 when no auth context is present", () => {
  const r = runGuard(requirePermission("proofs:read"), [], false);
  assert.equal(r.nexted, false);
  assert.equal(r.code, 401);
});

test("bulk-action gate rejects a caller with none of the accepted permissions", () => {
  const guard = requireAnyPermission(
    "proofs:read",
    "proofs:write",
    "proofs:decide",
    "packages:analyze",
  );
  const r = runGuard(guard, ["regulations:read"]);
  assert.equal(r.nexted, false);
  assert.equal(r.code, 403);
});

test("bulk-action gate admits a caller with at least one accepted permission", () => {
  const guard = requireAnyPermission(
    "proofs:read",
    "proofs:write",
    "proofs:decide",
    "packages:analyze",
  );
  const r = runGuard(guard, ["proofs:read"]);
  assert.equal(r.nexted, true);
});

test("hasPermission reflects the caller's granted permission set", () => {
  const req = reqWith(ctx({ permissions: new Set(["proofs:write"]) }));
  assert.equal(hasPermission(req, "proofs:write"), true);
  assert.equal(hasPermission(req, "proofs:decide"), false);
});
