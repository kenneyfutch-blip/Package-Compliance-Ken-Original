import type { Request } from "express";
import { createTtlCache } from "./ttl-cache";
import { getAuthContext } from "../rbac/context";

// Short-TTL, tenant-scoped cache for hot dashboard aggregate reads. The
// dashboard is polled by every open workspace, so without a cache each poll
// re-runs the same GROUP BY aggregates. Entries are scoped to the caller's data
// visibility (org + role + supplier) so a supplier user's narrowed view can
// never be served from an internal user's org-wide entry, and vice versa.
const DASHBOARD_CACHE_TTL_MS =
  Number(process.env.DASHBOARD_CACHE_TTL_MS) || 30_000;

const cache = createTtlCache<unknown>({
  ttlMs: DASHBOARD_CACHE_TTL_MS,
  maxEntries: 500,
});

export function clearDashboardCache(): void {
  cache.clear();
}

// Cache key capturing everything packageConds / orgId scoping depends on, so two
// callers only share an entry when they would see identical data. supplier_user
// rows are supplier-scoped; all other roles are org-wide.
function scopeKey(req: Request, widget: string): string {
  const ctx = getAuthContext(req);
  return `${widget}|org=${ctx.organizationId}|role=${ctx.roleKey}|sup=${ctx.supplierId ?? "none"}`;
}

// Run (or reuse) a cached dashboard aggregate for the caller's scope.
export async function cachedDashboard<T>(
  req: Request,
  widget: string,
  compute: () => Promise<T>,
): Promise<T> {
  return cache.get(scopeKey(req, widget), compute) as Promise<T>;
}
