import * as React from "react"
import {
  useGetReviewLocks,
  getGetReviewLocksQueryKey,
  useAcquireReviewLock,
  useReleaseReviewLock,
  type ReviewerPresence,
  type ReviewLock,
} from "@workspace/api-client-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { initialsFor } from "@/components/review-ownership"
import { presenceMeta, sinceLabel } from "@/lib/presence-utils"
import { Eye, Lock, AlertTriangle } from "lucide-react"

// -----------------------------------------------------------------------------
// Shared UI for live reviewer presence + advisory review locks.
// -----------------------------------------------------------------------------

export function PresenceDot({ state, className }: { state: string; className?: string }) {
  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full", presenceMeta(state).dot, className)}
      aria-hidden
    />
  )
}

// Compact avatar with a status dot and tooltip-friendly title.
function PresenceAvatar({ p }: { p: ReviewerPresence }) {
  const meta = presenceMeta(p.state)
  const title = p.packageName
    ? `${p.name} — ${meta.label} · ${p.packageName}`
    : `${p.name} — ${meta.label}`
  return (
    <div className="relative" title={title}>
      <Avatar className="h-7 w-7 border border-border">
        <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
          {initialsFor(p.name)}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card",
          meta.dot,
        )}
      />
    </div>
  )
}

// Horizontal "who's online" strip. Presence is already sorted server-side.
export function PresenceStrip({
  presence,
  max = 8,
  className,
}: {
  presence: ReviewerPresence[] | undefined
  max?: number
  className?: string
}) {
  const people = presence ?? []
  if (people.length === 0) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
        <PresenceDot state="offline" />
        No reviewers online right now
      </div>
    )
  }
  const shown = people.slice(0, max)
  const extra = people.length - shown.length
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex -space-x-2">
        {shown.map((p) => (
          <PresenceAvatar key={p.userId} p={p} />
        ))}
      </div>
      {extra > 0 && (
        <span className="text-xs text-muted-foreground">+{extra} more</span>
      )}
    </div>
  )
}

// Inline presence label (dot + text) for member rows on dashboards.
export function PresenceLabel({
  state,
  packageName,
  className,
}: {
  state: string
  packageName?: string | null
  className?: string
}) {
  const meta = presenceMeta(state)
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", meta.text, className)}>
      <PresenceDot state={state} />
      {meta.label}
      {packageName && state !== "offline" && (
        <span className="text-muted-foreground">· {packageName}</span>
      )}
    </span>
  )
}

// Small badge shown on a review/package card when someone holds the lock.
export function LockIndicator({
  lock,
  isMine,
  className,
}: {
  lock: ReviewLock
  isMine?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        isMine
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-warning/40 bg-warning/10 text-warning",
        className,
      )}
      title={`${isMine ? "You are" : `${lock.userName ?? "Someone"} is`} reviewing this`}
    >
      <Lock className="h-3 w-3" />
      {isMine ? "You" : lock.userName ?? "In review"}
    </span>
  )
}

// Prominent banner on the review workspace communicating live lock state.
export function ReviewLockBanner({
  lock,
  isMine,
}: {
  lock: ReviewLock | null | undefined
  isMine: boolean
}) {
  if (!lock) return null
  const since = sinceLabel(lock.startedAt)
  if (isMine) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">
        <Eye className="h-4 w-4 shrink-0" />
        <span>
          You&apos;re reviewing this now — other reviewers can see it&apos;s in progress.
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
      <span className="text-foreground">
        <span className="font-semibold">{lock.userName ?? "Another reviewer"}</span> is
        currently reviewing this package
        {since ? <> since {since}</> : null}. Coordinate before making changes to avoid
        conflicting or duplicate work.
      </span>
    </div>
  )
}

// Manage the advisory lock lifecycle for a package review: acquire on mount,
// heartbeat on an interval, release on unmount. The live holder is read from the
// polled lock list (source of truth), so this reflects other reviewers too.
export function useReviewLock(
  packageId: number,
  opts: { enabled: boolean; myUserId?: number | null },
): { lock: ReviewLock | null; isMine: boolean; heldByOther: boolean } {
  const acquire = useAcquireReviewLock()
  const release = useReleaseReviewLock()
  const acquireRef = React.useRef(acquire)
  acquireRef.current = acquire
  const releaseRef = React.useRef(release)
  releaseRef.current = release

  const { data: locks } = useGetReviewLocks({
    query: {
      enabled: opts.enabled,
      refetchInterval: opts.enabled ? 10_000 : false,
      queryKey: getGetReviewLocksQueryKey(),
    },
  })

  React.useEffect(() => {
    if (!opts.enabled || !packageId) return
    const beat = () => acquireRef.current.mutate({ id: packageId })
    beat()
    const timer = window.setInterval(beat, 30_000)
    return () => {
      window.clearInterval(timer)
      releaseRef.current.mutate({ id: packageId })
    }
  }, [opts.enabled, packageId])

  const lock = locks?.find((l) => l.packageId === packageId) ?? null
  const isMine = !!lock && opts.myUserId != null && lock.userId === opts.myUserId
  return { lock, isMine, heldByOther: !!lock && !isMine }
}
