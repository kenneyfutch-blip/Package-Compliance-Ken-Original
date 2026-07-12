import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useCreatePolicy,
  getListPoliciesQueryKey,
} from "@workspace/api-client-react"
import { useUpload } from "@workspace/object-storage-web"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
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
import { Plus, UploadCloud, Loader2, FileText, X } from "lucide-react"
import { cn } from "@/lib/utils"

export const CATEGORIES = [
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
export const SEVERITIES = ["critical", "major", "minor", "informational"]
export const STATUSES = ["draft", "active", "archived"]

export type Draft = {
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

export const EMPTY_DRAFT: Draft = {
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

export function draftToPayload(d: Draft) {
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

export function PolicyForm({
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

/**
 * Self-contained "New Policy" button + create dialog. Handles the optional
 * document upload and the create mutation, then invalidates the shared policies
 * list so both the admin table and the read-only Policy Repository refresh.
 * Reused by the admin Policy Management page and the Knowledge > Policy
 * Repository page so authoring lives in the same place users browse.
 */
export function PolicyCreateDialog({
  onCreated,
  triggerLabel = "New Policy",
  triggerVariant = "default",
  triggerClassName,
}: {
  onCreated?: () => void
  triggerLabel?: string
  triggerVariant?: "default" | "outline"
  triggerClassName?: string
}) {
  const queryClient = useQueryClient()
  const createPolicy = useCreatePolicy()
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const { uploadFile, isUploading } = useUpload({ onError: (e) => setUploadErr(e.message) })
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [doc, setDoc] = useState<{ name: string; url: string; contentType: string } | null>(null)

  const onPickFile = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setUploadErr(null)
    const res = await uploadFile(file)
    if (res) setDoc({ name: file.name, url: res.objectPath, contentType: file.type || "application/octet-stream" })
    // On failure onError has already set a friendly, retryable message.
  }

  const openCreate = () => {
    setDraft(EMPTY_DRAFT)
    setDoc(null)
    setUploadErr(null)
    setOpen(true)
  }

  const submitCreate = async () => {
    if (!draft.name.trim()) return
    await createPolicy.mutateAsync({
      data: {
        ...draftToPayload(draft),
        ...(doc ? { documentUrl: doc.url, fileName: doc.name, contentType: doc.contentType } : {}),
      },
    })
    // Prefix-match invalidation refreshes every parameterized policies query.
    queryClient.invalidateQueries({ queryKey: getListPoliciesQueryKey() })
    setOpen(false)
    onCreated?.()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} className={cn("gap-2", triggerClassName)} onClick={openCreate}>
          <Plus className="w-4 h-4" /> {triggerLabel}
        </Button>
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
          {uploadErr && <p className="mt-2 text-xs text-destructive">{uploadErr}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submitCreate} disabled={!draft.name.trim() || createPolicy.isPending}>
            {createPolicy.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating…</> : "Create policy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
