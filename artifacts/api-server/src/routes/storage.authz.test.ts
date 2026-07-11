import test from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import {
  requireAnyPermission,
  setAuthContext,
  type AuthContext,
} from "../lib/rbac/context";
import { canAccessObjectOwner, type ObjectOwner } from "../lib/rbac/scope";

// Regression guard for private object-download authorization. The
// GET /storage/objects/* route maps every requested object back to the record
// that owns it and applies the caller's organization + supplier scope before
// streaming bytes, so a signed-in user can never pull another tenant's or
// supplier's proof artifact by guessing an object path. These tests exercise the
// exact primitives the route relies on: canAccessObjectOwner for tenant/supplier
// scoping, and the requireAnyPermission read gate on the route.

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

function pkgOwner(overrides: Partial<Extract<ObjectOwner, { kind: "package" }>> = {}): ObjectOwner {
  return { kind: "package", organizationId: 1, supplierId: 7, ...overrides };
}

function supplierOwner(
  overrides: Partial<Extract<ObjectOwner, { kind: "supplier" }>> = {},
): ObjectOwner {
  return { kind: "supplier", organizationId: 1, supplierId: 7, ...overrides };
}

// --- Package-owned artwork (proofs, versions, package headline, exported PDFs) ---

test("package object: same-org internal role may download", () => {
  const req = reqWith(ctx({ organizationId: 1, roleKey: "reviewer" }));
  assert.equal(canAccessObjectOwner(req, pkgOwner({ organizationId: 1 })), true);
});

test("package object: cross-org download is denied (IDOR guard)", () => {
  const req = reqWith(ctx({ organizationId: 1 }));
  assert.equal(canAccessObjectOwner(req, pkgOwner({ organizationId: 2 })), false);
});

test("package object: supplier user may download only their own supplier's artwork", () => {
  const req = reqWith(
    ctx({ roleKey: "supplier_user", supplierId: 7, organizationId: 1 }),
  );
  assert.equal(
    canAccessObjectOwner(req, pkgOwner({ organizationId: 1, supplierId: 7 })),
    true,
  );
});

test("package object: supplier user is denied another supplier's artwork", () => {
  const req = reqWith(
    ctx({ roleKey: "supplier_user", supplierId: 7, organizationId: 1 }),
  );
  assert.equal(
    canAccessObjectOwner(req, pkgOwner({ organizationId: 1, supplierId: 9 })),
    false,
  );
});

test("package object: supplier user is denied across organizations", () => {
  const req = reqWith(
    ctx({ roleKey: "supplier_user", supplierId: 7, organizationId: 1 }),
  );
  assert.equal(
    canAccessObjectOwner(req, pkgOwner({ organizationId: 2, supplierId: 7 })),
    false,
  );
});

test("package object: unlinked supplier user is denied an unlinked package object (deny-by-default)", () => {
  const req = reqWith(
    ctx({ roleKey: "supplier_user", supplierId: null, organizationId: 1 }),
  );
  assert.equal(
    canAccessObjectOwner(req, pkgOwner({ organizationId: 1, supplierId: null })),
    false,
  );
});

test("package object: linked supplier user is denied an unlinked package object", () => {
  const req = reqWith(
    ctx({ roleKey: "supplier_user", supplierId: 7, organizationId: 1 }),
  );
  assert.equal(
    canAccessObjectOwner(req, pkgOwner({ organizationId: 1, supplierId: null })),
    false,
  );
});

// --- Supplier-owned artwork (submission artwork, supplier master records) ---

test("supplier object: same-org internal role may download", () => {
  const req = reqWith(ctx({ organizationId: 1, roleKey: "compliance_specialist" }));
  assert.equal(
    canAccessObjectOwner(req, supplierOwner({ organizationId: 1 })),
    true,
  );
});

test("supplier object: cross-org download is denied", () => {
  const req = reqWith(ctx({ organizationId: 1 }));
  assert.equal(
    canAccessObjectOwner(req, supplierOwner({ organizationId: 2 })),
    false,
  );
});

test("supplier object: supplier user may download only their own supplier's artwork", () => {
  const req = reqWith(
    ctx({ roleKey: "supplier_user", supplierId: 7, organizationId: 1 }),
  );
  assert.equal(
    canAccessObjectOwner(req, supplierOwner({ organizationId: 1, supplierId: 7 })),
    true,
  );
});

test("supplier object: supplier user is denied another supplier's artwork", () => {
  const req = reqWith(
    ctx({ roleKey: "supplier_user", supplierId: 7, organizationId: 1 }),
  );
  assert.equal(
    canAccessObjectOwner(req, supplierOwner({ organizationId: 1, supplierId: 9 })),
    false,
  );
});

// --- Route read gate (requireAnyPermission) ---

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

test("object download gate rejects a caller with neither proofs:read nor packages:read", () => {
  const guard = requireAnyPermission("proofs:read", "packages:read");
  const r = runGuard(guard, ["regulations:read"]);
  assert.equal(r.nexted, false);
  assert.equal(r.code, 403);
});

test("object download gate admits a caller holding packages:read", () => {
  const guard = requireAnyPermission("proofs:read", "packages:read");
  const r = runGuard(guard, ["packages:read"]);
  assert.equal(r.nexted, true);
});

test("object download gate returns 401 when no auth context is present", () => {
  const guard = requireAnyPermission("proofs:read", "packages:read");
  const r = runGuard(guard, [], false);
  assert.equal(r.nexted, false);
  assert.equal(r.code, 401);
});
