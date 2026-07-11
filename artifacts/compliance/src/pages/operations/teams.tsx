import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListTeams,
  useListUsers,
  useCreateTeam,
  useUpdateTeam,
  useAddTeamMember,
  useRemoveTeamMember,
  getListTeamsQueryKey,
} from "@workspace/api-client-react"
import type { Team } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { UsersRound, Plus, Loader2, X, Pencil, UserPlus } from "lucide-react"

export default function TeamManagement() {
  const queryClient = useQueryClient()
  const { data: teams = [], isLoading } = useListTeams()
  const { data: users = [] } = useListUsers()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListTeamsQueryKey() })

  const createMut = useCreateTeam({ mutation: { onSuccess: invalidate } })
  const updateMut = useUpdateTeam({ mutation: { onSuccess: invalidate } })
  const addMut = useAddTeamMember({ mutation: { onSuccess: invalidate } })
  const removeMut = useRemoveTeamMember({ mutation: { onSuccess: invalidate } })

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Team | null>(null)
  const [form, setForm] = React.useState({ name: "", description: "" })
  const [addingTo, setAddingTo] = React.useState<Team | null>(null)
  const [selectedUser, setSelectedUser] = React.useState("")

  const openCreate = () => { setEditing(null); setForm({ name: "", description: "" }); setDialogOpen(true) }
  const openEdit = (t: Team) => { setEditing(t); setForm({ name: t.name, description: t.description ?? "" }); setDialogOpen(true) }

  const submit = () => {
    const data = { name: form.name.trim(), description: form.description.trim() || null }
    if (editing) {
      updateMut.mutate({ id: editing.id, data }, { onSuccess: () => setDialogOpen(false) })
    } else {
      createMut.mutate({ data }, { onSuccess: () => setDialogOpen(false) })
    }
  }

  const addMember = () => {
    if (!addingTo || !selectedUser) return
    addMut.mutate(
      { id: addingTo.id, data: { userId: Number(selectedUser) } },
      { onSuccess: () => { setAddingTo(null); setSelectedUser("") } },
    )
  }

  const memberIds = new Set(addingTo?.members.map((m) => m.id))
  const candidates = users.filter((u) => u.active && !memberIds.has(u.id))

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <UsersRound className="w-7 h-7 text-primary" /> Team Management
          </h1>
          <p className="text-muted-foreground mt-1">Organize reviewers into teams that packages route to.</p>
        </div>
        <Button onClick={openCreate} className="gap-2 shrink-0"><Plus className="w-4 h-4" /> New Team</Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : teams.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No teams yet. Create your first team.</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {teams.map((t) => (
            <Card key={t.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">{t.name}
                      <Badge variant="secondary">{t.memberCount} {t.memberCount === 1 ? "member" : "members"}</Badge>
                    </CardTitle>
                    {t.description && <CardDescription className="mt-1">{t.description}</CardDescription>}
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(t)}><Pencil className="w-4 h-4" /></Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {t.members.length === 0
                    ? <span className="text-sm text-muted-foreground">No members yet.</span>
                    : t.members.map((m) => (
                      <span key={m.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent/40 pl-3 pr-1.5 py-1 text-sm">
                        <span>{m.name}</span>
                        <span className="text-xs text-muted-foreground">{m.role}</span>
                        <button
                          className="rounded-full p-0.5 hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => removeMut.mutate({ id: t.id, userId: m.id })}
                          title="Remove from team"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                </div>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => { setAddingTo(t); setSelectedUser("") }}>
                  <UserPlus className="w-4 h-4" /> Add member
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit team" : "New team"}</DialogTitle>
            <DialogDescription>Teams receive package reviews routed by category and workload.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Team name</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Food & Beverage Compliance" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What this team is responsible for" />
            </div>
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

      <Dialog open={!!addingTo} onOpenChange={(o) => !o && setAddingTo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add member to {addingTo?.name}</DialogTitle>
            <DialogDescription>Only active users not already on the team are shown.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>User</Label>
            <Select value={selectedUser} onValueChange={setSelectedUser}>
              <SelectTrigger><SelectValue placeholder="Choose a user" /></SelectTrigger>
              <SelectContent>
                {candidates.length === 0
                  ? <div className="px-2 py-4 text-center text-sm text-muted-foreground">No available users</div>
                  : candidates.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name} — {u.role}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddingTo(null)}>Cancel</Button>
            <Button onClick={addMember} disabled={!selectedUser || addMut.isPending} className="gap-2">
              {addMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
