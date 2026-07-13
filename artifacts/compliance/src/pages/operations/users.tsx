import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListUsers,
  useListRoles,
  useInviteUser,
  useUpdateUser,
  useListPermissions,
  useGetUserPermissions,
  useUpdateUserPermissions,
  getListUsersQueryKey,
} from "@workspace/api-client-react"
import type { UserAccount, PermissionDef } from "@workspace/api-client-react"
import { usePermissions } from "@/lib/access"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Users, Plus, Loader2, Search, UserCheck, UserX, ShieldCheck, SlidersHorizontal } from "lucide-react"

function StatusBadge({ user }: { user: UserAccount }) {
  if (!user.active)
    return <Badge variant="secondary" className="gap-1"><UserX className="w-3 h-3" />Inactive</Badge>
  if (user.status === "invited")
    return <Badge className="bg-warning/10 text-warning hover:bg-warning/20 gap-1">Invited</Badge>
  return <Badge className="bg-success/10 text-success hover:bg-success/20 gap-1"><UserCheck className="w-3 h-3" />Active</Badge>
}

export default function UserManagement() {
  const queryClient = useQueryClient()
  const { me } = usePermissions()
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
  const [permsFor, setPermsFor] = React.useState<UserAccount | null>(null)

  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q)
  })

  // Stable display order so changing a user's role never reshuffles the list:
  // Platform Administrators always sort to the top, everyone else alphabetically
  // by name. Both keys are independent of the mutable role (except admin), so a
  // non-admin role change leaves every row exactly where it was.
  const sorted = [...filtered].sort((a, b) => {
    const aAdmin = a.roleKey === "platform_admin" ? 0 : 1
    const bAdmin = b.roleKey === "platform_admin" ? 0 : 1
    if (aAdmin !== bAdmin) return aAdmin - bAdmin
    const byName = a.name.localeCompare(b.name)
    if (byName !== 0) return byName
    // Final deterministic tie-breaker (stable id) so users with identical names
    // never fall back to the role-dependent server order on refetch.
    return a.id - b.id
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
          ) : sorted.length === 0 ? (
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
                {sorted.map((u) => (
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
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setPermsFor(u)}>
                          <SlidersHorizontal className="w-3.5 h-3.5" /> Permissions
                        </Button>
                        {u.active ? (
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeactivating(u)}>
                            Deactivate
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => toggleActive(u)}>Reactivate</Button>
                        )}
                      </div>
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

      {permsFor && (
        <PermissionsDialog
          user={permsFor}
          isSelf={me?.id === permsFor.id}
          onClose={() => setPermsFor(null)}
        />
      )}
    </div>
  )
}

// Per-user permission editor. Shows every capability grouped by area, with the
// user's role defaults pre-checked; anything the admin changes from those
// defaults is flagged as an override. Saving sends the full desired set — the
// server persists only the deltas from the role baseline.
function PermissionsDialog({
  user,
  isSelf,
  onClose,
}: {
  user: UserAccount
  isSelf: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { data: catalog = [] } = useListPermissions()
  const { data: perms, isLoading } = useGetUserPermissions(user.id)
  const updateMut = useUpdateUserPermissions()

  const [selected, setSelected] = React.useState<Set<string> | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (perms) setSelected(new Set(perms.effective))
  }, [perms])

  const roleSet = React.useMemo(
    () => new Set(perms?.rolePermissions ?? []),
    [perms],
  )

  const groups = React.useMemo(() => {
    const m = new Map<string, PermissionDef[]>()
    for (const p of catalog) {
      const list = m.get(p.category) ?? []
      list.push(p)
      m.set(p.category, list)
    }
    return [...m.entries()]
  }, [catalog])

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev ?? [])
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const resetToRole = () => setSelected(new Set(perms?.rolePermissions ?? []))

  const overrideCount = selected
    ? catalog.filter((p) => selected.has(p.key) !== roleSet.has(p.key)).length
    : 0

  const save = () => {
    if (!selected) return
    setError(null)
    updateMut.mutate(
      { id: user.id, data: { permissions: [...selected] } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() })
          onClose()
        },
        onError: (err: unknown) =>
          setError((err as { error?: string })?.error ?? "Could not update permissions"),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" /> Permissions — {user.name}
          </DialogTitle>
          <DialogDescription>
            Checked capabilities are granted. Items that differ from the{" "}
            {perms?.roleName ?? "role"} defaults are highlighted as overrides and
            take effect the next time the user's session refreshes.
          </DialogDescription>
        </DialogHeader>

        {isSelf ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            You cannot edit your own permissions. Ask another administrator to make changes.
          </p>
        ) : isLoading || !selected ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto pr-1 space-y-5">
            {groups.map(([category, defs]) => (
              <div key={category}>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {category}
                </h4>
                <div className="space-y-1.5">
                  {defs.map((p) => {
                    const checked = selected.has(p.key)
                    const inRole = roleSet.has(p.key)
                    const isOverride = checked !== inRole
                    return (
                      <label
                        key={p.key}
                        className={`flex items-start gap-3 rounded-md border p-2.5 cursor-pointer transition-colors ${
                          isOverride ? "border-primary/50 bg-primary/5" : "border-border hover:bg-accent/40"
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggle(p.key)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs">{p.key}</span>
                            {inRole && (
                              <Badge variant="outline" className="text-[10px] font-normal">role default</Badge>
                            )}
                            {isOverride && (
                              <Badge className="text-[10px] bg-primary/10 text-primary hover:bg-primary/20">
                                {checked ? "added" : "removed"}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{p.description}</div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter className="sm:justify-between gap-2">
          <div className="flex items-center gap-3">
            {!isSelf && (
              <>
                <span className="text-xs text-muted-foreground">
                  {overrideCount} override{overrideCount === 1 ? "" : "s"}
                </span>
                <Button variant="ghost" size="sm" onClick={resetToRole} disabled={updateMut.isPending || !selected}>
                  Reset to role defaults
                </Button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            {!isSelf && (
              <Button onClick={save} disabled={updateMut.isPending || !selected} className="gap-2">
                {updateMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save permissions
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
