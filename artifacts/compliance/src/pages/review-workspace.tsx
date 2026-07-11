import * as React from "react"
import { useParams, Link } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import {
  useGetPackage, getGetPackageQueryKey, useAnalyzePackage,
  useCreateAnnotation, useUpdateAnnotation, useDeleteAnnotation, useAddCommentReply,
  useCreateReviewTask, useUpdateReviewTask, useCreateApprovalDecision,
  useAskCopilot, useExportProof, useComparePackageVersions, getComparePackageVersionsQueryKey,
  useGetLanguageReview, useRunLanguageReview, getGetLanguageReviewQueryKey,
  useCreatePackageVersion, useExtractArtworkText,
  type PackageDetail, type Annotation as ApiAnnotation, type Violation as ApiViolation,
  type ReviewTask as ApiReviewTask, type Citation,
} from "@workspace/api-client-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ArrowLeft, BrainCircuit, CheckCircle, Loader2, Send, ShieldCheck, ShieldAlert,
  MessageSquarePlus, Trash2, CheckCheck, CornerDownRight, ClipboardList, Plus,
  FileDown, GitCompareArrows, Sparkles, ChevronDown, XCircle, AlertOctagon, ScrollText,
  Gavel, Bot, User as UserIcon, FilePlus,
} from "lucide-react"
import { useUpload } from "@workspace/object-storage-web"
import { ProofViewer, type ViewerAnnotation, type AnnotationDraft } from "@/components/proof-viewer"
import { RegulationRef } from "@/components/regulation-ref"
import { FdaIntelligenceTab } from "@/components/fda-intelligence-tab"
import { EcfrRegulationsTab } from "@/components/ecfr-regulations-tab"
import {
  type MarkupTool, findingClassMeta, priorityMeta, REVIEWERS,
  extractMentions, relativeTime, HUMAN_MARKUP_COLOR, fileTypeFromName,
} from "@/lib/proof-utils"
import { cn } from "@/lib/utils"
import { hasDistinctFix } from "@/lib/compliance"
import { LanguageReviewTab } from "@/components/language-review-tab"
import { DocumentAiTab } from "@/components/document-ai-tab"

const OCR_MAX_DIM = 1600

// Downscale an image file to a JPEG data URL for OCR (keeps payload small).
function fileToDownscaledDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Could not read file"))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error("Could not load image"))
      img.onload = () => {
        const scale = Math.min(1, OCR_MAX_DIM / Math.max(img.width, img.height))
        const canvas = document.createElement("canvas")
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext("2d")
        if (!ctx) { reject(new Error("Canvas not supported")); return }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL("image/jpeg", 0.85))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

type Pkg = PackageDetail
type Annotation = ApiAnnotation
type Violation = ApiViolation
type Task = ApiReviewTask

