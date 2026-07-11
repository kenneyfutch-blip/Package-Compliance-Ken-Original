import * as React from "react"
import { useGetMe } from "@workspace/api-client-react"
import type { Me } from "@workspace/api-client-react"
import { Lock } from "lucide-react"

// -----------------------------------------------------------------------------
// Permission context — backed by GET /me. The API server independently enforces
// the same permissions; this layer only shapes navigation and route access so
// users never see actions they cannot perform.
// -----------------------------------------------------------------------------

interface PermissionState {
  me: Me | null
  permissions: Set<string>
  isLoading: boolean
  has: (perm: string) => boolean
  hasAny: (...perms: string[]) => boolean
}

const PermissionContext = React.createContext<PermissionState | null>(null)

export function PermissionProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useGetMe()

  const value = React.useMemo<PermissionState>(() => {
    const permissions = new Set<string>(data?.permissions ?? [])
    return {
      me: data ?? null,
      permissions,
      isLoading,
      has: (perm: string) => permissions.has(perm),
      hasAny: (...perms: string[]) => perms.some((p) => permissions.has(p)),
    }
  }, [data, isLoading])

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  )
}

export function usePermissions(): PermissionState {
  const ctx = React.useContext(PermissionContext)
  if (!ctx) {
    throw new Error("usePermissions must be used within a PermissionProvider")
  }
  return ctx
}

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
  if (p.startsWith("/ai/")) return "violations:read"
  if (p === "/suppliers/portal") return "packages:read"
  if (p === "/suppliers" || p.startsWith("/suppliers/")) return "suppliers:read"
  if (p === "/reports" || p.startsWith("/reports/")) return "reports:read"
  if (p === "/audit") return "audit:read"
  if (p === "/admin") return "users:read"
  if (p === "/notifications") return "notifications:read"
  return null
}

export function NoAccess() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center animate-in fade-in duration-300">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <Lock className="h-7 w-7" />
      </div>
      <h1 className="mt-6 text-2xl font-bold text-foreground">No access</h1>
      <p className="mt-2 max-w-md text-muted-foreground">
        You don&apos;t have permission to view this page. If you believe this is a
        mistake, contact your compliance administrator to review your role.
      </p>
    </div>
  )
}
