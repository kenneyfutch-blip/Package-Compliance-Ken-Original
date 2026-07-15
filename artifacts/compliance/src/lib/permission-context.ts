import * as React from "react"
import type { Me } from "@workspace/api-client-react"

// -----------------------------------------------------------------------------
// The Permission React context lives in this component-free module ON PURPOSE.
//
// A React context object's identity must be stable for `useContext` to match the
// value supplied by its Provider. When `createContext` sits in a module that
// also exports components/hooks (access.tsx), Fast Refresh can re-evaluate that
// module during development, minting a BRAND NEW context object. The mounted
// Provider still holds the old object, so `usePermissions` reads the new one,
// finds no Provider, and throws "usePermissions must be used within a
// PermissionProvider". Keeping the context in a module that only exports plain
// values (no components/hooks) means it is never part of a Fast Refresh boundary
// and its identity survives every HMR update.
// -----------------------------------------------------------------------------

export interface PermissionState {
  me: Me | null
  permissions: Set<string>
  isLoading: boolean
  has: (perm: string) => boolean
  hasAny: (...perms: string[]) => boolean
}

export const PermissionContext = React.createContext<PermissionState | null>(null)
