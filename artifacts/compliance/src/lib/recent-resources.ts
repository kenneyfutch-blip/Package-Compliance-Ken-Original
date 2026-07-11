import { useCallback, useEffect, useState } from "react"

// Client-side "recently viewed / most used" tracking for the Resource Center.
// Kept in localStorage per browser — resource views are a personal convenience
// surface, not shared state, so this avoids a new table and API round-trips.

export interface RecentResource {
  type: string
  typeLabel: string
  refId: string
  title: string
  href: string
  category?: string | null
  count: number
  lastViewedAt: number
}

const STORAGE_KEY = "compliance:recent-resources"
const MAX_ENTRIES = 24
const EVENT = "recent-resources-changed"

function keyOf(r: { type: string; refId: string }): string {
  return `${r.type}:${r.refId}`
}

function read(): RecentResource[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (r): r is RecentResource =>
        r && typeof r.type === "string" && typeof r.refId === "string" && typeof r.href === "string",
    )
  } catch {
    return []
  }
}

function write(list: RecentResource[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    window.dispatchEvent(new Event(EVENT))
  } catch {
    // Storage unavailable (private mode / quota) — degrade silently.
  }
}

export type RecordableResource = Omit<RecentResource, "count" | "lastViewedAt">

// Record a resource view: bumps its use count and recency, de-duplicated by
// type + record id. Safe to call on every navigation into a resource.
export function recordResourceView(resource: RecordableResource): void {
  const now = Date.now()
  const list = read()
  const existing = list.find((r) => keyOf(r) === keyOf(resource))
  let next: RecentResource[]
  if (existing) {
    next = list.map((r) =>
      keyOf(r) === keyOf(resource)
        ? { ...r, ...resource, count: r.count + 1, lastViewedAt: now }
        : r,
    )
  } else {
    next = [{ ...resource, count: 1, lastViewedAt: now }, ...list]
  }
  // Keep the most recently used entries only.
  next.sort((a, b) => b.lastViewedAt - a.lastViewedAt)
  write(next.slice(0, MAX_ENTRIES))
}

// Reactive access to the tracked resources. Re-renders when views are recorded
// (including from other tabs via the storage event).
export function useRecentResources(): {
  recent: RecentResource[]
  mostUsed: RecentResource[]
  clear: () => void
} {
  const [list, setList] = useState<RecentResource[]>(() =>
    typeof window === "undefined" ? [] : read(),
  )

  useEffect(() => {
    const refresh = () => setList(read())
    window.addEventListener(EVENT, refresh)
    window.addEventListener("storage", refresh)
    return () => {
      window.removeEventListener(EVENT, refresh)
      window.removeEventListener("storage", refresh)
    }
  }, [])

  const clear = useCallback(() => write([]), [])

  const recent = [...list].sort((a, b) => b.lastViewedAt - a.lastViewedAt)
  const mostUsed = [...list].sort(
    (a, b) => b.count - a.count || b.lastViewedAt - a.lastViewedAt,
  )

  return { recent, mostUsed, clear }
}
