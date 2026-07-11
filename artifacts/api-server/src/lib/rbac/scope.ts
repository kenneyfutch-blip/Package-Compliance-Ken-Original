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
