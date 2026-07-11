import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListUsers,
  useListRoles,
  useInviteUser,
  useUpdateUser,
  getListUsersQueryKey,
} from "@workspace/api-client-react"
import type { UserAccount } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { Users, Plus, Loader2, Search, UserCheck, UserX, ShieldCheck } from "lucide-react"

function StatusBadge({ user }: { user: UserAccount }) {
  if (!user.active)
    return <Badge variant="secondary" className="gap-1"><UserX className="w-3 h-3" />Inactive</Badge>
  if (user.status === "invited")
    return <Badge className="bg-warning/10 text-warning hover:bg-warning/20 gap-1">Invited</Badge>
  return <Badge className="bg-success/10 text-success hover:bg-success/20 gap-1"><UserCheck className="w-3 h-3" />Active</Badge>
}

export default function UserManagement() {
  const queryClient = useQueryClient()
  const { data: users = [], isLoading } = useListUsers()
  const { data: roles = [] } = useListRoles()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() })

  const inviteMut = useInviteUser({ mutation: { onSuccess: invalidate } })
  const updateMut = useUpdateUser({ mutation: { onSuccess: invalidate } })

  const [search, setSearch] = React.useState("")
  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [invite, setInvite] = React.useState({ name: "", email: "", roleKey: "" })
  const [inviteError, setInviteError] = React.useState<string | null>(null)
  const [deactivating, setDeactivating] = React.useState<UserAccount | null>(null)

  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q)
  })

  const submitInvite = () => {
    setInviteError(null)
    inviteMut.mutate(
      { data: { name: invite.name.trim(), email: invite.email.trim(), roleKey: invite.roleKey } },
      {
        onSuccess: () => {
          setInviteOpen(false)
          setInvite({ name: "", email: "", roleKey: "" })
        },
        onError: (err: unknown) => setInviteError((err as { error?: string })?.error ?? "Could not invite user"),
      },
    )
  }

  const changeRole = (user: UserAccount, roleKey: string) => {
    if (roleKey === user.roleKey) return
    updateMut.mutate({ id: user.id, data: { roleKey } })
  }

  const toggleActive = (user: UserAccount) => {
    updateMut.mutate({ id: user.id, data: { active: !user.active } }, { onSettled: () => setDeactivating(null) })
  }

  const inviteValid = invite.name.trim() && invite.email.trim() && invite.roleKey

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Users className="w-7 h-7 text-primary" /> User Management
          </h1>
          <p className="text-muted-foreground mt-1">Invite teammates, assign roles, and control access.</p>
        </div>
        <Button onClick={() => setInviteOpen(true)} className="gap-2 shrink-0">
          <Plus className="w-4 h-4" /> Invite User
        </Button>
      </div>

      <div className="relative w-full max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search users..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">No users found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Teams</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="font-medium">{u.name}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell>
                      <Select value={u.roleKey ?? ""} onValueChange={(v) => changeRole(u, v)} disabled={updateMut.isPending}>
                        <SelectTrigger className="w-[190px]"><SelectValue placeholder="Set role" /></SelectTrigger>
                        <SelectContent>
                          {roles.map((r) => (
                            <SelectItem key={r.key} value={r.key}>{r.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(u.teams ?? []).length === 0
                          ? <span className="text-xs text-muted-foreground">None</span>
                          : (u.teams ?? []).map((t) => <Badge key={t.id} variant="outline">{t.name}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge user={u} /></TableCell>
                    <TableCell className="text-right">
                      {u.active ? (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeactivating(u)}>
                          Deactivate
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => toggleActive(u)}>Reactivate</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite user</DialogTitle>
            <DialogDescription>They join with the assigned role the first time they sign in with their Dollar Tree email.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input value={invite.name} onChange={(e) => setInvite((f) => ({ ...f, name: e.target.value }))} placeholder="Jane Associate" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={invite.email} onChange={(e) => setInvite((f) => ({ ...f, email: e.target.value }))} placeholder="jane@dollartree.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={invite.roleKey} onValueChange={(v) => setInvite((f) => ({ ...f, roleKey: v }))}>
                <SelectTrigger><SelectValue placeholder="Choose a role" /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      <span className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" />{r.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={submitInvite} disabled={!inviteValid || inviteMut.isPending} className="gap-2">
              {inviteMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Send invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deactivating} onOpenChange={(o) => !o && setDeactivating(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deactivating?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will lose access immediately until reactivated. Their review history is preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deactivating && toggleActive(deactivating)}>
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
