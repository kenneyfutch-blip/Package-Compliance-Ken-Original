import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListSpecialists,
  useListDepartments,
  useListLinkableUsers,
  getListLinkableUsersQueryKey,
  useCreateSpecialist,
  useUpdateSpecialist,
  useAddSpecialistCertification,
  useRemoveSpecialistCertification,
  getListSpecialistsQueryKey,
} from "@workspace/api-client-react"
import type { Specialist, SpecialistInput } from "@workspace/api-client-react"
import { usePermissions } from "@/lib/access"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
  UserRound, Plus, Loader2, Pencil, ShieldCheck, Award, X, Search,
} from "lucide-react"

const STATUSES = ["active", "disabled", "archived"]

const toList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean)

type FormState = {
  name: string
  jobTitle: string
  email: string
  employeeId: string
  userId: string
  departmentId: string
  managerName: string
  location: string
  role: string
  status: string
  expertise: string
  regions: string
  productCategories: string
  routingPriority: number
  expertiseRating: number
  escalationLevel: number
  maxActiveReviews: number
  activeReviewer: boolean
  acceptingAssignments: boolean
  backupReviewer: boolean
  approvalAuthority: boolean
  notes: string
}

const emptyForm: FormState = {
  name: "", jobTitle: "", email: "", employeeId: "", userId: "none", departmentId: "none",
  managerName: "", location: "", role: "Reviewer", status: "active",
  expertise: "", regions: "", productCategories: "",
  routingPriority: 0, expertiseRating: 3, escalationLevel: 1, maxActiveReviews: 5,
  activeReviewer: true, acceptingAssignments: true, backupReviewer: false,
  approvalAuthority: false, notes: "",
}

function fromSpecialist(s: Specialist): FormState {
  return {
    name: s.name,
    jobTitle: s.jobTitle ?? "",
    email: s.email ?? "",
    employeeId: s.employeeId ?? "",
    userId: s.userId ? String(s.userId) : "none",
    departmentId: s.departmentId ? String(s.departmentId) : "none",
    managerName: s.managerName ?? "",
    location: s.location ?? "",
    role: s.role,
    status: s.status,
    expertise: s.expertise.join(", "),
    regions: s.regions.join(", "),
    productCategories: s.productCategories.join(", "),
    routingPriority: s.routingPriority,
    expertiseRating: s.expertiseRating,
    escalationLevel: s.escalationLevel,
    maxActiveReviews: s.maxActiveReviews,
    activeReviewer: s.activeReviewer,
    acceptingAssignments: s.acceptingAssignments,
    backupReviewer: s.backupReviewer,
    approvalAuthority: s.approvalAuthority,
    notes: s.notes ?? "",
  }
}

function toInput(f: FormState): SpecialistInput {
  return {
    name: f.name.trim(),
    jobTitle: f.jobTitle.trim() || null,
    email: f.email.trim() || null,
    employeeId: f.employeeId.trim() || null,
    userId: f.userId === "none" ? null : Number(f.userId),
    departmentId: f.departmentId === "none" ? null : Number(f.departmentId),
    managerName: f.managerName.trim() || null,
    location: f.location.trim() || null,
    role: f.role.trim() || "Reviewer",
    status: f.status,
    expertise: toList(f.expertise),
    regions: toList(f.regions),
    productCategories: toList(f.productCategories),
    routingPriority: Number(f.routingPriority),
    expertiseRating: Number(f.expertiseRating),
    escalationLevel: Number(f.escalationLevel),
    maxActiveReviews: Number(f.maxActiveReviews),
    activeReviewer: f.activeReviewer,
    acceptingAssignments: f.acceptingAssignments,
    backupReviewer: f.backupReviewer,
    approvalAuthority: f.approvalAuthority,
    notes: f.notes.trim() || null,
  }
}

function statusBadge(status: string) {
  if (status === "active") return <Badge variant="outline" className="text-success border-success/40">Active</Badge>
  if (status === "disabled") return <Badge variant="outline" className="text-warning border-warning/40">Disabled</Badge>
  return <Badge variant="outline" className="text-muted-foreground">Archived</Badge>
}

