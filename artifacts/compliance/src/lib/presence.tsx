import * as React from "react"
import { useHeartbeatPresence } from "@workspace/api-client-react"
import { usePermissions } from "@/lib/access"

// -----------------------------------------------------------------------------
// Live presence heartbeat. Every active (non-supplier) reviewer beats their
// presence on a short interval so dashboards can show who is online and what
// they are working on. Pages call setFocus() to report richer activity —
// e.g. the review workspace reports "reviewing" plus the package in view.
//
// "idle" is reported by the client after a stretch of no interaction; "offline"
// is derived server-side once heartbeats stop entirely.
// -----------------------------------------------------------------------------

const HEARTBEAT_MS = 25_000
const IDLE_AFTER_MS = 60_000

export type ActivityState = "online" | "reviewing" | "approving" | "commenting"

interface PresenceApi {
  // Report what the caller is currently doing, optionally on a specific package.
  setFocus: (state: ActivityState, packageId?: number | null) => void
  // Return to the default "online, no package" state (e.g. on leaving a review).
  clearFocus: () => void
}

const PresenceContext = React.createContext<PresenceApi | null>(null)

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const { me } = usePermissions()
  const enabled = !!me && me.roleKey !== "supplier_user"

  const heartbeat = useHeartbeatPresence()
  const beatRef = React.useRef(heartbeat)
  beatRef.current = heartbeat

  const focusRef = React.useRef<{ state: ActivityState; packageId: number | null }>({
    state: "online",
    packageId: null,
  })
  const lastActivityRef = React.useRef<number>(Date.now())

  const send = React.useCallback(() => {
    if (!enabled) return
    const idle = Date.now() - lastActivityRef.current > IDLE_AFTER_MS
    const state = idle ? "idle" : focusRef.current.state
    beatRef.current.mutate({
      data: { state, packageId: focusRef.current.packageId ?? null },
    })
  }, [enabled])

  // Track user interaction so we can report "idle" during inactivity.
  React.useEffect(() => {
    if (!enabled) return
    const mark = () => {
      lastActivityRef.current = Date.now()
    }
    const events: (keyof WindowEventMap)[] = [
      "pointerdown",
      "keydown",
      "pointermove",
      "focus",
    ]
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }))
    return () => events.forEach((e) => window.removeEventListener(e, mark))
  }, [enabled])

  // Beat immediately on mount, then on a fixed cadence.
  React.useEffect(() => {
    if (!enabled) return
    send()
    const timer = window.setInterval(send, HEARTBEAT_MS)
    return () => window.clearInterval(timer)
  }, [enabled, send])

  const api = React.useMemo<PresenceApi>(
    () => ({
      setFocus: (state, packageId = null) => {
        focusRef.current = { state, packageId }
        lastActivityRef.current = Date.now()
        send()
      },
      clearFocus: () => {
        focusRef.current = { state: "online", packageId: null }
        send()
      },
    }),
    [send],
  )

  return <PresenceContext.Provider value={api}>{children}</PresenceContext.Provider>
}

export function usePresence(): PresenceApi {
  const ctx = React.useContext(PresenceContext)
  // Presence is best-effort; outside the provider it is a no-op so pages that
  // render in isolation (tests, storybook) don't crash.
  return ctx ?? { setFocus: () => {}, clearFocus: () => {} }
}
