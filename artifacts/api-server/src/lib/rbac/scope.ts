import type { Request } from "express";
import { eq, type SQL } from "drizzle-orm";
import { packagesTable, type PackageRow } from "@workspace/db";
import { getAuthContext } from "./context";

// A supplier id that can never match a real row, so a supplier_user with no
// linked supplier sees nothing (deny-by-default) rather than everything.
const NO_SUPPLIER = -1;

// Tenant + supplier scoping conditions for package queries. Every package query
// must include these so callers only ever see their organization's data, and
// Supplier Users only their own supplier's packages. Supplier scoping is by
// supplier id (the authoritative link), never the free-text vendor name.
export function packageConds(req: Request): SQL[] {
  const ctx = getAuthContext(req);
  const conds: SQL[] = [eq(packagesTable.organizationId, ctx.organizationId)];
  if (ctx.roleKey === "supplier_user") {
    conds.push(eq(packagesTable.supplierId, ctx.supplierId ?? NO_SUPPLIER));
  }
  return conds;
}

// Whether the caller may access a specific already-loaded package row.
export function canAccessPackage(req: Request, pkg: PackageRow): boolean {
  const ctx = getAuthContext(req);
  if (pkg.organizationId !== ctx.organizationId) return false;
  if (ctx.roleKey === "supplier_user") {
    // Deny-by-default: an unlinked supplier user (null id) or an unlinked
    // package (null supplierId) must never match — null === null is not access.
    return ctx.supplierId != null && pkg.supplierId === ctx.supplierId;
  }
  return true;
}

// Ownership descriptor for a stored object, resolved from the record that
// references it. Package-owned artwork carries the owning package's org +
// supplier id; supplier-owned artwork carries the owning supplier's org +
// supplier id. Both scope by supplier id so a download can never cross a tenant
// or supplier boundary.
export type ObjectOwner =
  | { kind: "package"; organizationId: number | null; supplierId: number | null }
  | {
      kind: "supplier";
      organizationId: number | null;
      supplierId: number | null;
    };

// Whether the caller may read a private object owned by the given record. Mirrors
// canAccessPackage for package-owned artwork and applies the same org + supplier
// scoping to supplier-owned artwork (submissions / supplier master records), so a
// download can never cross a tenant or supplier boundary.
export function canAccessObjectOwner(
  req: Request,
  owner: ObjectOwner,
): boolean {
  const ctx = getAuthContext(req);
  if (owner.organizationId !== ctx.organizationId) return false;
  if (ctx.roleKey === "supplier_user") {
    // Deny-by-default: an unlinked supplier user (null id) or an unlinked owner
    // (null supplierId) must never match — null === null is not access.
    return ctx.supplierId != null && owner.supplierId === ctx.supplierId;
  }
  return true;
}

// Team scoping for internal operations data (workload, metrics, assignments).
// Returns null when the caller must NOT be restricted to their own teams:
//   - org-wide oversight roles (admin, director, executive) see all teams, and
//   - supplier users are handled entirely by package/supplier scoping instead.
// Otherwise returns the caller's own team ids (plus their user id, so a person
// always sees work assigned directly to them even if it has no team).
const ORG_WIDE_OPS_ROLES = new Set([
  "platform_admin",
  "compliance_director",
  "executive_viewer",
]);

export function opsTeamScope(
  req: Request,
): { teamIds: number[]; userId: number } | null {
  const ctx = getAuthContext(req);
  if (ctx.roleKey === "supplier_user") return null;
  if (ORG_WIDE_OPS_ROLES.has(ctx.roleKey)) return null;
  return { teamIds: ctx.teamIds, userId: ctx.userId };
}
