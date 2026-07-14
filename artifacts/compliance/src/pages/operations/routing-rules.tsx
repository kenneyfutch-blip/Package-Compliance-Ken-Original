import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListRoutingRules,
  useListDepartments,
  useListSpecialists,
  useListReviewStages,
  useCreateRoutingRule,
  useUpdateRoutingRule,
  useDeleteRoutingRule,
  usePreviewRouting,
  getListRoutingRulesQueryKey,
} from "@workspace/api-client-react"
import type { RoutingRule, RoutingCondition, RoutingPreviewResult } from "@workspace/api-client-react"
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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Route as RouteIcon, Plus, Loader2, Pencil, Trash2, X, Play, CheckCircle2, XCircle } from "lucide-react"

const OPERATORS = [
  { value: "equals", label: "equals" },
  { value: "notEquals", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "greaterThan", label: ">" },
  { value: "greaterOrEqual", label: "≥" },
  { value: "lessThan", label: "<" },
  { value: "lessOrEqual", label: "≤" },
]
const ACTION_TYPES = [
  { value: "department", label: "Route to department" },
  { value: "specialist", label: "Assign to specialist" },
  { value: "stage", label: "Send to review stage" },
  { value: "escalate", label: "Escalate" },
]

type FormState = {
  name: string
  description: string
  priority: number
  active: boolean
  conditions: RoutingCondition[]
  actionType: string
  actionDepartmentId: string
  actionSpecialistId: string
  actionStageId: string
  actionValue: string
}

const emptyForm: FormState = {
  name: "", description: "", priority: 100, active: true,
  conditions: [{ field: "", operator: "equals", value: "" }],
  actionType: "department", actionDepartmentId: "none", actionSpecialistId: "none",
  actionStageId: "none", actionValue: "",
}

