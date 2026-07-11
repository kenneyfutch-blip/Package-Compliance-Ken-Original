import type { Request } from "express";
import { eq, type SQL } from "drizzle-orm";
import { packagesTable, type PackageRow } from "@workspace/db";
import { getAuthContext } from "./context";

// Tenant + supplier scoping conditions for package queries. Every package query
// must include these so callers only ever see their organization's data, and
// Supplier Users only their own supplier's packages.
export function packageConds(req: Request): SQL[] {
  const ctx = getAuthContext(req);
  const conds: SQL[] = [eq(packagesTable.organizationId, ctx.organizationId)];
  if (ctx.roleKey === "supplier_user") {
    conds.push(eq(packagesTable.vendor, ctx.supplierName ?? "___no_supplier___"));
  }
  return conds;
}

// Whether the caller may access a specific already-loaded package row.
export function canAccessPackage(req: Request, pkg: PackageRow): boolean {
  const ctx = getAuthContext(req);
  if (pkg.organizationId !== ctx.organizationId) return false;
  if (ctx.roleKey === "supplier_user" && pkg.vendor !== ctx.supplierName) {
    return false;
  }
  return true;
}

// Ownership descriptor for a stored object, resolved from the record that
// references it. Package-owned artwork carries the owning package's org + vendor;
// supplier-owned artwork carries the owning supplier's org + supplier id.
export type ObjectOwner =
  | { kind: "package"; organizationId: number | null; vendor: string | null }
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
  if (owner.kind === "package") {
    if (ctx.roleKey === "supplier_user" && owner.vendor !== ctx.supplierName) {
      return false;
    }
    return true;
  }
  if (ctx.roleKey === "supplier_user" && owner.supplierId !== ctx.supplierId) {
    return false;
  }
  return true;
}
