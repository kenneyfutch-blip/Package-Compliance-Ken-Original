import type { ReviewAssignment } from "@workspace/api-client-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { UserRound, Users, Clock, ShieldAlert, LifeBuoy, Crown } from "lucide-react"

// Reusable review-ownership indicator. Renders who owns a review (assignee +
// avatar, team), its status/priority, due date, SLA state, escalation, and
// backup/manager. Used across the review grid, package/review detail, the
// workspace, and dashboards so ownership reads consistently everywhere.

export function initialsFor(name?: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function relativeTime(iso?: string | null): string | null {
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

const SLA_LABEL: Record<string, string> = {
  breached: "SLA breached",
  at_risk: "SLA at risk",
  on_track: "On track",
}
function slaClass(s: string): string {
  return s === "breached"
    ? "text-destructive border-destructive/40"
    : s === "at_risk"
      ? "text-warning border-warning/40"
      : "text-success border-success/40"
}

const PRIORITY_CLASS: Record<string, string> = {
  critical: "text-destructive border-destructive/40",
  high: "text-warning border-warning/40",
  normal: "text-muted-foreground border-border",
  low: "text-muted-foreground border-border",
}

function dueLabel(assignment: ReviewAssignment): { text: string; overdue: boolean } | null {
  if (!assignment.dueAt || assignment.status === "Completed") return null
  const due = new Date(assignment.dueAt)
  const overdue = due.getTime() < Date.now()
  return { text: due.toLocaleDateString(), overdue }
}

export function ReviewOwnership({
  assignment,
  variant = "inline",
  className,
}: {
  assignment: ReviewAssignment | null | undefined
  variant?: "inline" | "card"
  className?: string
}) {
  if (!assignment) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
        <Avatar className="h-6 w-6">
          <AvatarFallback className="text-[10px] bg-muted">
            <UserRound className="w-3 h-3" />
          </AvatarFallback>
        </Avatar>
        <span>Unassigned</span>
      </div>
    )
  }

  const owner = assignment.assigneeName
  const escalated = assignment.escalationLevel > 0 && assignment.status !== "Completed"
  const due = dueLabel(assignment)
  const activity = relativeTime(assignment.lastActivityAt)

  const badges = (
    <>
      <Badge variant="outline" className={cn("capitalize", PRIORITY_CLASS[assignment.priority] ?? "")}>
        {assignment.priority}
      </Badge>
      <Badge variant="outline">{assignment.status}</Badge>
      {assignment.status !== "Completed" && assignment.slaStatus !== "none" && (
        <Badge variant="outline" className={slaClass(assignment.slaStatus)}>
          {SLA_LABEL[assignment.slaStatus] ?? assignment.slaStatus}
        </Badge>
      )}
      {escalated && (
        <Badge variant="outline" className="text-destructive border-destructive/40 gap-1">
          <ShieldAlert className="w-3 h-3" /> Escalated L{assignment.escalationLevel}
        </Badge>
      )}
    </>
  )

  if (variant === "inline") {
    return (
      <div className={cn("flex flex-wrap items-center gap-2 text-xs", className)}>
        <Avatar className="h-6 w-6">
          <AvatarFallback className={cn("text-[10px]", owner ? "bg-primary/10 text-primary" : "bg-muted")}>
            {owner ? initialsFor(owner) : <Users className="w-3 h-3" />}
          </AvatarFallback>
        </Avatar>
        <span className="font-medium">{owner ?? assignment.teamName ?? "Unassigned"}</span>
        {!owner && assignment.teamName && <span className="text-muted-foreground">(team)</span>}
        {badges}
        {due && (
          <span className={cn("flex items-center gap-1", due.overdue ? "text-destructive font-medium" : "text-muted-foreground")}>
            <Clock className="w-3 h-3" /> {due.overdue ? "Overdue" : "Due"} {due.text}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className={cn("rounded-lg border border-border p-4 space-y-3", className)}>
      <div className="flex items-start gap-3">
        <Avatar className="h-10 w-10">
          <AvatarFallback className={cn(owner ? "bg-primary/10 text-primary font-semibold" : "bg-muted")}>
            {owner ? initialsFor(owner) : <Users className="w-4 h-4" />}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight truncate">
            {owner ?? assignment.teamName ?? "Unassigned"}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {assignment.teamName ? `${assignment.teamName} team` : "No team"}
            {assignment.autoRouted ? " • auto-routed" : ""}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">{badges}</div>

      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        {due && (
          <div className={cn("flex items-center gap-1", due.overdue && "text-destructive font-medium")}>
            <Clock className="w-3.5 h-3.5" /> {due.overdue ? "Overdue" : "Due"} {due.text}
          </div>
        )}
        {activity && <div className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Updated {activity}</div>}
        {assignment.managerName && (
          <div className="flex items-center gap-1"><Crown className="w-3.5 h-3.5" /> Mgr: {assignment.managerName}</div>
        )}
        {assignment.backupName && (
          <div className="flex items-center gap-1"><LifeBuoy className="w-3.5 h-3.5" /> Backup: {assignment.backupName}</div>
        )}
      </div>
    </div>
  )
}
