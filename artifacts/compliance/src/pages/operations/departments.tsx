import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListDepartments,
  useListUsers,
  useCreateDepartment,
  useUpdateDepartment,
  useDeleteDepartment,
  getListDepartmentsQueryKey,
} from "@workspace/api-client-react"
import type { Department } from "@workspace/api-client-react"
import { usePermissions } from "@/lib/access"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
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
import { Building2, Plus, Loader2, Pencil, Trash2, Crown, ArrowUpRight } from "lucide-react"

export default function DepartmentsPage() {
  const queryClient = useQueryClient()
  const { has } = usePermissions()
  const canWrite = has("specialists:write")
  const { data: departments = [], isLoading } = useListDepartments()
  const { data: users = [] } = useListUsers()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey() })

  const createMut = useCreateDepartment({ mutation: { onSuccess: invalidate } })
  const updateMut = useUpdateDepartment({ mutation: { onSuccess: invalidate } })
  const deleteMut = useDeleteDepartment({ mutation: { onSuccess: invalidate } })

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Department | null>(null)
  const [deleting, setDeleting] = React.useState<Department | null>(null)
  const [form, setForm] = React.useState({ name: "", description: "", leaderUserId: "none", escalationOwnerUserId: "none", active: true })

  const openCreate = () => { setEditing(null); setForm({ name: "", description: "", leaderUserId: "none", escalationOwnerUserId: "none", active: true }); setDialogOpen(true) }
  const openEdit = (d: Department) => {
    setEditing(d)
    setForm({
      name: d.name,
      description: d.description ?? "",
      leaderUserId: d.leaderUserId ? String(d.leaderUserId) : "none",
      escalationOwnerUserId: d.escalationOwnerUserId ? String(d.escalationOwnerUserId) : "none",
      active: d.active,
    })
    setDialogOpen(true)
  }

  const submit = () => {
    const data = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      leaderUserId: form.leaderUserId === "none" ? null : Number(form.leaderUserId),
      escalationOwnerUserId: form.escalationOwnerUserId === "none" ? null : Number(form.escalationOwnerUserId),
      active: form.active,
    }
    if (editing) updateMut.mutate({ id: editing.id, data }, { onSuccess: () => setDialogOpen(false) })
    else createMut.mutate({ data }, { onSuccess: () => setDialogOpen(false) })
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="w-7 h-7 text-primary" /> Departments
          </h1>
          <p className="text-muted-foreground mt-1">Functional groupings of specialists with a leader and escalation owner.</p>
        </div>
        {canWrite && <Button onClick={openCreate} className="gap-2 shrink-0"><Plus className="w-4 h-4" /> New Department</Button>}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : departments.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No departments yet. Create your first department.</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {departments.map((d) => (
            <Card key={d.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {d.name}
                      <Badge variant="secondary">{d.memberCount} {d.memberCount === 1 ? "member" : "members"}</Badge>
                      {!d.active && <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>}
                    </CardTitle>
                    {d.description && <CardDescription className="mt-1">{d.description}</CardDescription>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {canWrite && <Button variant="ghost" size="icon" onClick={() => openEdit(d)}><Pencil className="w-4 h-4" /></Button>}
                    {canWrite && <Button variant="ghost" size="icon" onClick={() => setDeleting(d)}><Trash2 className="w-4 h-4 text-destructive" /></Button>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-1.5"><Crown className="w-4 h-4 text-warning" /> Leader: <span className="font-medium">{d.leaderName ?? "—"}</span></div>
                  <div className="flex items-center gap-1.5"><ArrowUpRight className="w-4 h-4 text-primary" /> Escalation: <span className="font-medium">{d.escalationOwnerName ?? "—"}</span></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {d.members.length === 0
                    ? <span className="text-muted-foreground">No specialists assigned.</span>
                    : d.members.map((m) => (
                      <span key={m.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent/40 px-3 py-1 text-xs">
                        {m.name} <span className="text-muted-foreground">{m.role}</span>
                      </span>
                    ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit department" : "New department"}</DialogTitle>
            <DialogDescription>Members are derived from specialists assigned to this department.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Compliance" /></div>
            <div className="space-y-1.5"><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Leader</Label>
                <Select value={form.leaderUserId} onValueChange={(v) => setForm((f) => ({ ...f, leaderUserId: v }))}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {users.filter((u) => u.active).map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Escalation owner</Label>
                <Select value={form.escalationOwnerUserId} onValueChange={(v) => setForm((f) => ({ ...f, escalationOwnerUserId: v }))}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {users.filter((u) => u.active).map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span>Active</span>
              <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} />
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
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Specialists in this department will become unassigned. Their profiles are preserved. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleting) deleteMut.mutate({ id: deleting.id }, { onSuccess: () => setDeleting(null) }) }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
