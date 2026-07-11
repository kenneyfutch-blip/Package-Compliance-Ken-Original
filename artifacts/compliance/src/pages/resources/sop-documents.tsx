import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useSearch } from "wouter"
import {
  useListSopDocuments,
  useCreateSopDocument,
  useListSopDocumentVersions,
  useCreateSopDocumentVersion,
  useCompareSopDocumentVersions,
  getListSopDocumentsQueryKey,
  getListSopDocumentVersionsQueryKey,
  getCompareSopDocumentVersionsQueryKey,
  getGetResourceOverviewQueryKey,
  type SopDocument,
  type SopDocumentVersion,
} from "@workspace/api-client-react"
import { useUpload } from "@workspace/object-storage-web"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  FileText,
  ArrowLeft,
  Upload,
  History,
  GitCompare,
  Loader2,
  Search,
  Download,
  Plus,
  CalendarClock,
  UserCircle,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react"
import { usePermissions } from "@/lib/access"
import { useToast } from "@/hooks/use-toast"
import { relativeTime } from "@/lib/proof-utils"
import { cn } from "@/lib/utils"

const ACCEPT = ".pdf,.txt,.csv,.doc,.docx,.ppt,.pptx"

function fileVersionUrl(docId: number, versionId: number): string {
  return `/api/sop-documents/${docId}/versions/${versionId}/file`
}

// Human-readable label for the extraction status shown on a document.
function extractionMeta(status: string): { label: string; tone: string } {
  switch (status) {
    case "Complete":
      return { label: "Text indexed", tone: "bg-success/10 text-success" }
    case "Pending":
    case "Processing":
      return { label: "Indexing…", tone: "bg-primary/10 text-primary" }
    case "NotConfigured":
      return { label: "Text extraction unavailable", tone: "bg-muted text-muted-foreground" }
    case "Unsupported":
      return { label: "Not text-searchable", tone: "bg-muted text-muted-foreground" }
    case "Failed":
      return { label: "Indexing failed", tone: "bg-destructive/10 text-destructive" }
    default:
      return { label: status, tone: "bg-muted text-muted-foreground" }
  }
}

// -------------------------------------------------------------------------
// Upload form (shared by "New SOP" and "New version")
// -------------------------------------------------------------------------
interface UploadedFile {
  name: string
  url: string
  contentType: string
}

function FilePicker({
  file,
  onPicked,
  onClear,
}: {
  file: UploadedFile | null
  onPicked: (f: UploadedFile) => void
  onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const { uploadFile, isUploading } = useUpload({
    // Surface the hook's specific, friendly reason (e.g. "file too large") — not a generic message.
    onError: (e) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  })

  const handle = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    const res = await uploadFile(f)
    if (!res) return // onError already toasted a friendly message
    onPicked({
      name: f.name,
      url: res.objectPath,
      contentType: f.type || "application/octet-stream",
    })
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => handle(e.target.files)}
      />
      {file ? (
        <div className="flex items-center gap-3 rounded-md border border-border bg-accent/40 p-3">
          <FileText className="h-5 w-5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{file.name}</span>
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Change
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
        >
          {isUploading ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</>
          ) : (
            <><Upload className="mr-2 h-4 w-4" /> Choose file (PDF, Word, PowerPoint, text)</>
          )}
        </Button>
      )}
    </div>
  )
}

function CreateSopDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const create = useCreateSopDocument()
  const [title, setTitle] = useState("")
  const [category, setCategory] = useState("")
  const [owner, setOwner] = useState("")
  const [effectiveDate, setEffectiveDate] = useState("")
  const [file, setFile] = useState<UploadedFile | null>(null)

  const reset = () => {
    setTitle(""); setCategory(""); setOwner(""); setEffectiveDate(""); setFile(null)
  }

  const canSubmit = title.trim() && category.trim() && file && !create.isPending

  const submit = () => {
    if (!canSubmit || !file) return
    create.mutate(
      {
        data: {
          title: title.trim(),
          category: category.trim(),
          owner: owner.trim() || null,
          effectiveDate: effectiveDate || null,
          documentUrl: file.url,
          fileName: file.name,
          contentType: file.contentType,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "SOP document created" })
          qc.invalidateQueries({ queryKey: getListSopDocumentsQueryKey() })
          qc.invalidateQueries({ queryKey: getGetResourceOverviewQueryKey() })
          reset()
          onOpenChange(false)
        },
        onError: () =>
          toast({ title: "Could not create SOP document", variant: "destructive" }),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New SOP document</DialogTitle>
          <DialogDescription>
            Upload the first version of a standard operating procedure. You can add revisions later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sop-title">Title</Label>
            <Input id="sop-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Allergen Labeling SOP" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sop-category">Category / Owner area</Label>
              <Input id="sop-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Labeling" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sop-owner">Owner</Label>
              <Input id="sop-owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. QA Team" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sop-eff">Effective date</Label>
            <Input id="sop-eff" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Document</Label>
            <FilePicker file={file} onPicked={setFile} onClear={() => setFile(null)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {create.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…</> : "Create SOP"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// -------------------------------------------------------------------------
// Version comparison
// -------------------------------------------------------------------------
function CompareView({
  docId,
  versions,
}: {
  docId: number
  versions: SopDocumentVersion[]
}) {
  const sorted = useMemo(
    () => [...versions].sort((a, b) => b.version - a.version),
    [versions],
  )
  const [aId, setAId] = useState<number | null>(null)
  const [bId, setBId] = useState<number | null>(null)

  // Default to the two most recent versions.
  useEffect(() => {
    if (sorted.length >= 2) {
      setBId((prev) => prev ?? sorted[0]!.id)
      setAId((prev) => prev ?? sorted[1]!.id)
    }
  }, [sorted])

  const enabled = aId != null && bId != null && aId !== bId
  const { data, isLoading } = useCompareSopDocumentVersions(
    docId,
    aId ?? 0,
    bId ?? 0,
    {
      query: {
        enabled,
        queryKey: getCompareSopDocumentVersionsQueryKey(docId, aId ?? 0, bId ?? 0),
      },
    },
  )

  if (versions.length < 2) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        Upload at least two versions to compare them.
      </div>
    )
  }

  const rowTone = (type: string, side: "left" | "right") => {
    if (type === "unchanged") return ""
    if (type === "changed") return "bg-amber-500/10"
    if (type === "removed" && side === "left") return "bg-destructive/10 text-destructive"
    if (type === "added" && side === "right") return "bg-success/10 text-success"
    return "bg-muted/40"
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Older</Label>
          <Select value={aId != null ? String(aId) : undefined} onValueChange={(v) => setAId(Number(v))}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Select version" /></SelectTrigger>
            <SelectContent>
              {sorted.map((v) => (
                <SelectItem key={v.id} value={String(v.id)}>Version {v.version}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <GitCompare className="mb-2 h-4 w-4 text-muted-foreground" />
        <div className="space-y-1">
          <Label className="text-xs">Newer</Label>
          <Select value={bId != null ? String(bId) : undefined} onValueChange={(v) => setBId(Number(v))}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Select version" /></SelectTrigger>
            <SelectContent>
              {sorted.map((v) => (
                <SelectItem key={v.id} value={String(v.id)}>Version {v.version}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {aId === bId && (
        <p className="text-sm text-muted-foreground">Select two different versions to see the differences.</p>
      )}

      {enabled && isLoading && (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Comparing…
        </div>
      )}

      {enabled && data && (
        <>
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-success">+ {data.summary.added} added</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">− {data.summary.removed} removed</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-600 dark:text-amber-400">~ {data.summary.changed} changed</span>
          </div>
          {data.rows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
              No extractable text to compare between these versions.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <div className="grid grid-cols-2 border-b bg-muted/50 text-xs font-semibold">
                <div className="border-r px-3 py-2">Version {data.older.version}</div>
                <div className="px-3 py-2">Version {data.newer.version}</div>
              </div>
              <div className="max-h-[55vh] overflow-y-auto font-mono text-xs">
                {data.rows.map((row, i) => (
                  <div key={i} className="grid grid-cols-2 border-b last:border-b-0">
                    <div className={cn("whitespace-pre-wrap break-words border-r px-3 py-1", rowTone(row.type, "left"))}>
                      {row.left ?? ""}
                    </div>
                    <div className={cn("whitespace-pre-wrap break-words px-3 py-1", rowTone(row.type, "right"))}>
                      {row.right ?? ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// -------------------------------------------------------------------------
// Document detail (version history + compare + new version)
// -------------------------------------------------------------------------
function AddVersionForm({ docId }: { docId: number }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const createVersion = useCreateSopDocumentVersion()
  const [file, setFile] = useState<UploadedFile | null>(null)
  const [changeNote, setChangeNote] = useState("")
  const [effectiveDate, setEffectiveDate] = useState("")

  const submit = () => {
    if (!file || createVersion.isPending) return
    createVersion.mutate(
      {
        id: docId,
        data: {
          documentUrl: file.url,
          fileName: file.name,
          contentType: file.contentType,
          effectiveDate: effectiveDate || null,
          changeNote: changeNote.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "New version uploaded" })
          qc.invalidateQueries({ queryKey: getListSopDocumentVersionsQueryKey(docId) })
          qc.invalidateQueries({ queryKey: getListSopDocumentsQueryKey() })
          setFile(null); setChangeNote(""); setEffectiveDate("")
        },
        onError: () => toast({ title: "Could not upload version", variant: "destructive" }),
      },
    )
  }

  return (
    <div className="space-y-3 rounded-lg border bg-accent/30 p-4">
      <p className="flex items-center gap-2 text-sm font-medium"><Plus className="h-4 w-4" /> Upload a new version</p>
      <FilePicker file={file} onPicked={setFile} onClear={() => setFile(null)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs" htmlFor="ver-eff">Effective date</Label>
          <Input id="ver-eff" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs" htmlFor="ver-note">Change note</Label>
        <Textarea id="ver-note" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="What changed in this revision?" rows={2} />
      </div>
      <Button size="sm" onClick={submit} disabled={!file || createVersion.isPending}>
        {createVersion.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</> : "Save new version"}
      </Button>
    </div>
  )
}

function DocumentDetail({ doc, canWrite }: { doc: SopDocument; canWrite: boolean }) {
  const { data: versions = [], isLoading } = useListSopDocumentVersions(doc.id, {
    query: { queryKey: getListSopDocumentVersionsQueryKey(doc.id) },
  })

  return (
    <Tabs defaultValue="history" className="w-full">
      <TabsList>
        <TabsTrigger value="history"><History className="mr-1.5 h-4 w-4" /> Version history</TabsTrigger>
        <TabsTrigger value="compare"><GitCompare className="mr-1.5 h-4 w-4" /> Compare</TabsTrigger>
      </TabsList>

      <TabsContent value="history" className="space-y-4 pt-4">
        {canWrite && <AddVersionForm docId={doc.id} />}
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading versions…
          </div>
        ) : (
          <ul className="space-y-2">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                <Badge variant="outline" className="shrink-0">v{v.version}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{v.fileName ?? "Document"}</p>
                  <p className="text-xs text-muted-foreground">
                    {v.createdBy ? `${v.createdBy} · ` : ""}{relativeTime(v.createdAt)}
                    {v.effectiveDate ? ` · effective ${v.effectiveDate}` : ""}
                  </p>
                  {v.changeNote && <p className="mt-0.5 text-xs text-foreground/70">{v.changeNote}</p>}
                </div>
                {v.documentUrl && (
                  <div className="flex shrink-0 gap-2">
                    <a href={fileVersionUrl(doc.id, v.id)} target="_blank" rel="noreferrer">
                      <Button variant="ghost" size="sm"><FileText className="mr-1 h-4 w-4" /> Open</Button>
                    </a>
                    <a href={fileVersionUrl(doc.id, v.id)} download>
                      <Button variant="ghost" size="sm"><Download className="mr-1 h-4 w-4" /> Download</Button>
                    </a>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </TabsContent>

      <TabsContent value="compare" className="pt-4">
        <CompareView docId={doc.id} versions={versions} />
      </TabsContent>
    </Tabs>
  )
}

// -------------------------------------------------------------------------
// Document card + list
// -------------------------------------------------------------------------
function SopCard({ doc, onOpen, highlight }: { doc: SopDocument; onOpen: () => void; highlight?: boolean }) {
  const ext = extractionMeta(doc.extractionStatus)
  return (
    <Card
      id={`sop-${doc.id}`}
      onClick={onOpen}
      className={cn("hover-elevate cursor-pointer transition-all", highlight && "ring-2 ring-primary ring-offset-2 ring-offset-background")}
    >
      <CardHeader className="py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-primary/10 text-primary hover:bg-primary/20">{doc.category}</Badge>
              <Badge variant="outline">v{doc.currentVersion}</Badge>
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", ext.tone)}>{ext.label}</span>
              {doc.status !== "active" && <Badge variant="secondary" className="capitalize">{doc.status}</Badge>}
            </div>
            <CardTitle className="mt-1 truncate text-lg leading-tight">{doc.title}</CardTitle>
          </div>
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="py-0 pb-4">
        <div className="flex flex-wrap gap-4 rounded-md bg-accent/50 p-3 text-xs text-muted-foreground">
          {doc.owner && <span className="flex items-center gap-1"><UserCircle className="h-3 w-3" /> {doc.owner}</span>}
          {doc.effectiveDate && <span className="flex items-center gap-1"><CalendarClock className="h-3 w-3" /> Effective {doc.effectiveDate}</span>}
          <span className="flex items-center gap-1"><History className="h-3 w-3" /> Updated {relativeTime(doc.updatedAt)}</span>
        </div>
      </CardContent>
    </Card>
  )
}

export default function SopDocuments() {
  const { has } = usePermissions()
  const canWrite = has("policies:write")
  const [query, setQuery] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [openDoc, setOpenDoc] = useState<SopDocument | null>(null)

  // Debounce the search term to avoid a request per keystroke.
  const [term, setTerm] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  // Deep link support: /resources/sop?doc=<id> highlights the document.
  const queryString = useSearch()
  const deepLinkId = new URLSearchParams(queryString).get("doc")

  const listParams = term ? { search: term } : {}
  const { data: docs = [], isLoading } = useListSopDocuments(listParams, {
    query: { queryKey: getListSopDocumentsQueryKey(listParams) },
  })

  useEffect(() => {
    if (!deepLinkId || isLoading) return
    const el = document.getElementById(`sop-${deepLinkId}`)
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [deepLinkId, isLoading, docs])

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Link href="/resources" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" /> Resource Center
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <FileText className="h-7 w-7 text-primary" />
            SOP Documents
          </h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            A managed library of standard operating procedure documents with uploads, version
            history and side-by-side comparison.
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New SOP document
          </Button>
        )}
      </div>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search SOP documents by title, owner, or content…"
          className="h-12 bg-card pl-10 text-base"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-6 w-6 animate-spin" /> Loading SOP documents…
        </div>
      ) : docs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <FileText className="h-7 w-7" />
            </div>
            <div>
              <p className="text-lg font-semibold">
                {term ? "No SOP documents matched your search" : "No SOP documents yet"}
              </p>
              <p className="mx-auto mt-1 max-w-md text-muted-foreground">
                {term
                  ? "Try a different search term."
                  : canWrite
                    ? "Upload your first standard operating procedure to start tracking revisions."
                    : "SOP documents uploaded by your team will appear here."}
              </p>
            </div>
            {!term && canWrite && (
              <Button onClick={() => setCreateOpen(true)} className="mt-2">
                <Plus className="mr-2 h-4 w-4" /> New SOP document
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {docs.map((doc) => (
            <SopCard
              key={doc.id}
              doc={doc}
              onOpen={() => setOpenDoc(doc)}
              highlight={deepLinkId === String(doc.id)}
            />
          ))}
        </div>
      )}

      <CreateSopDialog open={createOpen} onOpenChange={setCreateOpen} />

      <Dialog open={!!openDoc} onOpenChange={(v) => { if (!v) setOpenDoc(null) }}>
        <DialogContent className="max-w-3xl">
          {openDoc && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" /> {openDoc.title}
                </DialogTitle>
                <DialogDescription>
                  {openDoc.category}{openDoc.owner ? ` · ${openDoc.owner}` : ""} · Current version v{openDoc.currentVersion}
                </DialogDescription>
              </DialogHeader>
              <DocumentDetail doc={openDoc} canWrite={canWrite} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
