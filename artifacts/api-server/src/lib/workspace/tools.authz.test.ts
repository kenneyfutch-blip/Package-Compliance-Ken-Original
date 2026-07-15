import test from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { setAuthContext, type AuthContext } from "../rbac/context";
import { packageConds, canAccessPackage } from "../rbac/scope";
import { availableToolsFor, findTool } from "./tools";

// canAccessPackage only reads organizationId + supplierId; build a minimal stub
// typed as the full row it expects.
type PkgArg = Parameters<typeof canAccessPackage>[1];
function pkg(organizationId: number | null, supplierId: number | null): PkgArg {
  return { organizationId, supplierId } as unknown as PkgArg;
}

// Security regression guard for the AI Workspace read-tool layer. The Workspace
// model can only call tools it is offered (availableToolsFor), and every tool
// re-scopes its own query by org + supplier. These tests exercise the two
// enforcement layers directly:
//   1. Permission gating — a caller is only offered tools whose required
//      permissions they ALL hold. A supplier can never be offered admin tools.
//   2. Tenant/supplier scoping — the shared scope helpers the tools reuse deny
//      cross-org and cross-supplier access by construction.

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

const ALL_PERMS = [
  "packages:read",
  "violations:read",
  "regulations:read",
  "specialists:read",
  "suppliers:read",
  "reports:read",
  "policies:read",
  "audit:read",
  "fda:read",
];

// --- Permission gating ------------------------------------------------------

test("no permissions: no data tools are offered", () => {
  const tools = availableToolsFor(reqWith(ctx({ permissions: new Set() })));
  assert.equal(tools.length, 0);
});

test("every registered tool requires at least one permission (no ungated data leak)", () => {
  const tools = availableToolsFor(
    reqWith(ctx({ permissions: new Set(ALL_PERMS) })),
  );
  assert.ok(tools.length >= 10, "expected the full tool catalog");
  for (const t of tools) {
    assert.ok(
      t.requiredPerms.length >= 1,
      `tool ${t.name} must require at least one permission`,
    );
  }
});

test("supplier user is only offered tools their permissions allow", () => {
  // A typical supplier user can read their own packages and findings only.
  const supplierPerms = new Set(["packages:read", "violations:read"]);
  const tools = availableToolsFor(
    reqWith(
      ctx({
        roleKey: "supplier_user",
        supplierId: 7,
        permissions: supplierPerms,
      }),
    ),
  );
  const names = tools.map((t) => t.name).sort();
  // Package/finding tools available...
  assert.ok(names.includes("search_packages"));
  assert.ok(names.includes("get_package_details"));
  assert.ok(names.includes("search_findings"));
  // ...but no admin/cross-cutting tools they lack permission for.
  assert.ok(!names.includes("list_specialists"));
  assert.ok(!names.includes("search_audit_trail"));
  assert.ok(!names.includes("list_reports"));
  assert.ok(!names.includes("list_suppliers"));
  assert.ok(!names.includes("search_sop_documents"));
});

test("org-only tools are never offered to a supplier user, even with the permission", () => {
  // Defense in depth: the org-only internal tools (specialist directory,
  // reports, SOPs, audit trail) are NOT supplier-scoped at query time, so even a
  // misconfigured supplier_user holding their read permissions must never be
  // offered them.
  const tools = availableToolsFor(
    reqWith(
      ctx({
        roleKey: "supplier_user",
        supplierId: 7,
        permissions: new Set(ALL_PERMS),
      }),
    ),
  )
  const names = tools.map((t) => t.name)
  assert.ok(!names.includes("list_specialists"))
  assert.ok(!names.includes("list_reports"))
  assert.ok(!names.includes("search_sop_documents"))
  assert.ok(!names.includes("search_audit_trail"))
  // Supplier-scoped and non-tenant reference tools remain available.
  assert.ok(names.includes("search_packages"))
  assert.ok(names.includes("list_suppliers"))
  assert.ok(names.includes("search_regulations"))
})

test("a tool is offered only when ALL its required permissions are held", () => {
  // search_compliance_memory requires violations:read; a caller with only
  // packages:read must not be offered it.
  const tools = availableToolsFor(
    reqWith(ctx({ permissions: new Set(["packages:read"]) })),
  );
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("search_packages"));
  assert.ok(!names.includes("search_compliance_memory"));
  assert.ok(!names.includes("search_findings"));
});

test("findTool resolves known tools and rejects unknown", () => {
  assert.ok(findTool("search_packages"));
  assert.equal(findTool("delete_everything"), undefined);
});

// --- Tenant / supplier scoping ---------------------------------------------

test("packageConds adds a supplier filter for supplier users only", () => {
  const orgWide = packageConds(reqWith(ctx({ roleKey: "reviewer" })));
  const supplier = packageConds(
    reqWith(ctx({ roleKey: "supplier_user", supplierId: 7 })),
  );
  // Org-wide role: organization scope only. Supplier user: an extra supplier
  // condition on top of the org scope.
  assert.equal(orgWide.length, 1);
  assert.equal(supplier.length, 2);
});

test("canAccessPackage denies cross-org and cross-supplier access", () => {
  // Cross-org: same supplier id, different organization → denied.
  assert.equal(
    canAccessPackage(reqWith(ctx({ organizationId: 1 })), pkg(2, null)),
    false,
  );
  // Supplier user reaching another supplier's package in the same org → denied.
  assert.equal(
    canAccessPackage(
      reqWith(ctx({ roleKey: "supplier_user", supplierId: 7 })),
      pkg(1, 8),
    ),
    false,
  );
  // Supplier user reaching their own package → allowed.
  assert.equal(
    canAccessPackage(
      reqWith(ctx({ roleKey: "supplier_user", supplierId: 7 })),
      pkg(1, 7),
    ),
    true,
  );
  // Unlinked supplier user (null id) must never match an unlinked package.
  assert.equal(
    canAccessPackage(
      reqWith(ctx({ roleKey: "supplier_user", supplierId: null })),
      pkg(1, null),
    ),
    false,
  );
});
