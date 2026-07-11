import * as React from "react"
import {
  useListUsers,
  useListTeams,
  useBulkAssignReviews,
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
import { useToast } from "@/hooks/use-toast"
import { Loader2 } from "lucide-react"

const UNASSIGNED = "__unassigned__"
const NO_TEAM = "__none__"
const KEEP = "__keep__"
const PRIORITIES = ["low", "normal", "high", "critical"] as const
const REASONS = [
  "Workload balancing",
  "Domain expertise",
  "Coverage / out of office",
  "Escalation",
  "Reassignment requested",
] as const

// Assign / reassign many package reviews at once. Only fields the user changes
// are sent; priority defaults to "keep" so a batch reassignment doesn't silently
// reset priorities.
export function BulkAssignDialog({
  open,
  onOpenChange,
  packageIds,
  onAssigned,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  packageIds: number[]
  onAssigned?: () => void
}) {
  const { toast } = useToast()
  const { data: users = [] } = useListUsers()
  const { data: teams = [] } = useListTeams()
  const bulk = useBulkAssignReviews()

  const [assigneeId, setAssigneeId] = React.useState<string>(UNASSIGNED)
  const [teamId, setTeamId] = React.useState<string>(NO_TEAM)
  const [backupId, setBackupId] = React.useState<string>(UNASSIGNED)
  const [managerId, setManagerId] = React.useState<string>(UNASSIGNED)
  const [priority, setPriority] = React.useState<string>(KEEP)
  const [reason, setReason] = React.useState<string>(REASONS[0])
  const [comments, setComments] = React.useState<string>("")

  React.useEffect(() => {
    if (!open) return
    setAssigneeId(UNASSIGNED)
    setTeamId(NO_TEAM)
    setBackupId(UNASSIGNED)
    setManagerId(UNASSIGNED)
    setPriority(KEEP)
    setReason(REASONS[0])
    setComments("")
  }, [open])

  const activeUsers = users.filter((u) => u.active)

  function submit() {
    bulk.mutate(
      {
        data: {
          packageIds,
          assigneeUserId: assigneeId === UNASSIGNED ? null : Number(assigneeId),
          teamId: teamId === NO_TEAM ? null : Number(teamId),
          backupUserId: backupId === UNASSIGNED ? null : Number(backupId),
          managerUserId: managerId === UNASSIGNED ? null : Number(managerId),
          ...(priority === KEEP ? {} : { priority: priority as (typeof PRIORITIES)[number] }),
          reason,
          comments: comments.trim() || undefined,
        },
      },
      {
        onSuccess: (res) => {
          if (res.failed.length > 0) {
            toast({
              variant: "destructive",
              title: `Assigned ${res.assigned}, ${res.failed.length} failed`,
              description: "Some packages could not be assigned.",
            })
          } else {
            toast({ title: "Reviews assigned", description: `${res.assigned} review(s) updated.` })
          }
          onOpenChange(false)
          onAssigned?.()
        },
        onError: () =>
          toast({ variant: "destructive", title: "Bulk assignment failed", description: "Please try again." }),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign {packageIds.length} review{packageIds.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>Set ownership for the selected packages. Empty fields clear the value.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Assignee</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {activeUsers.map((u) => (
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Backup reviewer</Label>
              <Select value={backupId} onValueChange={setBackupId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>None</SelectItem>
                  {activeUsers.map((u) => (
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
                  {activeUsers.map((u) => (
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
                  <SelectItem value={KEEP}>Keep current</SelectItem>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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

          <div className="space-y-1.5">
            <Label>Comments <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Add context for this batch…" rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={bulk.isPending || packageIds.length === 0}>
            {bulk.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Assign {packageIds.length} review{packageIds.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
