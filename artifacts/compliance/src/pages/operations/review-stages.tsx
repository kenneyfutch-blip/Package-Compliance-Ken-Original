import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListReviewStages,
  useListTeams,
  useListDepartments,
  useListSpecialists,
  useCreateReviewStage,
  useUpdateReviewStage,
  useDeleteReviewStage,
  getListReviewStagesQueryKey,
} from "@workspace/api-client-react"
import type { ReviewStage } from "@workspace/api-client-react"
import { usePermissions } from "@/lib/access"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Workflow, Plus, Loader2, Pencil, Trash2, CheckCircle2, XCircle } from "lucide-react"

type FormState = {
  name: string
  stageOrder: number
  assignedTeamId: string
  assignedDepartmentId: string
  assignedSpecialistId: string
  approvalAuthority: string
  slaHours: number
  escalationPath: string
  active: boolean
}

const emptyForm: FormState = {
  name: "", stageOrder: 1, assignedTeamId: "none", assignedDepartmentId: "none",
  assignedSpecialistId: "none", approvalAuthority: "", slaHours: 48, escalationPath: "", active: true,
}

export default function ReviewStagesPage() {
  const queryClient = useQueryClient()
  const { has } = usePermissions()
  const canWrite = has("routing:write")
  const { data: stages = [], isLoading } = useListReviewStages()
  const { data: teams = [] } = useListTeams()
  const { data: departments = [] } = useListDepartments()
  const { data: specialists = [] } = useListSpecialists()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListReviewStagesQueryKey() })

  const createMut = useCreateReviewStage({ mutation: { onSuccess: invalidate } })
  const updateMut = useUpdateReviewStage({ mutation: { onSuccess: invalidate } })
  const deleteMut = useDeleteReviewStage({ mutation: { onSuccess: invalidate } })

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<ReviewStage | null>(null)
  const [deleting, setDeleting] = React.useState<ReviewStage | null>(null)
  const [form, setForm] = React.useState<FormState>(emptyForm)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  const openCreate = () => { setEditing(null); setForm({ ...emptyForm, stageOrder: stages.length + 1 }); setDialogOpen(true) }
  const openEdit = (s: ReviewStage) => {
    setEditing(s)
    setForm({
      name: s.name,
      stageOrder: s.stageOrder,
      assignedTeamId: s.assignedTeamId ? String(s.assignedTeamId) : "none",
      assignedDepartmentId: s.assignedDepartmentId ? String(s.assignedDepartmentId) : "none",
      assignedSpecialistId: s.assignedSpecialistId ? String(s.assignedSpecialistId) : "none",
      approvalAuthority: s.approvalAuthority ?? "",
      slaHours: s.slaHours,
      escalationPath: s.escalationPath ?? "",
      active: s.active,
    })
    setDialogOpen(true)
  }

  const submit = () => {
    const data = {
      name: form.name.trim(),
      stageOrder: Number(form.stageOrder),
      assignedTeamId: form.assignedTeamId === "none" ? null : Number(form.assignedTeamId),
      assignedDepartmentId: form.assignedDepartmentId === "none" ? null : Number(form.assignedDepartmentId),
      assignedSpecialistId: form.assignedSpecialistId === "none" ? null : Number(form.assignedSpecialistId),
      approvalAuthority: form.approvalAuthority.trim() || null,
      slaHours: Number(form.slaHours),
      escalationPath: form.escalationPath.trim() || null,
      active: form.active,
    }
    if (editing) updateMut.mutate({ id: editing.id, data }, { onSuccess: () => setDialogOpen(false) })
    else createMut.mutate({ data }, { onSuccess: () => setDialogOpen(false) })
  }

  const owner = (s: ReviewStage) =>
    s.assignedSpecialistName ?? s.assignedDepartmentName ?? s.assignedTeamName ?? "—"

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Workflow className="w-7 h-7 text-primary" /> Review Stages
          </h1>
          <p className="text-muted-foreground mt-1">The ordered pipeline a review moves through, each with an owner, SLA, and approval authority.</p>
        </div>
        {canWrite && <Button onClick={openCreate} className="gap-2 shrink-0"><Plus className="w-4 h-4" /> New Stage</Button>}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : stages.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No review stages defined yet.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 text-center">Order</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Approval authority</TableHead>
                  <TableHead className="text-center">SLA</TableHead>
                  <TableHead className="text-center">Active</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {stages.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-center font-mono text-sm">{s.stageOrder}</TableCell>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-sm">{owner(s)}</TableCell>
                    <TableCell className="text-sm">{s.approvalAuthority ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-center text-sm">{s.slaHours}h</TableCell>
                    <TableCell className="text-center">
                      {s.active ? <CheckCircle2 className="w-4 h-4 text-success inline" /> : <XCircle className="w-4 h-4 text-muted-foreground inline" />}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {canWrite && <Button variant="ghost" size="icon" onClick={() => openEdit(s)}><Pencil className="w-4 h-4" /></Button>}
                        {canWrite && <Button variant="ghost" size="icon" onClick={() => setDeleting(s)}><Trash2 className="w-4 h-4 text-destructive" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit review stage" : "New review stage"}</DialogTitle>
            <DialogDescription>Assign the stage to a team, department, or a specific specialist.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5"><Label className="text-xs">Name</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Initial Compliance Review" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Order</Label><Input type="number" value={form.stageOrder} onChange={(e) => set("stageOrder", Number(e.target.value))} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Team</Label>
                <Select value={form.assignedTeamId} onValueChange={(v) => set("assignedTeamId", v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">—</SelectItem>{teams.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Department</Label>
                <Select value={form.assignedDepartmentId} onValueChange={(v) => set("assignedDepartmentId", v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">—</SelectItem>{departments.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Specialist</Label>
                <Select value={form.assignedSpecialistId} onValueChange={(v) => set("assignedSpecialistId", v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">—</SelectItem>{specialists.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Approval authority</Label><Input value={form.approvalAuthority} onChange={(e) => set("approvalAuthority", e.target.value)} placeholder="e.g. Compliance Approver" /></div>
              <div className="space-y-1.5"><Label className="text-xs">SLA (hours)</Label><Input type="number" value={form.slaHours} onChange={(e) => set("slaHours", Number(e.target.value))} /></div>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Escalation path</Label><Input value={form.escalationPath} onChange={(e) => set("escalationPath", e.target.value)} placeholder="e.g. Escalate to Director after SLA breach" /></div>
            <label className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span>Active</span>
              <Switch checked={form.active} onCheckedChange={(v) => set("active", v)} />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!form.name.trim() || createMut.isPending || updateMut.isPending} className="gap-2">
              {(createMut.isPending || updateMut.isPending) && <Loader2 className="w-4 h-4 animate-spin" />}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>This stage will be removed from the review pipeline. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleting) deleteMut.mutate({ id: deleting.id }, { onSuccess: () => setDeleting(null) }) }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
