// Route → permission mapping. Kept in a plain (non-component) module so the
// component file `access.tsx` stays a valid React Fast Refresh boundary — mixing
// component and non-component exports in one file breaks HMR and tears down the
// PermissionProvider context on hot updates.
//
// Single source of truth mapping a route path to the permission it requires.
// Nav filtering and route gating both consult this, so they never drift.
// Returns null when a path needs no special permission (any signed-in user).
export function requiredPermFor(path: string): string | null {
  const p = (path.split("?")[0] || "/").replace(/\/+$/, "") || "/"

  if (p === "/") return "dashboard:read"
  if (p === "/upload") return "packages:write"
  if (p.startsWith("/proofing")) return "proofs:read"
  if (p === "/bulk" || p === "/fast-review") return "packages:read"
  if (p === "/reviews" || p.startsWith("/reviews/")) return "packages:read"
  if (p.startsWith("/queue/")) return "packages:read"
  if (p === "/packages" || p.startsWith("/packages/")) return "packages:read"
  if (p === "/regulatory/recalls" || p === "/regulatory/sources") return "fda:read"
  if (p.startsWith("/regulatory/")) return "regulations:read"
  if (p === "/regulatory-updates") return "regulations:read"
  if (p === "/regulations") return "regulations:read"
  if (p === "/admin/policies") return "policies:write"
  if (p === "/resources/policies") return "policies:read"
  if (p === "/resources/sop" || p === "/resources/glossary") return "policies:read"
  if (p === "/resources") return "regulations:read"
  if (p.startsWith("/ai/")) return "violations:read"
  if (p === "/suppliers/portal") return "packages:read"
  if (p === "/suppliers" || p.startsWith("/suppliers/")) return "suppliers:read"
  if (p === "/reports" || p.startsWith("/reports/")) return "reports:read"
  if (p === "/operations/teams") return "teams:read"
  if (p === "/operations/audit") return "audit:read"
  if (p === "/operations/system") return "org:manage"
  if (p.startsWith("/operations/")) return "users:read"
  if (p === "/audit") return "audit:read"
  if (p === "/admin/dashboard") return "org:manage"
  // Org-wide review-queue oversight. Also calls teams/users list endpoints for
  // its filters, so gate on the admin-tier perm that implies those too.
  if (p === "/admin/queue") return "users:read"
  if (p === "/admin/activity") return "audit:read"
  if (p === "/admin/usage") return "dashboard:read"
  if (p === "/admin/integrations") return "ai_providers:read"
  if (p === "/admin") return "users:read"
  if (p === "/notifications") return "notifications:read"
  return null
}
