import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, Link } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import {
  useGetPackage,
  getGetPackageQueryKey,
  useListPackages,
  getListPackagesQueryKey,
  useListProofs,
  getListProofsQueryKey,
  useGetProof,
  getGetProofQueryKey,
  useCreateProof,
  useCreateAnnotation,
  useUpdateAnnotation,
  useDeleteAnnotation,
  useCreateComment,
  useRecordProofDecision,
  type ProofAnnotation,
} from "@workspace/api-client-react"
import { useUpload } from "@workspace/object-storage-web"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import {
  ArrowLeft, Upload, MousePointer2, MapPin, Square, Eye, EyeOff,
  Loader2, MessageSquarePlus, Check, Trash2, ShieldAlert, CheckCircle2,
  FileText, Send, CircleDot, RotateCcw, XCircle,
} from "lucide-react"

const ACCEPT = "image/png,image/jpeg,image/jpg,image/webp,application/pdf"
const MAX_BYTES = 100 * 1024 * 1024

type Tool = "select" | "pin" | "box"
type Draft = { kind: "pin" | "box"; x: number; y: number; w: number; h: number }

function objectUrl(objectPath: string): string {
  const p = objectPath.replace(/^\/objects\//, "").replace(/^\/+/, "")
  return `/api/storage/objects/${p}`
}

function formatBytes(bytes: number): string {
  if (!bytes) return "—"
  const units = ["B", "KB", "MB", "GB"]
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const secs = Math.max(1, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(iso).toLocaleDateString()
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "outline"> = {
  Approved: "success",
  "In Review": "outline",
  "Changes Requested": "warning",
  Rejected: "destructive",
}

export default function Proofing() {
  const { packageId: packageIdParam } = useParams()
  const packageId = Number(packageIdParam)
  const queryClient = useQueryClient()

  const { data: pkg } = useGetPackage(packageId, {
    query: { enabled: !!packageId, queryKey: getGetPackageQueryKey(packageId) },
  })
  const { data: proofs = [], isLoading: proofsLoading } = useListProofs(packageId, {
    query: { enabled: !!packageId, queryKey: getListProofsQueryKey(packageId) },
  })

  const [selectedProofId, setSelectedProofId] = useState<number | null>(null)
  useEffect(() => {
    if (selectedProofId === null && proofs.length > 0) {
      setSelectedProofId(proofs[0]!.id)
    }
    if (selectedProofId !== null && proofs.length > 0 && !proofs.some((p) => p.id === selectedProofId)) {
      setSelectedProofId(proofs[0]!.id)
    }
  }, [proofs, selectedProofId])

  const { data: proof } = useGetProof(selectedProofId ?? 0, {
    query: {
      enabled: !!selectedProofId,
      queryKey: getGetProofQueryKey(selectedProofId ?? 0),
    },
  })

  // ---- Upload ----
  const createProof = useCreateProof()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { uploadFile, isUploading, progress } = useUpload({
    onError: (e) => toast.error(e.message || "Upload failed"),
  })

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} is larger than 100MB`)
        continue
      }
      const res = await uploadFile(file)
      if (!res) continue
      await new Promise<void>((resolve) => {
        createProof.mutate(
          {
            id: packageId,
            data: {
              fileName: file.name,
              objectPath: res.objectPath,
              contentType: file.type || "application/octet-stream",
              fileSize: file.size,
            },
          },
          {
            onSuccess: (created) => {
              queryClient.invalidateQueries({ queryKey: getListProofsQueryKey(packageId) })
              setSelectedProofId(created.id)
              toast.success(`Uploaded ${file.name} as v${created.version}`)
              resolve()
            },
            onError: () => {
              toast.error(`Failed to register ${file.name}`)
              resolve()
            },
          },
        )
      })
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  // ---- Markup ----
  const [tool, setTool] = useState<Tool>("select")
  const [showAi, setShowAi] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftBody, setDraftBody] = useState("")
  const [activeAnnId, setActiveAnnId] = useState<number | null>(null)
  const mediaRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  const createAnnotation = useCreateAnnotation()
  const updateAnnotation = useUpdateAnnotation()
  const deleteAnnotation = useDeleteAnnotation()
  const createComment = useCreateComment()
  const recordDecision = useRecordProofDecision()

  const invalidateProof = () => {
    if (selectedProofId) {
      queryClient.invalidateQueries({ queryKey: getGetProofQueryKey(selectedProofId) })
    }
    queryClient.invalidateQueries({ queryKey: getListProofsQueryKey(packageId) })
  }

  const isPdf = proof?.contentType === "application/pdf"
  const markupActive = tool !== "select" && !isPdf

  const normFromEvent = (clientX: number, clientY: number) => {
    const rect = mediaRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
    return { x, y }
  }

  const onOverlayPointerDown = (e: React.PointerEvent) => {
    if (!markupActive || draft) return
    const n = normFromEvent(e.clientX, e.clientY)
    if (!n) return
    if (tool === "pin") {
      setDraft({ kind: "pin", x: n.x, y: n.y, w: 0, h: 0 })
      setDraftBody("")
      setActiveAnnId(null)
    } else if (tool === "box") {
      dragStart.current = n
      setDraft({ kind: "box", x: n.x, y: n.y, w: 0, h: 0 })
      setDraftBody("")
      setActiveAnnId(null)
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    }
  }

  const onOverlayPointerMove = (e: React.PointerEvent) => {
    if (tool !== "box" || !dragStart.current) return
    const n = normFromEvent(e.clientX, e.clientY)
    if (!n) return
    const s = dragStart.current
    setDraft({
      kind: "box",
      x: Math.min(s.x, n.x),
      y: Math.min(s.y, n.y),
      w: Math.abs(n.x - s.x),
      h: Math.abs(n.y - s.y),
    })
  }

  const onOverlayPointerUp = () => {
    if (tool === "box" && dragStart.current) {
      dragStart.current = null
      setDraft((d) => {
        if (d && d.kind === "box" && (d.w < 0.01 || d.h < 0.01)) return null
        return d
      })
    }
  }

  const saveDraft = () => {
    if (!draft || !selectedProofId) return
    createAnnotation.mutate(
      {
        proofId: selectedProofId,
        data: {
          kind: draft.kind,
          x: draft.x,
          y: draft.y,
          w: draft.w,
          h: draft.h,
          body: draftBody.trim() || undefined,
        },
      },
      {
        onSuccess: (created) => {
          setDraft(null)
          setDraftBody("")
          setTool("select")
          setActiveAnnId(created.id)
          invalidateProof()
        },
        onError: () => toast.error("Failed to save markup"),
      },
    )
  }

  const cancelDraft = () => {
    setDraft(null)
    setDraftBody("")
    dragStart.current = null
  }

  const annotations = proof?.annotations ?? []
  const generalComments = proof?.generalComments ?? []
  const decisions = proof?.decisions ?? []
  const aiViolations = useMemo(
    () => (pkg?.violations ?? []).filter((v) => v.bbox),
    [pkg],
  )

  const activeAnn = annotations.find((a) => a.id === activeAnnId) ?? null

  // ---- Header actions ----
  if (!packageId) return <div className="p-8">Invalid package.</div>

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border shrink-0 gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <Link href={`/reviews/${packageId}`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold truncate">Proofing Studio</h1>
              {proof && (
                <Badge variant={STATUS_VARIANT[proof.status] ?? "outline"}>{proof.status}</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground truncate">
              {pkg ? `${pkg.name} • ${pkg.sku}` : "Loading package…"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="gap-2"
          >
            {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Upload Proof
          </Button>
        </div>
      </div>

      {isUploading && (
        <div className="pt-3 shrink-0">
          <Progress value={progress} className="h-1" />
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden mt-4 gap-4">
        {/* Version rail */}
        <div className="w-52 shrink-0 flex flex-col border border-border rounded-xl bg-card overflow-hidden">
          <div className="px-3 py-2.5 border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Proof Versions
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {proofsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : proofs.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground px-2 py-8">
                No proofs yet. Upload artwork to begin.
              </div>
            ) : (
              proofs.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setSelectedProofId(p.id); setActiveAnnId(null); cancelDraft() }}
                  className={cn(
                    "w-full text-left rounded-lg border p-2.5 transition-colors",
                    p.id === selectedProofId
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-accent",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm">v{p.version}</span>
                    <Badge variant={STATUS_VARIANT[p.status] ?? "outline"} className="text-[10px] px-1.5">{p.status}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate mt-1">{p.fileName}</p>
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
                    {p.openCount > 0 && (
                      <span className="flex items-center gap-0.5 text-warning font-medium">
                        <CircleDot className="w-3 h-3" /> {p.openCount} open
                      </span>
                    )}
                    <span>{p.commentCount} comment{p.commentCount === 1 ? "" : "s"}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Viewer */}
        <div className="flex-1 flex flex-col border border-border rounded-xl bg-accent/30 overflow-hidden min-w-0">
          <div className="px-3 py-2 border-b border-border bg-card flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-1">
              <Button variant={tool === "select" ? "default" : "ghost"} size="sm" className="gap-1.5 h-8" onClick={() => { setTool("select"); cancelDraft() }}>
                <MousePointer2 className="w-4 h-4" /> Select
              </Button>
              <Button variant={tool === "pin" ? "default" : "ghost"} size="sm" className="gap-1.5 h-8" disabled={!proof || isPdf} onClick={() => { setTool("pin"); cancelDraft() }}>
                <MapPin className="w-4 h-4" /> Pin
              </Button>
              <Button variant={tool === "box" ? "default" : "ghost"} size="sm" className="gap-1.5 h-8" disabled={!proof || isPdf} onClick={() => { setTool("box"); cancelDraft() }}>
                <Square className="w-4 h-4" /> Box
              </Button>
              {isPdf && (
                <span className="ml-2 text-xs text-muted-foreground">
                  Markup is available on image proofs — PDFs support comments &amp; approval.
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 h-8"
              disabled={aiViolations.length === 0 || isPdf}
              onClick={() => setShowAi((s) => !s)}
            >
              {showAi ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              AI Layer ({aiViolations.length})
            </Button>
          </div>

          <div className="flex-1 overflow-auto p-6 flex items-center justify-center">
            {!proof ? (
              <div className="text-center text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>{proofs.length === 0 ? "Upload a proof to start reviewing." : "Select a proof version."}</p>
              </div>
            ) : (
              <div
                ref={mediaRef}
                className="relative inline-block max-w-full shadow-xl bg-white"
                style={{ cursor: markupActive ? "crosshair" : "default" }}
              >
                {isPdf ? (
                  <iframe
                    src={objectUrl(proof.objectPath)}
                    title={proof.fileName}
                    className="w-[820px] max-w-[75vw] h-[70vh] bg-white"
                  />
                ) : (
                  <img
                    src={objectUrl(proof.objectPath)}
                    alt={proof.fileName}
                    className="block max-h-[72vh] max-w-full object-contain select-none"
                    draggable={false}
                  />
                )}

                {/* Overlay */}
                <div
                  className="absolute inset-0"
                  style={{ pointerEvents: markupActive ? "auto" : "none" }}
                  onPointerDown={onOverlayPointerDown}
                  onPointerMove={onOverlayPointerMove}
                  onPointerUp={onOverlayPointerUp}
                >
                  {/* AI layer */}
                  {showAi && !isPdf && aiViolations.map((v, i) => v.bbox && (
                    <div
                      key={`ai-${i}`}
                      className={cn(
                        "absolute border-2 border-dashed rounded-sm",
                        v.severity === "critical" ? "border-destructive bg-destructive/10"
                          : v.severity === "major" ? "border-warning bg-warning/10"
                          : "border-muted-foreground/60 bg-muted-foreground/5",
                      )}
                      style={{
                        left: `${v.bbox.x * 100}%`,
                        top: `${v.bbox.y * 100}%`,
                        width: `${v.bbox.w * 100}%`,
                        height: `${v.bbox.h * 100}%`,
                      }}
                      title={`AI: ${v.title}`}
                    />
                  ))}

                  {/* Existing annotations */}
                  {annotations.map((a, i) => (
                    <AnnotationMark
                      key={a.id}
                      ann={a}
                      index={i + 1}
                      active={a.id === activeAnnId}
                      onSelect={() => { setActiveAnnId(a.id); setTool("select") }}
                    />
                  ))}

                  {/* Draft */}
                  {draft && draft.kind === "box" && (
                    <div
                      className="absolute border-2 border-primary bg-primary/15 rounded-sm"
                      style={{
                        left: `${draft.x * 100}%`,
                        top: `${draft.y * 100}%`,
                        width: `${draft.w * 100}%`,
                        height: `${draft.h * 100}%`,
                      }}
                    />
                  )}
                  {draft && draft.kind === "pin" && (
                    <div
                      className="absolute -translate-x-1/2 -translate-y-full"
                      style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }}
                    >
                      <MapPin className="w-6 h-6 text-primary fill-primary/30" />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="w-96 shrink-0 flex flex-col border border-border rounded-xl bg-card overflow-hidden">
          {draft ? (
            <div className="flex flex-col h-full">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <MessageSquarePlus className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm">New {draft.kind === "pin" ? "pin" : "box"} markup</span>
              </div>
              <div className="p-4 space-y-3 flex-1">
                <Textarea
                  autoFocus
                  placeholder="Describe the issue or note for this markup…"
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  className="min-h-32 resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  A comment is optional — you can drop the marker and discuss later.
                </p>
              </div>
              <div className="p-4 border-t border-border flex gap-2">
                <Button variant="outline" className="flex-1" onClick={cancelDraft}>Cancel</Button>
                <Button className="flex-1 gap-1.5" onClick={saveDraft} disabled={createAnnotation.isPending}>
                  {createAnnotation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <Tabs defaultValue="threads" className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="w-full justify-start rounded-none border-b border-border bg-muted/20 h-auto p-0 px-3 gap-4 shrink-0">
                <TabsTrigger value="threads" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none py-2.5 px-1">
                  Comments
                </TabsTrigger>
                <TabsTrigger value="ai" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none py-2.5 px-1">
                  AI Findings
                </TabsTrigger>
                <TabsTrigger value="approve" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none py-2.5 px-1">
                  Approve
                </TabsTrigger>
              </TabsList>

              {/* Threads */}
              <TabsContent value="threads" className="flex-1 overflow-y-auto m-0 p-3 space-y-3">
                {!proof ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Select a proof.</p>
                ) : (
                  <>
                    {activeAnn && (
                      <ThreadCard
                        ann={activeAnn}
                        index={annotations.findIndex((a) => a.id === activeAnn.id) + 1}
                        onClose={() => setActiveAnnId(null)}
                        onResolve={(resolved) =>
                          updateAnnotation.mutate(
                            { annotationId: activeAnn.id, data: { resolved } },
                            { onSuccess: invalidateProof },
                          )
                        }
                        onDelete={() =>
                          deleteAnnotation.mutate(
                            { annotationId: activeAnn.id },
                            { onSuccess: () => { setActiveAnnId(null); invalidateProof() } },
                          )
                        }
                        onReply={(body, done) =>
                          createComment.mutate(
                            { proofId: proof.id, data: { annotationId: activeAnn.id, body } },
                            { onSuccess: () => { invalidateProof(); done() } },
                          )
                        }
                      />
                    )}

                    {annotations.length === 0 && generalComments.length === 0 && !activeAnn && (
                      <div className="text-center text-muted-foreground py-8">
                        <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No markup yet.</p>
                        <p className="text-xs mt-1">Use the Pin or Box tool on the artwork.</p>
                      </div>
                    )}

                    {!activeAnn && annotations.map((a, i) => (
                      <button
                        key={a.id}
                        onClick={() => setActiveAnnId(a.id)}
                        className="w-full text-left rounded-lg border border-border p-3 hover:bg-accent transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 font-medium text-sm">
                            <span className={cn(
                              "flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold text-white",
                              a.resolved ? "bg-success" : "bg-primary",
                            )}>{i + 1}</span>
                            {a.resolved ? "Resolved" : "Open"} • {a.kind}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{a.comments.length} msg</span>
                        </div>
                        {a.comments[0] && (
                          <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">{a.comments[0].body}</p>
                        )}
                        <p className="text-[11px] text-muted-foreground mt-1">{a.authorName} · {timeAgo(a.createdAt)}</p>
                      </button>
                    ))}

                    {/* General comments */}
                    {!activeAnn && (
                      <GeneralComments
                        comments={generalComments}
                        onAdd={(body, done) =>
                          proof && createComment.mutate(
                            { proofId: proof.id, data: { body } },
                            { onSuccess: () => { invalidateProof(); done() } },
                          )
                        }
                      />
                    )}
                  </>
                )}
              </TabsContent>

              {/* AI findings */}
              <TabsContent value="ai" className="flex-1 overflow-y-auto m-0 p-3 space-y-2">
                {(pkg?.violations ?? []).length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-success opacity-50" />
                    <p className="text-sm">No AI violations on this package.</p>
                  </div>
                ) : (
                  (pkg?.violations ?? []).map((v) => (
                    <div key={v.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <h5 className="font-semibold text-sm flex items-center gap-1.5">
                          <ShieldAlert className={cn(
                            "w-4 h-4",
                            v.severity === "critical" ? "text-destructive" : v.severity === "major" ? "text-warning" : "text-muted-foreground",
                          )} />
                          {v.title}
                        </h5>
                        <Badge variant="outline" className="text-[10px] shrink-0">{v.engine}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1.5">{v.description}</p>
                      {v.recommendation && (
                        <p className="text-xs mt-2 p-2 bg-accent/50 rounded border border-border">{v.recommendation}</p>
                      )}
                    </div>
                  ))
                )}
              </TabsContent>

              {/* Approve */}
              <TabsContent value="approve" className="flex-1 overflow-y-auto m-0 p-4">
                {!proof ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Select a proof.</p>
                ) : (
                  <DecisionPanel
                    openCount={proof.openCount}
                    pending={recordDecision.isPending}
                    decisions={decisions}
                    onSubmit={(decision, note, applyToPackage) =>
                      recordDecision.mutate(
                        { proofId: proof.id, data: { decision, note: note || undefined, applyToPackage } },
                        {
                          onSuccess: () => {
                            invalidateProof()
                            queryClient.invalidateQueries({ queryKey: getGetPackageQueryKey(packageId) })
                            toast.success("Decision recorded")
                          },
                          onError: () => toast.error("Failed to record decision"),
                        },
                      )
                    }
                  />
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  )
}

function AnnotationMark({
  ann, index, active, onSelect,
}: {
  ann: ProofAnnotation; index: number; active: boolean; onSelect: () => void
}) {
  const color = ann.resolved ? "#22C55E" : "#1F47FF"
  if (ann.kind === "box") {
    return (
      <div
        onClick={(e) => { e.stopPropagation(); onSelect() }}
        className={cn("absolute rounded-sm cursor-pointer", active && "ring-2 ring-offset-1 ring-primary")}
        style={{
          left: `${ann.x * 100}%`,
          top: `${ann.y * 100}%`,
          width: `${ann.w * 100}%`,
          height: `${ann.h * 100}%`,
          border: `2px solid ${color}`,
          background: `${color}22`,
          pointerEvents: "auto",
        }}
      >
        <span
          className="absolute -top-2.5 -left-2.5 flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold text-white"
          style={{ background: color }}
        >{index}</span>
      </div>
    )
  }
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onSelect() }}
      className={cn("absolute -translate-x-1/2 -translate-y-full cursor-pointer", active && "drop-shadow-lg")}
      style={{ left: `${ann.x * 100}%`, top: `${ann.y * 100}%`, pointerEvents: "auto" }}
    >
      <div className="relative">
        <MapPin className="w-7 h-7" style={{ color, fill: `${color}55` }} />
        <span className="absolute top-0.5 left-1/2 -translate-x-1/2 text-[10px] font-bold text-white">{index}</span>
      </div>
    </div>
  )
}

function ThreadCard({
  ann, index, onClose, onResolve, onDelete, onReply,
}: {
  ann: ProofAnnotation
  index: number
  onClose: () => void
  onResolve: (resolved: boolean) => void
  onDelete: () => void
  onReply: (body: string, done: () => void) => void
}) {
  const [reply, setReply] = useState("")
  const [sending, setSending] = useState(false)
  const submit = () => {
    if (!reply.trim()) return
    setSending(true)
    onReply(reply.trim(), () => { setReply(""); setSending(false) })
  }
  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5">
      <div className="flex items-center justify-between gap-2 p-3 border-b border-border">
        <span className="flex items-center gap-2 font-semibold text-sm">
          <span className={cn(
            "flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold text-white",
            ann.resolved ? "bg-success" : "bg-primary",
          )}>{index}</span>
          Markup thread
        </span>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>Back</Button>
      </div>
      <div className="p-3 space-y-3 max-h-64 overflow-y-auto">
        {ann.comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          ann.comments.map((c) => (
            <div key={c.id} className="text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{c.authorName}</span>
                <span className="text-[11px] text-muted-foreground">{timeAgo(c.createdAt)}</span>
              </div>
              <p className="text-foreground/80 mt-0.5 whitespace-pre-wrap">{c.body}</p>
            </div>
          ))
        )}
      </div>
      <div className="p-3 border-t border-border space-y-2">
        <Textarea
          placeholder="Reply…"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          className="min-h-16 resize-none text-sm"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1">
            <Button
              variant={ann.resolved ? "outline" : "default"}
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => onResolve(!ann.resolved)}
            >
              {ann.resolved ? <><RotateCcw className="w-3.5 h-3.5" /> Reopen</> : <><Check className="w-3.5 h-3.5" /> Resolve</>}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onDelete}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
          <Button size="sm" className="h-8 gap-1.5" onClick={submit} disabled={sending || !reply.trim()}>
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}

function GeneralComments({
  comments, onAdd,
}: {
  comments: { id: number; body: string; authorName: string; createdAt: string }[]
  onAdd: (body: string, done: () => void) => void
}) {
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const submit = () => {
    if (!text.trim()) return
    setSending(true)
    onAdd(text.trim(), () => { setText(""); setSending(false) })
  }
  return (
    <div className="pt-2 mt-2 border-t border-border">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">General discussion</p>
      <div className="space-y-3 mb-3">
        {comments.map((c) => (
          <div key={c.id} className="text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">{c.authorName}</span>
              <span className="text-[11px] text-muted-foreground">{timeAgo(c.createdAt)}</span>
            </div>
            <p className="text-foreground/80 mt-0.5 whitespace-pre-wrap">{c.body}</p>
          </div>
        ))}
      </div>
      <Textarea
        placeholder="Add a general comment about this proof…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-16 resize-none text-sm"
      />
      <div className="flex justify-end mt-2">
        <Button size="sm" className="h-8 gap-1.5" onClick={submit} disabled={sending || !text.trim()}>
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Post
        </Button>
      </div>
    </div>
  )
}

function DecisionPanel({
  openCount, pending, decisions, onSubmit,
}: {
  openCount: number
  pending: boolean
  decisions: { id: number; decision: string; note?: string | null; reviewerName: string; createdAt: string }[]
  onSubmit: (decision: string, note: string, applyToPackage: boolean) => void
}) {
  const [choice, setChoice] = useState<string>("approved")
  const [note, setNote] = useState("")
  const [apply, setApply] = useState(true)

  const OPTIONS: { value: string; label: string; icon: React.ComponentType<{ className?: string }>; cls: string }[] = [
    { value: "approved", label: "Approve", icon: CheckCircle2, cls: "text-success border-success/40 data-[on=true]:bg-success/10" },
    { value: "changes_requested", label: "Request Changes", icon: RotateCcw, cls: "text-warning border-warning/40 data-[on=true]:bg-warning/10" },
    { value: "rejected", label: "Reject", icon: XCircle, cls: "text-destructive border-destructive/40 data-[on=true]:bg-destructive/10" },
  ]

  return (
    <div className="space-y-4">
      {openCount > 0 && (
        <div className="flex items-center gap-2 text-xs text-warning bg-warning/10 border border-warning/30 rounded-lg p-2.5">
          <CircleDot className="w-4 h-4 shrink-0" />
          {openCount} open markup{openCount === 1 ? "" : "s"} still unresolved.
        </div>
      )}
      <div className="space-y-2">
        {OPTIONS.map((o) => {
          const Icon = o.icon
          const on = choice === o.value
          return (
            <button
              key={o.value}
              data-on={on}
              onClick={() => setChoice(o.value)}
              className={cn(
                "w-full flex items-center gap-2.5 rounded-lg border p-3 text-sm font-medium transition-colors",
                o.cls,
                on ? "" : "opacity-70 hover:opacity-100",
              )}
            >
              <Icon className="w-4 h-4" />
              {o.label}
              {on && <Check className="w-4 h-4 ml-auto" />}
            </button>
          )
        })}
      </div>
      <Textarea
        placeholder="Add a note for the record (optional)…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="min-h-20 resize-none text-sm"
      />
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">Apply decision to package status</span>
        <Switch checked={apply} onCheckedChange={setApply} />
      </label>
      <Button className="w-full gap-1.5" disabled={pending} onClick={() => onSubmit(choice, note, apply)}>
        {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        Record Decision
      </Button>

      {decisions.length > 0 && (
        <div className="pt-3 border-t border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Decision history</p>
          <div className="space-y-2">
            {decisions.map((d) => (
              <div key={d.id} className="text-sm rounded-lg border border-border p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium capitalize">{d.decision.replace(/_/g, " ")}</span>
                  <span className="text-[11px] text-muted-foreground">{timeAgo(d.createdAt)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">{d.reviewerName}</p>
                {d.note && <p className="text-foreground/80 mt-1">{d.note}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function ProofingIndex() {
  const { data: packages = [], isLoading } = useListPackages(undefined, {
    query: { queryKey: getListPackagesQueryKey() },
  })
  return (
    <div className="animate-in fade-in duration-300">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Proofing Studio</h1>
        <p className="text-muted-foreground mt-1">
          Pick a package to open its proof viewer — upload artwork, mark it up, discuss, and approve.
        </p>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : packages.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No packages yet.</CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((p) => (
            <Link key={p.id} href={`/proofing/${p.id}`}>
              <Card className="hover:border-primary transition-colors cursor-pointer h-full">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base truncate">{p.name}</CardTitle>
                    <Badge variant={STATUS_VARIANT[p.status] ?? "outline"} className="shrink-0">{p.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-sm text-muted-foreground">{p.sku} · {p.vendor}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
