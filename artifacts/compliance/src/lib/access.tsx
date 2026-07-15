import * as React from "react"
import { useGetMe } from "@workspace/api-client-react"
import { Lock } from "lucide-react"
import { PermissionContext, type PermissionState } from "@/lib/permission-context"

// -----------------------------------------------------------------------------
// Permission context — backed by GET /me. The API server independently enforces
// the same permissions; this layer only shapes navigation and route access so
// users never see actions they cannot perform.
//
// The context OBJECT itself lives in ./permission-context (a component-free
// module) so its identity is stable across Fast Refresh; see that file for why.
// -----------------------------------------------------------------------------

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
