import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListEscalationRules,
  useListDepartments,
  useListSpecialists,
  useCreateEscalationRule,
  useUpdateEscalationRule,
  useDeleteEscalationRule,
  getListEscalationRulesQueryKey,
} from "@workspace/api-client-react"
import type { EscalationRule } from "@workspace/api-client-react"
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
import { TrendingUp, Plus, Loader2, Pencil, Trash2, CheckCircle2, XCircle, ArrowRight } from "lucide-react"

const TRIGGERS = [
  { value: "sla_breach", label: "SLA breach (hours over)" },
  { value: "severity", label: "Finding severity" },
  { value: "risk_score", label: "Risk score" },
  { value: "no_response", label: "No response (hours)" },
  { value: "reviewer_request", label: "Reviewer request" },
]
const OPERATORS = [
  { value: "greaterOrEqual", label: "≥" },
  { value: "greaterThan", label: ">" },
  { value: "equals", label: "=" },
  { value: "lessThan", label: "<" },
]

type FormState = {
  name: string
  matrixOrder: number
  triggerType: string
  triggerOperator: string
  triggerValue: string
  escalateToLevel: number
  escalateToRole: string
  escalateToSpecialistId: string
  escalateToDepartmentId: string
  active: boolean
}

const emptyForm: FormState = {
  name: "", matrixOrder: 1, triggerType: "sla_breach", triggerOperator: "greaterOrEqual",
  triggerValue: "24", escalateToLevel: 2, escalateToRole: "", escalateToSpecialistId: "none",
  escalateToDepartmentId: "none", active: true,
}