export default function RoutingRulesPage() {
  const queryClient = useQueryClient()
  const { has } = usePermissions()
  const canWrite = has("routing:write")
  const { data: rules = [], isLoading } = useListRoutingRules()
  const { data: departments = [] } = useListDepartments()
  const { data: specialists = [] } = useListSpecialists()
  const { data: stages = [] } = useListReviewStages()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListRoutingRulesQueryKey() })

  const createMut = useCreateRoutingRule({ mutation: { onSuccess: invalidate } })
  const updateMut = useUpdateRoutingRule({ mutation: { onSuccess: invalidate } })
  const deleteMut = useDeleteRoutingRule({ mutation: { onSuccess: invalidate } })
  const previewMut = usePreviewRouting()

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<RoutingRule | null>(null)
  const [deleting, setDeleting] = React.useState<RoutingRule | null>(null)
  const [form, setForm] = React.useState<FormState>(emptyForm)

  const [facts, setFacts] = React.useState<RoutingCondition[]>([{ field: "", operator: "equals", value: "" }])
  const [preview, setPreview] = React.useState<RoutingPreviewResult | null>(null)

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  const openCreate = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true) }
  const openEdit = (r: RoutingRule) => {
    setEditing(r)
    setForm({
      name: r.name,
      description: r.description ?? "",
      priority: r.priority,
      active: r.active,
      conditions: r.conditions.length ? r.conditions : [{ field: "", operator: "equals", value: "" }],
      actionType: r.actionType,
      actionDepartmentId: r.actionDepartmentId ? String(r.actionDepartmentId) : "none",
      actionSpecialistId: r.actionSpecialistId ? String(r.actionSpecialistId) : "none",
      actionStageId: r.actionStageId ? String(r.actionStageId) : "none",
      actionValue: r.actionValue ?? "",
    })
    setDialogOpen(true)
  }

  const updateCond = (i: number, patch: Partial<RoutingCondition>) =>
    set("conditions", form.conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  const addCond = () => set("conditions", [...form.conditions, { field: "", operator: "equals", value: "" }])
  const removeCond = (i: number) => set("conditions", form.conditions.filter((_, idx) => idx !== i))

  const submit = () => {
    const data = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      priority: Number(form.priority),
      active: form.active,
      conditions: form.conditions.filter((c) => c.field.trim()),
      actionType: form.actionType,
      actionDepartmentId: form.actionType === "department" && form.actionDepartmentId !== "none" ? Number(form.actionDepartmentId) : null,
      actionSpecialistId: form.actionType === "specialist" && form.actionSpecialistId !== "none" ? Number(form.actionSpecialistId) : null,
      actionStageId: form.actionType === "stage" && form.actionStageId !== "none" ? Number(form.actionStageId) : null,
      actionValue: form.actionType === "escalate" ? (form.actionValue.trim() || null) : null,
    }
    if (editing) updateMut.mutate({ id: editing.id, data }, { onSuccess: () => setDialogOpen(false) })
    else createMut.mutate({ data }, { onSuccess: () => setDialogOpen(false) })
  }

  const runPreview = () => {
    previewMut.mutate(
      { data: { facts: facts.filter((f) => f.field.trim()).map((f) => ({ field: f.field.trim(), value: f.value.trim() })) } },
      { onSuccess: (res) => setPreview(res) },
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <RouteIcon className="w-7 h-7 text-primary" /> Routing Rules
          </h1>
          <p className="text-muted-foreground mt-1">Deterministic rules that map work attributes to a department, specialist, stage, or escalation. Evaluated in priority order — first match wins.</p>
        </div>
        {canWrite && <Button onClick={openCreate} className="gap-2 shrink-0"><Plus className="w-4 h-4" /> New Rule</Button>}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : rules.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No routing rules yet.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 text-center">Priority</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Conditions</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-center">Active</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-center font-mono text-sm">{r.priority}</TableCell>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 max-w-[280px]">
                        {r.conditions.length === 0
                          ? <span className="text-xs text-muted-foreground">Always</span>
                          : r.conditions.map((c, i) => (
                            <code key={i} className="text-xs bg-muted rounded px-1.5 py-0.5 w-fit">{c.field} {c.operator} {c.value}</code>
                          ))}
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="secondary">{r.actionLabel}</Badge></TableCell>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Play className="w-5 h-5 text-primary" /> Routing preview</CardTitle>
          <CardDescription>Enter facts about a piece of work and see which rule fires. This is the deterministic evaluator a routing agent would call.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {facts.map((f, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input placeholder="field (e.g. category)" value={f.field} onChange={(e) => setFacts((arr) => arr.map((x, idx) => idx === i ? { ...x, field: e.target.value } : x))} />
              <Input placeholder="value (e.g. Food)" value={f.value} onChange={(e) => setFacts((arr) => arr.map((x, idx) => idx === i ? { ...x, value: e.target.value } : x))} />
              <Button variant="ghost" size="icon" onClick={() => setFacts((arr) => arr.filter((_, idx) => idx !== i))} disabled={facts.length === 1}><X className="w-4 h-4" /></Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setFacts((arr) => [...arr, { field: "", operator: "equals", value: "" }])} className="gap-2"><Plus className="w-4 h-4" /> Add fact</Button>
            <Button size="sm" onClick={runPreview} disabled={previewMut.isPending} className="gap-2">
              {previewMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Evaluate
            </Button>
          </div>
          {preview && (
            <div className="rounded-lg border border-border p-3 mt-2 space-y-2">
              {preview.matched
                ? <div className="flex items-center gap-2 text-success font-medium"><CheckCircle2 className="w-4 h-4" /> Matched: {preview.ruleName} → {preview.actionLabel}</div>
                : <div className="flex items-center gap-2 text-muted-foreground font-medium"><XCircle className="w-4 h-4" /> No rule matched — would fall back to manual triage.</div>}
              <div className="space-y-1">
                {preview.trace.map((t) => (
                  <div key={t.ruleId} className="flex items-start gap-2 text-xs">
                    {t.matched ? <CheckCircle2 className="w-3.5 h-3.5 text-success mt-0.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />}
                    <span className="font-medium">{t.ruleName}:</span>
                    <span className="text-muted-foreground">{t.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit routing rule" : "New routing rule"}</DialogTitle>
            <DialogDescription>All conditions must match (AND). Lower priority numbers are evaluated first.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5"><Label className="text-xs">Name</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="High-risk food → Compliance" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Priority</Label><Input type="number" value={form.priority} onChange={(e) => set("priority", Number(e.target.value))} /></div>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Description</Label><Textarea value={form.description} onChange={(e) => set("description", e.target.value)} /></div>

            <div className="space-y-2">
              <Label className="text-xs">Conditions</Label>
              {form.conditions.map((c, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input placeholder="field" value={c.field} onChange={(e) => updateCond(i, { field: e.target.value })} />
                  <Select value={c.operator} onValueChange={(v) => updateCond(i, { operator: v })}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>{OPERATORS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input placeholder="value" value={c.value} onChange={(e) => updateCond(i, { value: e.target.value })} />
                  <Button variant="ghost" size="icon" onClick={() => removeCond(i)} disabled={form.conditions.length === 1}><X className="w-4 h-4" /></Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addCond} className="gap-2"><Plus className="w-4 h-4" /> Add condition</Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Action</Label>
                <Select value={form.actionType} onValueChange={(v) => set("actionType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ACTION_TYPES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Target</Label>
                {form.actionType === "department" && (
                  <Select value={form.actionDepartmentId} onValueChange={(v) => set("actionDepartmentId", v)}>
                    <SelectTrigger><SelectValue placeholder="Choose department" /></SelectTrigger>
                    <SelectContent><SelectItem value="none">—</SelectItem>{departments.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                {form.actionType === "specialist" && (
                  <Select value={form.actionSpecialistId} onValueChange={(v) => set("actionSpecialistId", v)}>
                    <SelectTrigger><SelectValue placeholder="Choose specialist" /></SelectTrigger>
                    <SelectContent><SelectItem value="none">—</SelectItem>{specialists.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                {form.actionType === "stage" && (
                  <Select value={form.actionStageId} onValueChange={(v) => set("actionStageId", v)}>
                    <SelectTrigger><SelectValue placeholder="Choose stage" /></SelectTrigger>
                    <SelectContent><SelectItem value="none">—</SelectItem>{stages.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                {form.actionType === "escalate" && (
                  <Input placeholder="e.g. Director, L3" value={form.actionValue} onChange={(e) => set("actionValue", e.target.value)} />
                )}
              </div>
            </div>

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
            <AlertDialogDescription>This routing rule will no longer be evaluated. This cannot be undone.</AlertDialogDescription>
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
