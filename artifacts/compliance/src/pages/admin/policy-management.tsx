import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListPolicies,
  useCreatePolicy,
  useUpdatePolicy,
  useReprocessPolicy,
  useListPolicyVersions,
  useCreatePolicyVersion,
  getListPoliciesQueryKey,
  getListPolicyVersionsQueryKey,
  type Policy,
} from "@workspace/api-client-react"
import { useUpload } from "@workspace/object-storage-web"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Plus,
  Search,
  UploadCloud,
  Loader2,
  FileText,
  History,
  RefreshCw,
  Archive,
  ShieldCheck,
  X,
} from "lucide-react"

const CATEGORIES = [
  "Packaging",
  "Brand",
  "Supplier",
  "Legal",
  "Artwork",
  "Marketing",
  "Safety",
  "Labeling",
  "Uncategorized",
]
const SEVERITIES = ["critical", "major", "minor", "informational"]
const STATUSES = ["draft", "active", "archived"]

type Draft = {
  name: string
  category: string
  policyType: string
  department: string
  owner: string
  source: string
  summary: string
  status: string
  defaultSeverity: string
  tags: string
  effectiveDate: string
  expirationDate: string
}

const EMPTY_DRAFT: Draft = {
  name: "",
  category: "Packaging",
  policyType: "",
  department: "",
  owner: "",
  source: "",
  summary: "",
  status: "active",
  defaultSeverity: "major",
  tags: "",
  effectiveDate: "",
  expirationDate: "",
}

function statusVariant(status: string): string {
  if (status === "active") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
  if (status === "draft") return "bg-amber-500/10 text-amber-600 dark:text-amber-400"
  return "bg-muted text-muted-foreground"
}

function draftToPayload(d: Draft) {
  const trimmedTags = d.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
  return {
    name: d.name.trim(),
    category: d.category,
    policyType: d.policyType.trim() || null,
    department: d.department.trim() || null,
    owner: d.owner.trim() || null,
    source: d.source.trim() || null,
    summary: d.summary.trim() || null,
    status: d.status,
    defaultSeverity: d.defaultSeverity,
    tags: trimmedTags.length ? trimmedTags : null,
    effectiveDate: d.effectiveDate.trim() || null,
    expirationDate: d.expirationDate.trim() || null,
  }
}

