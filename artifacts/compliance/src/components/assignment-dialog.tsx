import * as React from "react"
import {
  useListAssignableReviewers,
  useAssignPackageReview,
  useRecommendReviewAssignee,
  getRecommendReviewAssigneeQueryKey,
  type ReviewAssignment,
} from "@workspace/api-client-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { format, endOfDay, startOfDay } from "date-fns"
import { Loader2, Lightbulb, AlertTriangle, CalendarIcon } from "lucide-react"

const UNASSIGNED = "__unassigned__"
const NO_TEAM = "__none__"
const PRIORITIES = ["low", "normal", "high", "critical"] as const
const REASONS = [
  "Workload balancing",
  "Domain expertise",
  "Coverage / out of office",
  "Escalation",
  "Reassignment requested",
  "Auto-routed override",
] as const

export function AssignmentDialog({
  open,
  onOpenChange,
  packageId,
  packageName,
  assignment,
  onAssigned,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  packageId: number
  packageName?: string
  assignment: ReviewAssignment | null | undefined
  onAssigned?: () => void
}) {
  const { toast } = useToast()
  const { data: assignable } = useListAssignableReviewers()
  const activeUsers = assignable?.users ?? []
  const teams = assignable?.teams ?? []
  const assign = useAssignPackageReview()

  const [assigneeId, setAssigneeId] = React.useState<string>(UNASSIGNED)
  const [teamId, setTeamId] = React.useState<string>(NO_TEAM)
  const [backupId, setBackupId] = React.useState<string>(UNASSIGNED)
  const [managerId, setManagerId] = React.useState<string>(UNASSIGNED)
  const [priority, setPriority] = React.useState<string>("normal")
  const [reason, setReason] = React.useState<string>(REASONS[0])
  const [comments, setComments] = React.useState<string>("")
  const [dueAt, setDueAt] = React.useState<Date | undefined>(undefined)

  // Seed the form from the current assignment each time the dialog opens.
  React.useEffect(() => {
    if (!open) return
    setAssigneeId(assignment?.assigneeUserId ? String(assignment.assigneeUserId) : UNASSIGNED)
    setTeamId(assignment?.teamId ? String(assignment.teamId) : NO_TEAM)
    setBackupId(assignment?.backupUserId ? String(assignment.backupUserId) : UNASSIGNED)
    setManagerId(assignment?.managerUserId ? String(assignment.managerUserId) : UNASSIGNED)
    setPriority(assignment?.priority ?? "normal")
    setReason(REASONS[0])
    setComments("")
    // Seed from the current deadline so unrelated edits never silently shift it.
    setDueAt(assignment?.dueAt ? new Date(assignment.dueAt) : undefined)
  }, [open, assignment])

  const teamNum = teamId === NO_TEAM ? undefined : Number(teamId)
  const assigneeNum = assigneeId === UNASSIGNED ? undefined : Number(assigneeId)

  // The roster is the Specialist Directory (linked, active reviewers). If a saved
  // assignment points at someone no longer in it, inject a labeled fallback so the
  // Select shows who currently holds the role instead of rendering blank.
  const rosterWith = (currentId: string, name: string | null | undefined) => {
    if (currentId === UNASSIGNED) return activeUsers
    const id = Number(currentId)
    if (activeUsers.some((u) => u.id === id)) return activeUsers
    return [{ id, name: `${name ?? "Former reviewer"} (not in directory)` }, ...activeUsers]
  }
  const assigneeOptions = rosterWith(assigneeId, assignment?.assigneeName)
  const backupOptions = rosterWith(backupId, assignment?.backupName)
  const managerOptions = rosterWith(managerId, assignment?.managerName)

  const recommendParams = {
    ...(assigneeNum !== undefined ? { assigneeUserId: assigneeNum } : {}),
    ...(teamNum !== undefined ? { teamId: teamNum } : {}),
  }
  const { data: recommendation } = useRecommendReviewAssignee(recommendParams, {
    query: { enabled: open, queryKey: getRecommendReviewAssigneeQueryKey(recommendParams) },
  })

  function submit() {
    assign.mutate(
      {
        id: packageId,
        data: {
          assigneeUserId: assigneeId === UNASSIGNED ? null : Number(assigneeId),
          teamId: teamId === NO_TEAM ? null : Number(teamId),
          backupUserId: backupId === UNASSIGNED ? null : Number(backupId),
          managerUserId: managerId === UNASSIGNED ? null : Number(managerId),
          priority: priority as (typeof PRIORITIES)[number],
          // ISO string = explicit deadline; null = reset to priority SLA (only
          // when clearing an existing one); undefined = leave unchanged.
          dueAt: dueAt
            ? dueAt.toISOString()
            : assignment?.dueAt
              ? null
              : undefined,
          reason,
          comments: comments.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Assignment updated", description: `Ownership saved for ${packageName ?? "this review"}.` })
          onOpenChange(false)
          onAssigned?.()
        },
        onError: () =>
          toast({ variant: "destructive", title: "Assignment failed", description: "Could not update the assignment. Please try again." }),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign review</DialogTitle>
          <DialogDescription>{packageName ? `Set ownership for "${packageName}".` : "Set review ownership."}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Assignee</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {assigneeOptions.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Team</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TEAM}>No team</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {recommendation && (recommendation.overCapacity || recommendation.suggested.length > 0) && (
            <div className={`rounded-lg border p-3 text-xs space-y-2 ${recommendation.overCapacity ? "border-warning/40 bg-warning/5" : "border-border bg-accent/40"}`}>
              <div className="flex items-center gap-2 font-medium">
                {recommendation.overCapacity ? <AlertTriangle className="w-4 h-4 text-warning" /> : <Lightbulb className="w-4 h-4 text-primary" />}
                {recommendation.reason}
              </div>
              {recommendation.suggested.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {recommendation.suggested.map((s) => (
                    <Button key={s.userId} type="button" size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => setAssigneeId(String(s.userId))}>
                      {s.name} ({s.activeCount}/{s.capacity})
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Backup reviewer</Label>
              <Select value={backupId} onValueChange={setBackupId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>None</SelectItem>
                  {backupOptions.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Responsible manager</Label>
              <Select value={managerId} onValueChange={setManagerId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>None</SelectItem>
                  {managerOptions.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Due date <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn("w-full justify-start text-left font-normal", !dueAt && "text-muted-foreground")}
                >
                  <CalendarIcon className="w-4 h-4 mr-2" />
                  {dueAt ? format(dueAt, "PPP") : "Auto — based on priority SLA"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dueAt}
                  onSelect={(d) => setDueAt(d ? endOfDay(d) : undefined)}
                  disabled={{ before: startOfDay(new Date()) }}
                />
                {dueAt && (
                  <div className="border-t p-2">
                    <Button type="button" variant="ghost" size="sm" className="w-full text-xs" onClick={() => setDueAt(undefined)}>
                      Clear (use priority SLA)
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
            <p className="text-[11px] text-muted-foreground">
              {dueAt
                ? "Reviewer must complete by this date."
                : "No custom deadline — the priority's SLA window sets the due date."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Comments <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Add context for this assignment…" rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={assign.isPending}>
            {assign.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save assignment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