export default function ReviewWorkspace() {
  const { id } = useParams()
  const packageId = Number(id)
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: getGetPackageQueryKey(packageId) })

  const { data: pkg, isLoading } = useGetPackage(packageId, {
    query: { enabled: !!packageId, queryKey: getGetPackageQueryKey(packageId) },
  })

  const analyze = useAnalyzePackage()
  const createAnnotation = useCreateAnnotation()
  const exportProof = useExportProof()
  const runLanguage = useRunLanguageReview()
  const { data: languageReview } = useGetLanguageReview(packageId, {
    query: { enabled: !!packageId, queryKey: getGetLanguageReviewQueryKey(packageId) },
  })
  const handleRunLanguage = () => {
    runLanguage.mutate({ id: packageId }, {
      onSuccess: (data) => {
        qc.setQueryData(getGetLanguageReviewQueryKey(packageId), data)
        invalidate()
      },
    })
  }

  const [tool, setTool] = React.useState<MarkupTool>("hand")
  const [selectedId, setSelectedId] = React.useState<number | null>(null)
  const [showAi, setShowAi] = React.useState(true)
  const [showHuman, setShowHuman] = React.useState(true)
  const [activeVersionId, setActiveVersionId] = React.useState<number | null>(null)
  const [pendingPin, setPendingPin] = React.useState<AnnotationDraft | null>(null)
  const [pinText, setPinText] = React.useState("")
  const [pinPriority, setPinPriority] = React.useState("medium")

  React.useEffect(() => {
    if (pkg && activeVersionId == null) {
      setActiveVersionId(pkg.currentVersionId ?? pkg.versions[0]?.id ?? null)
    }
  }, [pkg, activeVersionId])

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-8rem)] items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    )
  }
  if (!pkg) return <div className="p-8">Package not found.</div>

  const activeVersion = pkg.versions.find((v) => v.id === activeVersionId) ?? pkg.versions[0]

  // Number all annotations for stable marker labels.
  const numbered = new Map<number, number>()
  pkg.annotations.forEach((a, i) => numbered.set(a.id, i + 1))

  const viewerAnnotations: ViewerAnnotation[] = pkg.annotations
    .filter((a) => a.versionId == null || a.versionId === activeVersion?.id)
    .map((a) => ({
      id: a.id, type: a.type, page: a.page, x: a.x, y: a.y, w: a.w, h: a.h,
      color: a.color, source: a.source, status: a.status, text: a.text,
      findingClass: findingClassForAnnotation(a, pkg.violations),
      index: numbered.get(a.id) ?? 0,
    }))

  const handleCreate = (draft: AnnotationDraft) => {
    if (draft.type === "pin" || draft.type === "text") {
      setPendingPin(draft)
      setPinText("")
      setPinPriority("medium")
      return
    }
    createAnnotation.mutate(
      {
        id: packageId,
        data: {
          type: draft.type, versionId: activeVersion?.id, page: draft.page,
          x: draft.x, y: draft.y, w: draft.w ?? undefined, h: draft.h ?? undefined,
          color: HUMAN_MARKUP_COLOR,
          priority: "medium",
        },
      },
      { onSuccess: () => { invalidate(); setTool("hand") } },
    )
  }

  const savePin = () => {
    if (!pendingPin) return
    createAnnotation.mutate(
      {
        id: packageId,
        data: {
          type: pendingPin.type, versionId: activeVersion?.id, page: pendingPin.page,
          x: pendingPin.x, y: pendingPin.y,
          color: HUMAN_MARKUP_COLOR,
          text: pinText, priority: pinPriority, mentions: extractMentions(pinText),
        },
      },
      { onSuccess: () => { invalidate(); setPendingPin(null); setPinText(""); setTool("hand") } },
    )
  }

  const sc = pkg.scorecard
  const decided = pkg.approvalStatus !== "Pending"
  // Once a reviewer records a decision, that decision supersedes the raw AI
  // readiness estimate so the two indicators can't contradict each other.
  const readinessLabel = decided ? pkg.approvalStatus : sc.readiness
  const readinessTone = decided
    ? approvalStatusTone(pkg.approvalStatus)
    : sc.readinessScore >= 85 ? "text-success" : sc.readinessScore >= 50 ? "text-warning" : "text-destructive"

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border shrink-0 gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/reviews"><Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button></Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold truncate">{pkg.name}</h1>
              <ApprovalBadge status={pkg.approvalStatus} />
            </div>
            <p className="text-xs text-muted-foreground font-mono truncate">{pkg.sku} • {pkg.vendor}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pkg.versions.length > 0 && (
            <Select value={String(activeVersion?.id ?? "")} onValueChange={(v) => setActiveVersionId(Number(v))}>
              <SelectTrigger className="w-[190px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {pkg.versions.map((v) => (
                  <SelectItem key={v.id} value={String(v.id)}>
                    {v.label ?? `Version ${v.versionNumber}`}{v.isCurrent ? " (current)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <AddVersionButton packageId={packageId} onAdded={(vid) => { setActiveVersionId(vid); invalidate() }} />
          <Button variant="outline" className="gap-2 h-9" disabled={exportProof.isPending}
            onClick={() => exportProof.mutate({ id: packageId }, {
              onSuccess: (r) => { if (r?.url) window.open(r.url, "_blank") },
            })}>
            {exportProof.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            Export Proof
          </Button>
          <Button variant="default" className="gap-2 h-9" disabled={analyze.isPending}
            onClick={() => analyze.mutate({ id: packageId }, { onSuccess: invalidate })}>
            {analyze.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BrainCircuit className="w-4 h-4" />}
            Re-run AI
          </Button>
        </div>
      </div>

      {/* Scorecard strip */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 py-3 shrink-0">
        <ScoreTile label="Grade" value={pkg.grade ?? "-"} tone={pkg.grade === "A" || pkg.grade === "B" ? "text-success" : pkg.grade === "F" ? "text-destructive" : "text-warning"} />
        <ScoreTile label="Risk" value={String(pkg.riskScore ?? 0)} />
        <div className="col-span-2 md:col-span-2 rounded-lg border border-border bg-card px-3 py-2">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Readiness</span>
            <span className={cn("text-xs font-bold", readinessTone)}>{readinessLabel}</span>
          </div>
          <Progress value={sc.readinessScore} className="h-1.5" />
        </div>
        <ScoreTile label="Open comments" value={String(sc.openComments)} />
        <ScoreTile label="Open tasks" value={String(sc.openTasks)} />
      </div>

      {/* Split */}
      <div className="flex flex-1 overflow-hidden gap-4 min-h-0">
        {/* Viewer */}
        <div className="w-1/2 min-w-0">
          <ProofViewer
            fileUrl={activeVersion?.fileUrl ?? pkg.artworkUrl ?? null}
            fileType={activeVersion?.fileType ?? null}
            pageCount={activeVersion?.pageCount ?? 1}
            annotations={viewerAnnotations}
            selectedId={selectedId}
            activeTool={tool}
            onToolChange={setTool}
            onSelect={setSelectedId}
            onCreate={handleCreate}
            showAi={showAi}
            showHuman={showHuman}
            onToggleAi={() => setShowAi((v) => !v)}
            onToggleHuman={() => setShowHuman((v) => !v)}
          />
        </div>

        {/* Sidebar */}
        <div className="w-1/2 min-w-0 flex flex-col bg-card border border-border rounded-xl overflow-hidden">
          <Tabs defaultValue="findings" className="flex-1 flex flex-col min-h-0">
            <TabsList className="w-full justify-start rounded-none border-b border-border h-auto p-0 bg-muted/20 gap-4 px-4 overflow-x-auto shrink-0">
              {[
                ["findings", "Findings"], ["comments", "Comments"], ["tasks", "Tasks"],
                ["data", "Data"], ["fda", "FDA Intel"], ["ecfr", "eCFR Regs"], ["copilot", "Copilot"], ["compare", "Compare"],
                ["language", "Language"], ["document", "Document AI"],
              ].map(([v, label]) => (
                <TabsTrigger key={v} value={v}
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none py-2.5 px-1 text-sm">
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="flex-1 overflow-y-auto min-h-0">
              <TabsContent value="findings" className="m-0 p-4"><FindingsPanel pkg={pkg} selectedId={selectedId} onSelect={setSelectedId} /></TabsContent>
              <TabsContent value="comments" className="m-0 p-4"><CommentsPanel pkg={pkg} packageId={packageId} numbered={numbered} selectedId={selectedId} onSelect={setSelectedId} onChange={invalidate} onAddPin={() => setTool("pin")} /></TabsContent>
              <TabsContent value="tasks" className="m-0 p-4"><TasksPanel pkg={pkg} packageId={packageId} onChange={invalidate} /></TabsContent>
              <TabsContent value="data" className="m-0 p-4"><DataPanel pkg={pkg} /></TabsContent>
              <TabsContent value="fda" className="m-0 p-4"><FdaIntelligenceTab packageId={packageId} /></TabsContent>
              <TabsContent value="ecfr" className="m-0 p-4"><EcfrRegulationsTab packageId={packageId} /></TabsContent>
              <TabsContent value="copilot" className="m-0 p-4 h-full"><CopilotPanel packageId={packageId} pkg={pkg} /></TabsContent>
              <TabsContent value="compare" className="m-0 p-4"><ComparePanel pkg={pkg} packageId={packageId} /></TabsContent>
              <TabsContent value="language" className="m-0 p-4"><LanguageReviewTab detail={languageReview} onRun={handleRunLanguage} isRunning={runLanguage.isPending} /></TabsContent>
              <TabsContent value="document" className="m-0 p-4"><DocumentAiTab packageId={packageId} /></TabsContent>
            </div>
          </Tabs>

          <ApprovalBar pkg={pkg} packageId={packageId} onChange={invalidate} />
        </div>
      </div>

      {/* Pin comment composer */}
      {pendingPin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPendingPin(null)}>
          <div className="bg-card border border-border rounded-xl p-5 w-[440px] shadow-2xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold flex items-center gap-2"><MessageSquarePlus className="w-4 h-4 text-primary" /> New {pendingPin.type === "text" ? "text note" : "pin comment"}</h3>
            <Textarea autoFocus value={pinText} onChange={(e) => setPinText(e.target.value)} placeholder="Add your comment… use @Name to mention a reviewer" className="min-h-[100px]" />
            <div className="flex items-center gap-3">
              <Select value={pinPriority} onValueChange={setPinPriority}>
                <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["critical", "high", "medium", "low"].map((p) => (
                    <SelectItem key={p} value={p}>{priorityMeta(p).label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {extractMentions(pinText).length > 0 && (
                <span className="text-xs text-primary">Notifies: {extractMentions(pinText).join(", ")}</span>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setPendingPin(null)}>Cancel</Button>
              <Button onClick={savePin} disabled={!pinText.trim() || createAnnotation.isPending}>
                {createAnnotation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add comment"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function findingClassForAnnotation(a: Annotation, violations: Violation[]): string | null {
  if (a.source !== "ai") return null
  if (a.violationId) {
    const v = violations.find((x) => x.id === a.violationId)
    if (v?.findingClass) return v.findingClass
  }
  return "issue"
}

function ScoreTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={cn("text-2xl font-black leading-tight", tone)}>{value}</div>
    </div>
  )
}

function ApprovalBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Approved: "bg-success/10 text-success border-success/20",
    "Approved with Comments": "bg-success/10 text-success border-success/20",
    Rejected: "bg-destructive/10 text-destructive border-destructive/20",
    "Needs Revision": "bg-warning/10 text-warning border-warning/20",
    Escalated: "bg-primary/10 text-primary border-primary/20",
    Pending: "bg-muted text-muted-foreground border-border",
  }
  return <Badge variant="outline" className={cn("text-[10px]", map[status] ?? map.Pending)}>{status}</Badge>
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------
function FindingsPanel({ pkg, selectedId, onSelect }: { pkg: Pkg; selectedId: number | null; onSelect: (id: number | null) => void }) {
  const groups: [string, Violation[]][] = [
    ["Issues", pkg.violations.filter((v) => v.findingClass === "issue")],
    ["Warnings", pkg.violations.filter((v) => v.findingClass === "warning")],
    ["Recommendations", pkg.violations.filter((v) => v.findingClass === "recommendation")],
    ["Passed checks", pkg.violations.filter((v) => v.findingClass === "passed")],
  ]
  const annForViolation = (vid: number) => pkg.annotations.find((a) => a.violationId === vid)

  if (pkg.violations.length === 0) {
    return <div className="text-center py-12 text-muted-foreground"><CheckCircle className="w-12 h-12 mx-auto mb-3 text-success opacity-50" /><p>No findings yet. Run the AI analysis.</p></div>
  }
  return (
    <div className="space-y-5">
      {groups.map(([label, items]) => items.length > 0 && (
        <div key={label} className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label} ({items.length})</h4>
          {items.map((v) => {
            const meta = findingClassMeta(v.findingClass)
            const ann = annForViolation(v.id)
            const selected = ann && ann.id === selectedId
            // Only a genuine correction when the suggestion actually differs
            // from the detected text; otherwise fall back to a plain note so we
            // never render a "X → X" no-op fix.
            const isCorrection =
              Boolean(v.detectedText?.trim()) &&
              hasDistinctFix(v.detectedText, v.suggestedText)
            const fixNote = isCorrection
              ? null
              : v.recommendation || (!v.detectedText ? v.suggestedText : null) || null
            return (
              <button key={v.id} type="button" onClick={() => ann && onSelect(ann.id)}
                className={cn("w-full text-left p-3 rounded-lg border bg-card space-y-1.5 transition-colors", selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-muted-foreground/40")}>
                <div className="flex justify-between items-start gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn("w-2 h-2 rounded-full shrink-0", meta.dot)} />
                    <span className="font-semibold text-sm truncate">{v.title}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">{v.engine}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{v.description}</p>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <Badge variant="outline" className={cn("text-[10px]", meta.badge)}>{v.severity}</Badge>
                  {v.confidence != null && <span className="text-[10px] text-muted-foreground">Confidence {v.confidence}%</span>}
                  {v.claimFlags?.map((f) => <Badge key={f} variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20">{f}</Badge>)}
                </div>
                {(isCorrection || fixNote) && (
                  <div className="mt-1 p-2 bg-accent/50 rounded border border-border text-xs">
                    {isCorrection ? (
                      <span className="font-mono"><span className="text-destructive line-through mr-2">{v.detectedText}</span><span className="text-success">{v.suggestedText}</span></span>
                    ) : (
                      <span><span className="font-semibold text-muted-foreground">Fix: </span>{fixNote}</span>
                    )}
                  </div>
                )}
                {v.regulationRef && <div className="text-[10px] font-mono text-muted-foreground">Ref: <RegulationRef refText={v.regulationRef} /></div>}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Comments (threaded)
// ---------------------------------------------------------------------------
function CommentsPanel({ pkg, packageId, numbered, selectedId, onSelect, onChange, onAddPin }: {
  pkg: Pkg; packageId: number; numbered: Map<number, number>; selectedId: number | null;
  onSelect: (id: number | null) => void; onChange: () => void; onAddPin: () => void
}) {
  const [filter, setFilter] = React.useState<"all" | "open" | "ai" | "human">("all")
  const list = pkg.annotations.filter((a) => {
    if (filter === "open") return a.status === "open"
    if (filter === "ai") return a.source === "ai"
    if (filter === "human") return a.source === "human"
    return true
  })
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {(["all", "open", "ai", "human"] as const).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "secondary" : "ghost"} className="h-7 text-xs capitalize" onClick={() => setFilter(f)}>{f}</Button>
          ))}
        </div>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onAddPin}><MessageSquarePlus className="w-3.5 h-3.5" /> Pin</Button>
      </div>
      {list.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">No comments in this view.</div>
      ) : list.map((a) => (
        <CommentCard key={a.id} a={a} num={numbered.get(a.id) ?? 0} selected={a.id === selectedId} onSelect={onSelect} onChange={onChange} />
      ))}
    </div>
  )
}

function CommentCard({ a, num, selected, onSelect, onChange }: {
  a: Annotation; num: number; selected: boolean; onSelect: (id: number | null) => void; onChange: () => void
}) {
  const update = useUpdateAnnotation()
  const del = useDeleteAnnotation()
  const reply = useAddCommentReply()
  const [replyText, setReplyText] = React.useState("")
  const [showReply, setShowReply] = React.useState(false)
  const meta = priorityMeta(a.priority)
  const isAi = a.source === "ai"

  return (
    <div className={cn("rounded-lg border p-3 space-y-2", selected ? "border-primary ring-1 ring-primary" : "border-border", a.status === "resolved" && "opacity-70")}>
      <div className="flex items-start justify-between gap-2 cursor-pointer" onClick={() => onSelect(a.id)}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex items-center justify-center w-6 h-6 rounded-full text-white text-[10px] font-bold shrink-0"
            style={{ background: a.color ?? (isAi ? findingClassMeta(null).color : HUMAN_MARKUP_COLOR) }}>
            {isAi ? <Bot className="w-3 h-3" /> : num}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate flex items-center gap-1.5">{a.author}
              {isAi && <Badge variant="outline" className="text-[9px] bg-primary/5 text-primary border-primary/20">AI</Badge>}
            </div>
            <div className="text-[10px] text-muted-foreground">{a.authorRole} • {relativeTime(a.createdAt)}</div>
          </div>
        </div>
        <Badge variant="outline" className={cn("text-[10px] shrink-0", meta.badge)}>{meta.label}</Badge>
      </div>

      {a.text && <p className="text-sm text-foreground/90">{highlightMentions(a.text)}</p>}

      {isAi && a.suggestedFix && (
        <div className="text-xs p-2 bg-success/5 border border-success/20 rounded"><span className="font-semibold text-success">Suggested fix: </span>{a.suggestedFix}</div>
      )}
      {a.regulationRef && <div className="text-[10px] font-mono text-muted-foreground">Ref: <RegulationRef refText={a.regulationRef} />{a.confidence != null ? ` • ${a.confidence}% confidence` : ""}</div>}

      {a.replies.length > 0 && (
        <div className="space-y-2 pl-3 border-l-2 border-border ml-1">
          {a.replies.map((r) => (
            <div key={r.id} className="text-xs">
              <span className="font-medium">{r.author}</span> <span className="text-muted-foreground">{relativeTime(r.createdAt)}</span>
              <p className="text-foreground/80">{highlightMentions(r.text)}</p>
            </div>
          ))}
        </div>
      )}

      {showReply && (
        <div className="flex gap-2">
          <Input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Reply… @mention" className="h-8 text-sm"
            onKeyDown={(e) => { if (e.key === "Enter" && replyText.trim()) submitReply() }} />
          <Button size="sm" className="h-8" disabled={!replyText.trim() || reply.isPending} onClick={submitReply}>
            {reply.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </Button>
        </div>
      )}

      <div className="flex items-center gap-1 pt-0.5">
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setShowReply((v) => !v)}><CornerDownRight className="w-3.5 h-3.5" /> Reply</Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"
          onClick={() => update.mutate({ id: a.id, data: { status: a.status === "resolved" ? "open" : "resolved" } }, { onSuccess: onChange })}>
          <CheckCheck className={cn("w-3.5 h-3.5", a.status === "resolved" && "text-success")} /> {a.status === "resolved" ? "Reopen" : "Resolve"}
        </Button>
        {!isAi && (
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-destructive ml-auto"
            onClick={() => del.mutate({ id: a.id }, { onSuccess: onChange })}><Trash2 className="w-3.5 h-3.5" /></Button>
        )}
      </div>
    </div>
  )

  function submitReply() {
    reply.mutate({ id: a.id, data: { text: replyText, mentions: extractMentions(replyText) } },
      { onSuccess: () => { setReplyText(""); setShowReply(false); onChange() } })
  }
}

function highlightMentions(text: string): React.ReactNode {
  const parts = text.split(/(@[A-Za-z]+(?:\s[A-Za-z]+)?)/g)
  return parts.map((p, i) => p.startsWith("@") ? <span key={i} className="text-primary font-medium">{p}</span> : <React.Fragment key={i}>{p}</React.Fragment>)
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
function TasksPanel({ pkg, packageId, onChange }: { pkg: Pkg; packageId: number; onChange: () => void }) {
  const create = useCreateReviewTask()
  const update = useUpdateReviewTask()
  const [title, setTitle] = React.useState("")
  const [assignee, setAssignee] = React.useState(REVIEWERS[0])
  const [priority, setPriority] = React.useState("medium")

  const statusMeta: Record<string, { label: string; badge: string }> = {
    open: { label: "Open", badge: "bg-muted text-muted-foreground border-border" },
    in_progress: { label: "In progress", badge: "bg-primary/10 text-primary border-primary/20" },
    done: { label: "Done", badge: "bg-success/10 text-success border-success/20" },
  }
  const nextStatus = (s: string) => (s === "open" ? "in_progress" : s === "in_progress" ? "done" : "open")

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border p-3 space-y-2 bg-accent/20">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New review task…" className="h-9" />
        <div className="flex gap-2">
          <Select value={assignee} onValueChange={setAssignee}><SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>{REVIEWERS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select>
          <Select value={priority} onValueChange={setPriority}><SelectTrigger className="h-8 text-xs w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{["critical", "high", "medium", "low"].map((p) => <SelectItem key={p} value={p}>{priorityMeta(p).label}</SelectItem>)}</SelectContent></Select>
          <Button size="sm" className="h-8 gap-1" disabled={!title.trim() || create.isPending}
            onClick={() => create.mutate({ id: packageId, data: { title, assignee, priority } }, { onSuccess: () => { setTitle(""); onChange() } })}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>
      {pkg.tasks.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm"><ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-30" />No tasks yet.</div>
      ) : pkg.tasks.map((t: Task) => {
        const sm = statusMeta[t.status] ?? statusMeta.open
        return (
          <div key={t.id} className={cn("rounded-lg border border-border p-3 space-y-1", t.status === "done" && "opacity-60")}>
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium">{t.title}</span>
              <Badge variant="outline" className={cn("text-[10px] shrink-0", priorityMeta(t.priority).badge)}>{priorityMeta(t.priority).label}</Badge>
            </div>
            {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-muted-foreground">{t.assignedRole ?? t.assignee ?? "Unassigned"}{t.source === "ai" ? " • AI" : ""}</span>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => update.mutate({ id: t.id, data: { status: nextStatus(t.status) } }, { onSuccess: onChange })}>
                <Badge variant="outline" className={cn("text-[10px]", sm.badge)}>{sm.label}</Badge>
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Data (OCR)
// ---------------------------------------------------------------------------
function DataPanel({ pkg }: { pkg: Pkg }) {
  const ocr = pkg.ocr as Record<string, unknown> | null
  return (
    <div className="space-y-4">
      {pkg.summary && <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">{pkg.summary}</div>}
      <div className="grid grid-cols-1 gap-2">
        {ocr && Object.entries(ocr).map(([k, val]) => {
          if (!val || (Array.isArray(val) && val.length === 0)) return null
          return (
            <div key={k} className="p-2.5 bg-accent/40 rounded-lg border border-border">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-0.5">{k.replace(/([A-Z])/g, " $1").trim()}</span>
              <span className="text-sm break-words">{Array.isArray(val) ? val.join(", ") : String(val)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Copilot
// ---------------------------------------------------------------------------
type ChatMsg = { role: "user" | "assistant"; content: string; citations?: Citation[] }
function CopilotPanel({ packageId, pkg }: { packageId: number; pkg: Pkg }) {
  const ask = useAskCopilot()
  const [q, setQ] = React.useState("")
  const [msgs, setMsgs] = React.useState<ChatMsg[]>([])
  const endRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }) }, [msgs, ask.isPending])

  const prompts = [
    "How do I fix the critical issues?",
    "Which regulations apply here?",
    "Summarize the biggest compliance risks.",
    "Is this ready for approval?",
  ]

  const send = (question: string) => {
    if (!question.trim()) return
    setMsgs((m) => [...m, { role: "user", content: question }])
    setQ("")
    ask.mutate({ id: packageId, data: { question } }, {
      onSuccess: (r) => setMsgs((m) => [...m, { role: "assistant", content: r.answer, citations: r.citations }]),
      onError: () => setMsgs((m) => [...m, { role: "assistant", content: "Sorry, I couldn't answer that. Please retry." }]),
    })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {msgs.length === 0 && (
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0"><BrainCircuit className="w-4 h-4 text-primary" /></div>
              <div className="bg-accent/50 border border-border p-3 rounded-lg text-sm">
                I've reviewed <span className="font-medium">{pkg.name}</span> — grade {pkg.grade ?? "N/A"}, {pkg.criticalCount} critical and {pkg.majorCount} major findings. Ask me anything.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {prompts.map((p) => <Button key={p} variant="outline" size="sm" className="text-xs h-7" onClick={() => send(p)}>{p}</Button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cn("flex items-start gap-2", m.role === "user" && "flex-row-reverse")}>
            <div className={cn("w-7 h-7 rounded-full flex items-center justify-center shrink-0", m.role === "user" ? "bg-muted" : "bg-primary/15")}>
              {m.role === "user" ? <UserIcon className="w-4 h-4" /> : <BrainCircuit className="w-4 h-4 text-primary" />}
            </div>
            <div className={cn("p-3 rounded-lg text-sm max-w-[85%]", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-accent/50 border border-border")}>
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.citations && m.citations.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                  {m.citations.map((c, j) => <div key={j} className="text-[10px] font-mono opacity-80">{c.source}{c.section ? ` §${c.section}` : ""}</div>)}
                </div>
              )}
            </div>
          </div>
        ))}
        {ask.isPending && <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Thinking…</div>}
        <div ref={endRef} />
      </div>
      <div className="relative shrink-0 pt-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send(q)} placeholder="Ask compliance copilot…" className="pr-10" />
        <Button size="icon" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-primary" disabled={ask.isPending} onClick={() => send(q)}><Send className="w-4 h-4" /></Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add version
// ---------------------------------------------------------------------------
function AddVersionButton({ packageId, onAdded }: { packageId: number; onAdded: (versionId: number) => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const { uploadFile, isUploading } = useUpload()
  const extractText = useExtractArtworkText()
  const createVersion = useCreatePackageVersion()
  const [error, setError] = React.useState<string | null>(null)
  const busy = isUploading || extractText.isPending || createVersion.isPending

  const handleFile = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setError(null)
    try {
      const type = fileTypeFromName(file.name)
      const res = await uploadFile(file)
      if (!res) { setError("Upload failed."); return }
      let extractedText: string | undefined
      if (type === "png" || type === "jpg") {
        try {
          const dataUrl = await fileToDownscaledDataUrl(file)
          const r = await extractText.mutateAsync({ data: { imageDataUrl: dataUrl } })
          extractedText = r.text?.trim() || undefined
        } catch { /* OCR is best-effort */ }
      }
      const detail = await createVersion.mutateAsync({
        id: packageId,
        data: {
          fileUrl: res.objectPath,
          fileName: file.name,
          fileType: type,
          extractedText,
          analyze: !!extractedText,
        },
      })
      if (detail.currentVersionId != null) onAdded(detail.currentVersionId)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add version.")
    } finally {
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <div className="flex flex-col items-end">
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.pdf,.ai,.indd"
        className="hidden"
        onChange={(e) => handleFile(e.target.files)}
      />
      <Button variant="outline" className="gap-2 h-9" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePlus className="w-4 h-4" />}
        Add Version
      </Button>
      {error && <span className="text-[10px] text-destructive mt-0.5 max-w-[190px] text-right">{error}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------
function ComparePanel({ pkg, packageId }: { pkg: Pkg; packageId: number }) {
  const versions = pkg.versions
  const [a, setA] = React.useState<number | null>(versions[0]?.id ?? null)
  const [b, setB] = React.useState<number | null>(versions[1]?.id ?? versions[0]?.id ?? null)
  const [run, setRun] = React.useState(false)

  const enabled = run && a != null && b != null && a !== b
  const compare = useComparePackageVersions(packageId, a ?? 0, b ?? 0, {
    query: { enabled, queryKey: getComparePackageVersionsQueryKey(packageId, a ?? 0, b ?? 0) },
  })

  const catColor: Record<string, string> = {
    claim: "text-primary", warning: "text-warning", ingredient: "text-success",
    regulatory: "text-destructive", copy: "text-muted-foreground", other: "text-muted-foreground",
  }
  const typeIcon: Record<string, string> = { added: "+", removed: "−", changed: "~", unchanged: "=" }

  if (versions.length < 2) {
    return <div className="text-center py-10 text-muted-foreground text-sm"><GitCompareArrows className="w-10 h-10 mx-auto mb-2 opacity-30" />Add a second version to compare revisions.</div>
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select value={String(a ?? "")} onValueChange={(v) => { setA(Number(v)); setRun(false) }}><SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>{versions.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.label ?? `V${v.versionNumber}`}</SelectItem>)}</SelectContent></Select>
        <GitCompareArrows className="w-4 h-4 text-muted-foreground shrink-0" />
        <Select value={String(b ?? "")} onValueChange={(v) => { setB(Number(v)); setRun(false) }}><SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>{versions.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.label ?? `V${v.versionNumber}`}</SelectItem>)}</SelectContent></Select>
      </div>
      <Button className="w-full gap-2" disabled={a === b || compare.isFetching} onClick={() => setRun(true)}>
        {compare.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Compare with AI
      </Button>
      {a === b && <p className="text-xs text-warning text-center">Select two different versions.</p>}

      {compare.data && (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">{compare.data.summary}</div>
          <div className="space-y-2">
            {compare.data.changes.map((c, i) => (
              <div key={i} className="p-2.5 rounded-lg border border-border text-xs space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold w-4 text-center">{typeIcon[c.changeType] ?? "~"}</span>
                  <span className={cn("font-semibold uppercase text-[10px]", catColor[c.category] ?? "text-muted-foreground")}>{c.category}</span>
                  {c.field && <span className="font-medium">{c.field}</span>}
                </div>
                {c.before && <div className="pl-6 text-destructive line-through">{c.before}</div>}
                {c.after && <div className="pl-6 text-success">{c.after}</div>}
                {c.note && <div className="pl-6 text-muted-foreground italic">{c.note}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Approval bar
// ---------------------------------------------------------------------------
function approvalStatusTone(status: string): string {
  switch (status) {
    case "Approved":
    case "Approved with Comments":
      return "text-success"
    case "Rejected":
      return "text-destructive"
    case "Needs Revision":
      return "text-warning"
    case "Escalated":
      return "text-primary"
    default:
      return "text-muted-foreground"
  }
}

const DECISION_LABELS: Record<string, string> = {
  approve: "Approved",
  approve_with_comments: "Approved with comments",
  needs_revision: "Needs revision",
  reject: "Rejected",
  escalate: "Escalated",
}

function ApprovalBar({ pkg, packageId, onChange }: { pkg: Pkg; packageId: number; onChange: () => void }) {
  const qc = useQueryClient()
  const decide = useCreateApprovalDecision()
  const [note, setNote] = React.useState("")
  const [feedback, setFeedback] = React.useState<{ type: "success" | "error"; text: string } | null>(null)
  const [overriding, setOverriding] = React.useState(false)

  const latest = pkg.approvals.length ? pkg.approvals[pkg.approvals.length - 1] : null
  // Approved / Rejected are settled outcomes; Needs Revision and Escalated still
  // expect a follow-up decision, so their action buttons stay visible.
  const terminal =
    pkg.approvalStatus === "Approved" ||
    pkg.approvalStatus === "Approved with Comments" ||
    pkg.approvalStatus === "Rejected"

  const act = (decision: string) => {
    setFeedback(null)
    decide.mutate(
      { id: packageId, data: { decision, note: note || undefined } },
      {
        onSuccess: (detail) => {
          setNote("")
          setOverriding(false)
          if (detail) qc.setQueryData(getGetPackageQueryKey(packageId), detail)
          onChange()
          setFeedback({ type: "success", text: `Decision saved — ${DECISION_LABELS[decision] ?? decision}.` })
        },
        onError: (err) => {
          setFeedback({
            type: "error",
            text: err instanceof Error && err.message ? err.message : "Could not save decision. Please retry.",
          })
        },
      },
    )
  }

  const showActions = !terminal || overriding

  return (
    <div className="border-t border-border p-3 bg-muted/20 shrink-0 space-y-2">
      {latest && (
        <div className={cn("rounded-md border p-2 flex items-start gap-2 bg-card", "border-border")}>
          <Gavel className={cn("w-4 h-4 mt-0.5 shrink-0", approvalStatusTone(pkg.approvalStatus))} />
          <div className="min-w-0 text-xs">
            <div className={cn("font-semibold", approvalStatusTone(pkg.approvalStatus))}>{pkg.approvalStatus}</div>
            <div className="text-muted-foreground">
              by {latest.reviewer}{latest.reviewerRole ? ` · ${latest.reviewerRole}` : ""} · {relativeTime(latest.createdAt)}
            </div>
            {latest.note && <div className="mt-1 italic text-foreground/80 break-words">“{latest.note}”</div>}
          </div>
        </div>
      )}

      {feedback && (
        <div
          className={cn(
            "rounded-md border p-2 text-xs flex items-center gap-2",
            feedback.type === "success"
              ? "bg-success/10 border-success/30 text-success"
              : "bg-destructive/10 border-destructive/30 text-destructive",
          )}
        >
          {feedback.type === "success" ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertOctagon className="w-4 h-4 shrink-0" />}
          <span className="break-words">{feedback.text}</span>
        </div>
      )}

      {terminal && !overriding && (
        <Button size="sm" variant="outline" className="w-full gap-1.5" disabled={decide.isPending} onClick={() => { setFeedback(null); setOverriding(true) }}>
          <Gavel className="w-4 h-4" /> Change decision
        </Button>
      )}

      {showActions && (
        <>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Decision note (optional)…" className="h-8 text-sm" />
          <div className="flex items-center gap-2">
            <Button size="sm" className="flex-1 gap-1.5 bg-success text-success-foreground hover:bg-success/90" disabled={decide.isPending} onClick={() => act("approve")}>
              {decide.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Approve
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 border-warning/30 text-warning hover:bg-warning/10" disabled={decide.isPending} onClick={() => act("needs_revision")}>
              <ShieldAlert className="w-4 h-4" /> Revise
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10" disabled={decide.isPending} onClick={() => act("reject")}>
              <XCircle className="w-4 h-4" /> Reject
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" className="px-2" disabled={decide.isPending}><ChevronDown className="w-4 h-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => act("approve_with_comments")}><CheckCircle className="w-4 h-4 mr-2" /> Approve with comments</DropdownMenuItem>
                <DropdownMenuItem onClick={() => act("escalate")}><Gavel className="w-4 h-4 mr-2" /> Escalate</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {terminal && overriding && (
            <Button size="sm" variant="ghost" className="w-full text-xs" disabled={decide.isPending} onClick={() => setOverriding(false)}>
              Cancel
            </Button>
          )}
        </>
      )}
    </div>
  )
}