export default function EscalationMatrixPage() {
  const queryClient = useQueryClient()
  const { has } = usePermissions()
  const canWrite = has("routing:write")
  const { data: rules = [], isLoading } = useListEscalationRules()
  const { data: departments = [] } = useListDepartments()
  const { data: specialists = [] } = useListSpecialists()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListEscalationRulesQueryKey() })

  const createMut = useCreateEscalationRule({ mutation: { onSuccess: invalidate } })
  const updateMut = useUpdateEscalationRule({ mutation: { onSuccess: invalidate } })
  const deleteMut = useDeleteEscalationRule({ mutation: { onSuccess: invalidate } })

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<EscalationRule | null>(null)
  const [deleting, setDeleting] = React.useState<EscalationRule | null>(null)
  const [form, setForm] = React.useState<FormState>(emptyForm)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  const openCreate = () => { setEditing(null); setForm({ ...emptyForm, matrixOrder: rules.length + 1 }); setDialogOpen(true) }
  const openEdit = (r: EscalationRule) => {
    setEditing(r)
    setForm({
      name: r.name,
      matrixOrder: r.matrixOrder,
      triggerType: r.triggerType,
      triggerOperator: r.triggerOperator,
      triggerValue: r.triggerValue ?? "",
      escalateToLevel: r.escalateToLevel,
      escalateToRole: r.escalateToRole ?? "",
      escalateToSpecialistId: r.escalateToSpecialistId ? String(r.escalateToSpecialistId) : "none",
      escalateToDepartmentId: r.escalateToDepartmentId ? String(r.escalateToDepartmentId) : "none",
      active: r.active,
    })
    setDialogOpen(true)
  }

  const submit = () => {
    const data = {
      name: form.name.trim(),
      matrixOrder: Number(form.matrixOrder),
      triggerType: form.triggerType,
      triggerOperator: form.triggerOperator,
      triggerValue: form.triggerValue.trim(),
      escalateToLevel: Number(form.escalateToLevel),
      escalateToRole: form.escalateToRole.trim() || null,
      escalateToSpecialistId: form.escalateToSpecialistId === "none" ? null : Number(form.escalateToSpecialistId),
      escalateToDepartmentId: form.escalateToDepartmentId === "none" ? null : Number(form.escalateToDepartmentId),
      active: form.active,
    }
    if (editing) updateMut.mutate({ id: editing.id, data }, { onSuccess: () => setDialogOpen(false) })
    else createMut.mutate({ data }, { onSuccess: () => setDialogOpen(false) })
  }

  const triggerLabel = (t: string) => TRIGGERS.find((x) => x.value === t)?.label ?? t
  const opLabel = (o: string) => OPERATORS.find((x) => x.value === o)?.label ?? o
  const target = (r: EscalationRule) =>
    r.escalateToSpecialistName ?? r.escalateToDepartmentName ?? r.escalateToRole ?? `Level ${r.escalateToLevel}`

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <TrendingUp className="w-7 h-7 text-primary" /> Escalation Matrix
          </h1>
          <p className="text-muted-foreground mt-1">When a trigger fires, who a review escalates to and at what level.</p>
        </div>
        {canWrite && <Button onClick={openCreate} className="gap-2 shrink-0"><Plus className="w-4 h-4" /> New Rule</Button>}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : rules.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No escalation rules defined yet.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 text-center">Order</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Escalates to</TableHead>
                  <TableHead className="text-center">Level</TableHead>
                  <TableHead className="text-center">Active</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-center font-mono text-sm">{r.matrixOrder}</TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-sm">
                      <code className="text-xs bg-muted rounded px-1.5 py-0.5">{triggerLabel(r.triggerType)} {opLabel(r.triggerOperator)} {r.triggerValue}</code>
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="inline-flex items-center gap-1"><ArrowRight className="w-3.5 h-3.5 text-primary" /> {target(r)}</span>
                    </TableCell>
                    <TableCell className="text-center"><Badge variant="secondary">L{r.escalateToLevel}</Badge></TableCell>
                    <TableCell className="text-center">
                      {r.active ? <CheckCircle2 className="w-4 h-4 text-success inline" /> : <XCircle className="w-4 h-4 text-muted-foreground inline" />}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {canWrite && <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="w-4 h-4" /></Button>}
                        {canWrite && <Button variant="ghost" size="icon" onClick={() => setDeleting(r)}><Trash2 className="w-4 h-4 text-destructive" /></Button>}
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
            <DialogTitle>{editing ? "Edit escalation rule" : "New escalation rule"}</DialogTitle>
            <DialogDescription>Rules are evaluated in order; the first matching trigger applies.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5"><Label className="text-xs">Name</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Critical finding → Director" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Order</Label><Input type="number" value={form.matrixOrder} onChange={(e) => set("matrixOrder", Number(e.target.value))} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Trigger</Label>
                <Select value={form.triggerType} onValueChange={(v) => set("triggerType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TRIGGERS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Operator</Label>
                <Select value={form.triggerOperator} onValueChange={(v) => set("triggerOperator", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{OPERATORS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Value</Label><Input value={form.triggerValue} onChange={(e) => set("triggerValue", e.target.value)} placeholder="Critical / 24" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Escalate to level</Label><Input type="number" min={1} value={form.escalateToLevel} onChange={(e) => set("escalateToLevel", Number(e.target.value))} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Escalate to role</Label><Input value={form.escalateToRole} onChange={(e) => set("escalateToRole", e.target.value)} placeholder="e.g. Director" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Escalate to specialist</Label>
                <Select value={form.escalateToSpecialistId} onValueChange={(v) => set("escalateToSpecialistId", v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">—</SelectItem>{specialists.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Escalate to department</Label>
                <Select value={form.escalateToDepartmentId} onValueChange={(v) => set("escalateToDepartmentId", v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">—</SelectItem>{departments.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span>Active</span>
              <Switch checked={form.active} onCheckedChange={(v) => set("active", v)} />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!form.name.trim() || !form.triggerValue.trim() || createMut.isPending || updateMut.isPending} className="gap-2">
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
            <AlertDialogDescription>This escalation rule will no longer apply. This cannot be undone.</AlertDialogDescription>
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