export default function SpecialistsDirectory() {
  const queryClient = useQueryClient()
  const { has } = usePermissions()
  const canWrite = has("specialists:write")
  const { data: specialists = [], isLoading } = useListSpecialists()
  const { data: departments = [] } = useListDepartments()
  // Only fetch linkable accounts for users who can actually edit the link.
  const { data: linkableUsers = [] } = useListLinkableUsers({
    query: { enabled: canWrite, queryKey: getListLinkableUsersQueryKey() },
  })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListSpecialistsQueryKey() })

  const createMut = useCreateSpecialist({ mutation: { onSuccess: invalidate } })
  const updateMut = useUpdateSpecialist({ mutation: { onSuccess: invalidate } })
  const addCertMut = useAddSpecialistCertification({ mutation: { onSuccess: invalidate } })
  const removeCertMut = useRemoveSpecialistCertification({ mutation: { onSuccess: invalidate } })

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Specialist | null>(null)
  const [form, setForm] = React.useState<FormState>(emptyForm)
  const [search, setSearch] = React.useState("")
  const [cert, setCert] = React.useState({ name: "", issuer: "", effectiveDate: "", expirationDate: "" })

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  const openCreate = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true) }
  const openEdit = (s: Specialist) => { setEditing(s); setForm(fromSpecialist(s)); setDialogOpen(true) }

  const submit = () => {
    const data = toInput(form)
    if (editing) {
      updateMut.mutate({ id: editing.id, data }, { onSuccess: () => setDialogOpen(false) })
    } else {
      createMut.mutate({ data }, { onSuccess: () => setDialogOpen(false) })
    }
  }

  const addCert = () => {
    if (!editing || !cert.name.trim()) return
    addCertMut.mutate(
      {
        id: editing.id,
        data: {
          name: cert.name.trim(),
          issuer: cert.issuer.trim() || null,
          effectiveDate: cert.effectiveDate || null,
          expirationDate: cert.expirationDate || null,
        },
      },
      { onSuccess: (updated) => { setEditing(updated); setCert({ name: "", issuer: "", effectiveDate: "", expirationDate: "" }) } },
    )
  }

  const removeCert = (certId: number) => {
    if (!editing) return
    removeCertMut.mutate({ id: editing.id, certId }, { onSuccess: (updated) => setEditing(updated) })
  }

  const q = search.trim().toLowerCase()
  const filtered = q
    ? specialists.filter((s) =>
        [s.name, s.jobTitle, s.role, s.departmentName, ...s.expertise, ...s.productCategories]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      )
    : specialists

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <UserRound className="w-7 h-7 text-primary" /> Team Directory
          </h1>
          <p className="text-muted-foreground mt-1">
            The source of truth for reviewer expertise, approval authority, and routing profiles.
          </p>
        </div>
        {canWrite && <Button onClick={openCreate} className="gap-2 shrink-0"><Plus className="w-4 h-4" /> New Specialist</Button>}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search name, expertise, category…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          {specialists.length === 0 ? "No specialists yet. Add your first reviewer." : "No specialists match your search."}
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Specialist</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Expertise</TableHead>
                  <TableHead className="text-center">Approval</TableHead>
                  <TableHead className="text-center">Esc. Level</TableHead>
                  <TableHead className="text-center">Workload</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.jobTitle || s.role}</div>
                    </TableCell>
                    <TableCell className="text-sm">{s.departmentName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-[220px]">
                        {s.expertise.slice(0, 3).map((e) => <Badge key={e} variant="secondary" className="text-xs">{e}</Badge>)}
                        {s.expertise.length > 3 && <Badge variant="outline" className="text-xs">+{s.expertise.length - 3}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {s.approvalAuthority ? <ShieldCheck className="w-4 h-4 text-success inline" /> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-center text-sm">L{s.escalationLevel}</TableCell>
                    <TableCell className="text-center text-sm">
                      <span className={s.availableCapacity === 0 ? "text-destructive" : ""}>{s.activeReviews}/{s.maxActiveReviews}</span>
                    </TableCell>
                    <TableCell className="text-center">{statusBadge(s.status)}</TableCell>
                    <TableCell>
                      {canWrite && <Button variant="ghost" size="icon" onClick={() => openEdit(s)}><Pencil className="w-4 h-4" /></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "New specialist"}</DialogTitle>
            <DialogDescription>Directory identity plus the AI routing profile used to match work.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Full name"><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Jane Doe" /></Field>
              <Field label="Job title"><Input value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} placeholder="Analyst, Quality Regulatory Compliance" /></Field>
              <Field label="Email"><Input value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="jane@company.com" /></Field>
              <Field label="Employee ID"><Input value={form.employeeId} onChange={(e) => set("employeeId", e.target.value)} /></Field>
              <Field label="Department">
                <Select value={form.departmentId} onValueChange={(v) => set("departmentId", v)}>
                  <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {departments.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Manager"><Input value={form.managerName} onChange={(e) => set("managerName", e.target.value)} /></Field>
              <Field label="Role / title in workflow"><Input value={form.role} onChange={(e) => set("role", e.target.value)} placeholder="Compliance Reviewer & Approver" /></Field>
              <Field label="Location"><Input value={form.location} onChange={(e) => set("location", e.target.value)} /></Field>
              <Field label="Linked user account">
                <Select value={form.userId} onValueChange={(v) => set("userId", v)}>
                  <SelectTrigger><SelectValue placeholder="Not linked" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not linked</SelectItem>
                    {linkableUsers.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.name}{u.email ? ` (${u.email})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              Link this profile to a login account to make the specialist assignable in the review picker.
            </p>

            <Field label="Areas of expertise (comma separated)">
              <Input value={form.expertise} onChange={(e) => set("expertise", e.target.value)} placeholder="Packaging Compliance, Final Approvals" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Regions (comma separated)"><Input value={form.regions} onChange={(e) => set("regions", e.target.value)} placeholder="US, EU" /></Field>
              <Field label="Product categories (comma separated)"><Input value={form.productCategories} onChange={(e) => set("productCategories", e.target.value)} placeholder="Food, Cosmetics" /></Field>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <Field label="Routing priority"><Input type="number" value={form.routingPriority} onChange={(e) => set("routingPriority", Number(e.target.value))} /></Field>
              <Field label="Expertise (1-5)"><Input type="number" min={1} max={5} value={form.expertiseRating} onChange={(e) => set("expertiseRating", Number(e.target.value))} /></Field>
              <Field label="Escalation level"><Input type="number" min={1} value={form.escalationLevel} onChange={(e) => set("escalationLevel", Number(e.target.value))} /></Field>
              <Field label="Max active reviews"><Input type="number" min={0} value={form.maxActiveReviews} onChange={(e) => set("maxActiveReviews", Number(e.target.value))} /></Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Status">
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Toggle label="Active reviewer" checked={form.activeReviewer} onChange={(v) => set("activeReviewer", v)} />
              <Toggle label="Accepting assignments" checked={form.acceptingAssignments} onChange={(v) => set("acceptingAssignments", v)} />
              <Toggle label="Backup reviewer" checked={form.backupReviewer} onChange={(v) => set("backupReviewer", v)} />
              <Toggle label="Approval authority" checked={form.approvalAuthority} onChange={(v) => set("approvalAuthority", v)} />
            </div>

            <Field label="Notes"><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>

            {editing && (
              <div className="rounded-lg border border-border p-3 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium"><Award className="w-4 h-4 text-primary" /> Certifications</div>
                <div className="flex flex-wrap gap-2">
                  {editing.certifications.length === 0
                    ? <span className="text-sm text-muted-foreground">No certifications recorded.</span>
                    : editing.certifications.map((c) => (
                      <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent/40 pl-3 pr-1.5 py-1 text-sm">
                        <span>{c.name}</span>
                        {c.issuer && <span className="text-xs text-muted-foreground">{c.issuer}</span>}
                        <button className="rounded-full p-0.5 hover:bg-destructive/10 hover:text-destructive" onClick={() => removeCert(c.id)} title="Remove">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Certification name" value={cert.name} onChange={(e) => setCert((c) => ({ ...c, name: e.target.value }))} />
                  <Input placeholder="Issuer" value={cert.issuer} onChange={(e) => setCert((c) => ({ ...c, issuer: e.target.value }))} />
                  <Input type="date" value={cert.effectiveDate} onChange={(e) => setCert((c) => ({ ...c, effectiveDate: e.target.value }))} />
                  <Input type="date" value={cert.expirationDate} onChange={(e) => setCert((c) => ({ ...c, expirationDate: e.target.value }))} />
                </div>
                <Button variant="outline" size="sm" className="gap-2" onClick={addCert} disabled={!cert.name.trim() || addCertMut.isPending}>
                  {addCertMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Add certification
                </Button>
              </div>
            )}
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
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm cursor-pointer">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}