function PolicyForm({
  draft,
  setDraft,
}: {
  draft: Draft
  setDraft: (d: Draft) => void
}) {
  const set = (k: keyof Draft) => (v: string) => setDraft({ ...draft, [k]: v })
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <Label>Policy name <span className="text-destructive">*</span></Label>
        <Input value={draft.name} onChange={(e) => set("name")(e.target.value)} placeholder="e.g. Private Label Packaging Standard" />
      </div>
      <div className="space-y-2">
        <Label>Category</Label>
        <Select value={draft.category} onValueChange={set("category")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Policy type</Label>
        <Input value={draft.policyType} onChange={(e) => set("policyType")(e.target.value)} placeholder="e.g. Brand Guideline" />
      </div>
      <div className="space-y-2">
        <Label>Status</Label>
        <Select value={draft.status} onValueChange={set("status")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Default severity</Label>
        <Select value={draft.defaultSeverity} onValueChange={set("defaultSeverity")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Owner</Label>
        <Input value={draft.owner} onChange={(e) => set("owner")(e.target.value)} placeholder="Responsible person/team" />
      </div>
      <div className="space-y-2">
        <Label>Department</Label>
        <Input value={draft.department} onChange={(e) => set("department")(e.target.value)} placeholder="e.g. Compliance" />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label>Source / authority label</Label>
        <Input value={draft.source} onChange={(e) => set("source")(e.target.value)} placeholder="Cited on generated findings, e.g. Dollar Tree Packaging Standard" />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label>Rule statement <span className="text-muted-foreground text-xs">(what the AI enforces)</span></Label>
        <Textarea
          value={draft.summary}
          onChange={(e) => set("summary")(e.target.value)}
          className="min-h-[120px]"
          placeholder="State the standard precisely, e.g. 'All private-label packaging must display the $1.25 price legend on the principal display panel.'"
        />
      </div>
      <div className="space-y-2">
        <Label>Effective date</Label>
        <Input type="date" value={draft.effectiveDate} onChange={(e) => set("effectiveDate")(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Expiration date</Label>
        <Input type="date" value={draft.expirationDate} onChange={(e) => set("expirationDate")(e.target.value)} />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label>Tags <span className="text-muted-foreground text-xs">(comma separated)</span></Label>
        <Input value={draft.tags} onChange={(e) => set("tags")(e.target.value)} placeholder="pricing, brand, private-label" />
      </div>
    </div>
  )
}

function VersionHistory({ policyId }: { policyId: number }) {
  const { data: versions = [], isLoading } = useListPolicyVersions(policyId)
  if (isLoading) return <div className="py-6 text-center text-muted-foreground text-sm">Loading history…</div>
  if (versions.length === 0) return <div className="py-6 text-center text-muted-foreground text-sm">No prior versions. Publishing a new version snapshots the current state here.</div>
  return (
    <div className="space-y-3 max-h-[50vh] overflow-y-auto">
      {versions.map((v) => (
        <div key={v.id} className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <Badge variant="outline">v{v.version}</Badge>
            <span className="text-xs text-muted-foreground">{v.createdAt ? new Date(v.createdAt).toLocaleString() : ""}</span>
          </div>
          <p className="mt-2 text-sm font-medium">{v.name}</p>
          {v.summary && <p className="mt-1 text-sm text-muted-foreground line-clamp-3">{v.summary}</p>}
          {v.changeNote && <p className="mt-2 text-xs text-foreground/70"><span className="font-medium">Change:</span> {v.changeNote}</p>}
          {v.createdBy && <p className="mt-1 text-xs text-muted-foreground">by {v.createdBy}</p>}
        </div>
      ))}
    </div>
  )
}

export default function PolicyManagement() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const listParams = {
    search: search.trim() || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
  }
  const { data: policies = [], isLoading } = useListPolicies(listParams)

  const createPolicy = useCreatePolicy()
  const updatePolicy = useUpdatePolicy()
  const reprocessPolicy = useReprocessPolicy()
  const createVersion = useCreatePolicyVersion()
  const { uploadFile, isUploading } = useUpload()

  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [versionOpen, setVersionOpen] = useState(false)
  const [historyFor, setHistoryFor] = useState<Policy | null>(null)
  const [editing, setEditing] = useState<Policy | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [doc, setDoc] = useState<{ name: string; url: string; contentType: string } | null>(null)
  const [changeNote, setChangeNote] = useState("")

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListPoliciesQueryKey() })

  const onPickFile = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    const res = await uploadFile(file)
    if (res) setDoc({ name: file.name, url: res.objectPath, contentType: file.type || "application/octet-stream" })
  }

  const openCreate = () => {
    setDraft(EMPTY_DRAFT)
    setDoc(null)
    setCreateOpen(true)
  }

  const submitCreate = async () => {
    if (!draft.name.trim()) return
    await createPolicy.mutateAsync({
      data: {
        ...draftToPayload(draft),
        ...(doc ? { documentUrl: doc.url, fileName: doc.name, contentType: doc.contentType } : {}),
      },
    })
    invalidate()
    setCreateOpen(false)
  }

  const openEdit = (p: Policy) => {
    setEditing(p)
    setDraft({
      name: p.name,
      category: p.category,
      policyType: p.policyType ?? "",
      department: p.department ?? "",
      owner: p.owner ?? "",
      source: p.source ?? "",
      summary: p.summary ?? "",
      status: p.status,
      defaultSeverity: p.defaultSeverity,
      tags: (p.tags ?? []).join(", "),
      effectiveDate: p.effectiveDate ?? "",
      expirationDate: p.expirationDate ?? "",
    })
    setEditOpen(true)
  }

  const submitEdit = async () => {
    if (!editing) return
    await updatePolicy.mutateAsync({ id: editing.id, data: draftToPayload(draft) })
    invalidate()
    setEditOpen(false)
    setEditing(null)
  }

  const archive = async (p: Policy) => {
    await updatePolicy.mutateAsync({ id: p.id, data: { status: p.status === "archived" ? "active" : "archived" } })
    invalidate()
  }

  const reprocess = async (p: Policy) => {
    await reprocessPolicy.mutateAsync({ id: p.id })
    invalidate()
  }

  const openHistory = (p: Policy) => {
    setHistoryFor(p)
    setVersionOpen(true)
    setChangeNote("")
  }

  const publishVersion = async () => {
    if (!historyFor) return
    await createVersion.mutateAsync({ id: historyFor.id, data: { changeNote: changeNote.trim() || null } })
    invalidate()
    queryClient.invalidateQueries({ queryKey: getListPolicyVersionsQueryKey(historyFor.id) })
    setChangeNote("")
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-primary" />
            Internal Policy &amp; Standards
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Company-specific standards that participate in every package review with equal authority to FDA, EPA, and eCFR regulations. New or updated policies influence future reviews immediately.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" onClick={openCreate}><Plus className="w-4 h-4" /> New Policy</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create policy</DialogTitle>
              <DialogDescription>Define the standard. The rule statement is what the AI enforces; an optional document is extracted for search and context.</DialogDescription>
            </DialogHeader>
            <PolicyForm draft={draft} setDraft={setDraft} />
            <div className="mt-2">
              <Label className="mb-2 block">Policy document <span className="text-muted-foreground text-xs">(optional — PDF, image, or text)</span></Label>
              {doc ? (
                <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                  <span className="text-sm truncate flex-1">{doc.name}</span>
                  <Button type="button" variant="ghost" size="icon" onClick={() => setDoc(null)}><X className="w-4 h-4" /></Button>
                </div>
              ) : (
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-4 text-sm text-muted-foreground hover:bg-accent/40">
                  {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                  {isUploading ? "Uploading…" : "Upload document"}
                  <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.txt,.csv" onChange={(e) => onPickFile(e.target.files)} />
                </label>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={submitCreate} disabled={!draft.name.trim() || createPolicy.isPending}>
                {createPolicy.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating…</> : "Create policy"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search policies by name, rule, or source…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-base">Policies</CardTitle>
          <CardDescription>{policies.length} {policies.length === 1 ? "policy" : "policies"}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading policies…</div>
          ) : policies.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              No policies yet. Create your first internal standard to have it enforced in reviews.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-medium">{p.name}</div>
                      {p.source && <div className="text-xs text-muted-foreground">{p.source}</div>}
                    </TableCell>
                    <TableCell><Badge variant="outline">{p.category}</Badge></TableCell>
                    <TableCell className="capitalize">{p.defaultSeverity}</TableCell>
                    <TableCell><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusVariant(p.status)}`}>{p.status}</span></TableCell>
                    <TableCell>v{p.version}</TableCell>
                    <TableCell>
                      {p.fileName ? (
                        <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><FileText className="w-3 h-3" /> {p.extractionStatus}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Rule only</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>Edit</Button>
                        <Button variant="ghost" size="icon" title="Version history" onClick={() => openHistory(p)}><History className="w-4 h-4" /></Button>
                        {p.fileName && (
                          <Button variant="ghost" size="icon" title="Reprocess document" onClick={() => reprocess(p)} disabled={reprocessPolicy.isPending}>
                            <RefreshCw className={`w-4 h-4 ${reprocessPolicy.isPending ? "animate-spin" : ""}`} />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" title={p.status === "archived" ? "Restore" : "Archive"} onClick={() => archive(p)}>
                          <Archive className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit policy</DialogTitle>
            <DialogDescription>Changes take effect on future reviews immediately. Publish a version first if you need to preserve the current wording.</DialogDescription>
          </DialogHeader>
          <PolicyForm draft={draft} setDraft={setDraft} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={submitEdit} disabled={!draft.name.trim() || updatePolicy.isPending}>
              {updatePolicy.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version history dialog */}
      <Dialog open={versionOpen} onOpenChange={setVersionOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Version history{historyFor ? ` — ${historyFor.name}` : ""}</DialogTitle>
            <DialogDescription>Publishing a new version snapshots the current policy state immutably, then increments its version.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change note</Label>
            <Textarea value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="What changed and why" className="min-h-[70px]" />
            <Button onClick={publishVersion} disabled={createVersion.isPending} className="w-full">
              {createVersion.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Publishing…</> : "Publish new version"}
            </Button>
          </div>
          <div className="mt-2 border-t border-border pt-4">
            {historyFor && <VersionHistory policyId={historyFor.id} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
