// Pure presentation helpers for live presence + review locks. Kept in a plain
// .ts module (no component/hook exports) so React Fast Refresh boundaries in the
// presence components stay clean.

export interface PresenceMeta {
  label: string
  dot: string
  text: string
}

const META: Record<string, PresenceMeta> = {
  online: { label: "Online", dot: "bg-success", text: "text-success" },
  reviewing: { label: "Reviewing", dot: "bg-primary", text: "text-primary" },
  approving: { label: "Approving", dot: "bg-violet-500", text: "text-violet-500" },
  commenting: { label: "Commenting", dot: "bg-sky-500", text: "text-sky-500" },
  idle: { label: "Idle", dot: "bg-warning", text: "text-warning" },
  offline: { label: "Offline", dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
}

export function presenceMeta(state: string): PresenceMeta {
  return META[state] ?? META["offline"]!
}

// A presence state counts as "actively working a review" for lock/indicator
// purposes when the reviewer is doing more than just being online.
export function isActiveReviewState(state: string): boolean {
  return state === "reviewing" || state === "approving" || state === "commenting"
}

export function presenceRelativeTime(iso?: string | null): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const diff = Date.now() - then
  const mins = Math.round(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

// "since 2:14 PM" style label for when a lock/review started.
export function sinceLabel(iso?: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const rel = presenceRelativeTime(iso)
  const clock = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  return rel === "just now" ? "just now" : `${clock} (${rel})`
}
