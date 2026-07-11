import * as React from "react"
import * as pdfjsLib from "pdfjs-dist"
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import {
  ZoomIn, ZoomOut, RotateCw, Maximize, Minus, Plus,
  ChevronLeft, ChevronRight, Hand, MapPin, Square, Highlighter,
  Circle as CircleIcon, MoveUpRight, Strikethrough, Type, Eye, EyeOff, FileWarning,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  type MarkupTool, DRAG_TOOLS, findingClassMeta, HUMAN_MARKUP_COLOR, servingUrl,
} from "@/lib/proof-utils"

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export type ViewerAnnotation = {
  id: number
  type: string
  page: number
  x: number | null | undefined
  y: number | null | undefined
  w: number | null | undefined
  h: number | null | undefined
  color: string | null | undefined
  source: string
  status: string
  text: string | null | undefined
  findingClass?: string | null
  index: number
}

export type AnnotationDraft = {
  type: MarkupTool
  page: number
  x: number
  y: number
  w: number | null
  h: number | null
}

type Props = {
  fileUrl: string | null
  fileType: string | null
  pageCount: number
  annotations: ViewerAnnotation[]
  selectedId: number | null
  activeTool: MarkupTool
  onToolChange: (tool: MarkupTool) => void
  onSelect: (id: number | null) => void
  onCreate: (draft: AnnotationDraft) => void
  showAi: boolean
  showHuman: boolean
  onToggleAi: () => void
  onToggleHuman: () => void
}

const TOOLS: { tool: MarkupTool; icon: React.ElementType; label: string }[] = [
  { tool: "hand", icon: Hand, label: "Pan / select" },
  { tool: "pin", icon: MapPin, label: "Pin comment" },
  { tool: "rectangle", icon: Square, label: "Rectangle" },
  { tool: "highlight", icon: Highlighter, label: "Highlight" },
  { tool: "circle", icon: CircleIcon, label: "Circle" },
  { tool: "arrow", icon: MoveUpRight, label: "Arrow" },
  { tool: "strikethrough", icon: Strikethrough, label: "Strikethrough" },
  { tool: "text", icon: Type, label: "Text note" },
]

function PdfPage({ fileUrl, page, onRendered }: { fileUrl: string; page: number; onRendered?: () => void }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    let cancelled = false
    let task: pdfjsLib.RenderTask | null = null
    ;(async () => {
      try {
        const doc = await pdfjsLib.getDocument(fileUrl).promise
        if (cancelled) return
        const pdfPage = await doc.getPage(page)
        const viewport = pdfPage.getViewport({ scale: 2 })
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        task = pdfPage.render({ canvasContext: ctx, viewport })
        await task.promise
        if (!cancelled) onRendered?.()
      } catch {
        /* ignore render errors */
      }
    })()
    return () => {
      cancelled = true
      try { task?.cancel() } catch { /* noop */ }
    }
  }, [fileUrl, page])
  return <canvas ref={canvasRef} className="block w-full h-auto" />
}

export function ProofViewer(props: Props) {
  const {
    fileUrl, fileType, pageCount, annotations, selectedId, activeTool, onToolChange,
    onSelect, onCreate, showAi, showHuman, onToggleAi, onToggleHuman,
  } = props

  const [zoom, setZoom] = React.useState(1)
  const [rotation, setRotation] = React.useState(0)
  const [page, setPage] = React.useState(0)
  const [drag, setDrag] = React.useState<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const [pan, setPan] = React.useState({ x: 0, y: 0 })
  const [panning, setPanning] = React.useState(false)
  const panStart = React.useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const layerRef = React.useRef<HTMLDivElement>(null)

  const src = servingUrl(fileUrl)
  const isPdf = fileType === "pdf"
  const isImage = fileType === "png" || fileType === "jpg"
  const trackedOnly = fileType === "ai" || fileType === "indd"

  React.useEffect(() => { setPage(0); setPan({ x: 0, y: 0 }); setZoom(1); setRotation(0) }, [fileUrl])

  const zoomIn = () => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))
  const zoomOut = () => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))
  const fit = () => { setZoom(1); setRotation(0); setPan({ x: 0, y: 0 }) }
  const rotate = () => setRotation((r) => (r + 90) % 360)

  // Drag-to-pan when the hand tool is active (works at any zoom level).
  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (activeTool !== "hand") return
    panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
    setPanning(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onCanvasPointerMove = (e: React.PointerEvent) => {
    const start = panStart.current
    if (!start) return
    setPan({ x: start.px + (e.clientX - start.x), y: start.py + (e.clientY - start.y) })
  }
  const onCanvasPointerUp = (e: React.PointerEvent) => {
    if (!panStart.current) return
    panStart.current = null
    setPanning(false)
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  }

  const toLocal = (clientX: number, clientY: number) => {
    const rect = layerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (activeTool === "hand") return
    const p = toLocal(e.clientX, e.clientY)
    if (activeTool === "pin" || activeTool === "text") {
      onCreate({ type: activeTool, page, x: p.x, y: p.y, w: null, h: null })
      return
    }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    setDrag({ x: p.x, y: p.y, cx: p.x, cy: p.y })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    const p = toLocal(e.clientX, e.clientY)
    setDrag({ ...drag, cx: p.x, cy: p.y })
  }

  const onPointerUp = () => {
    if (!drag) return
    const dx = drag.cx - drag.x
    const dy = drag.cy - drag.y
    if (activeTool === "arrow" || activeTool === "strikethrough") {
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        onCreate({ type: activeTool, page, x: drag.x, y: drag.y, w: dx, h: dy })
      }
    } else if (DRAG_TOOLS.includes(activeTool)) {
      const x = Math.min(drag.x, drag.cx)
      const y = Math.min(drag.y, drag.cy)
      const w = Math.abs(dx)
      const h = Math.abs(dy)
      if (w > 0.01 && h > 0.01) onCreate({ type: activeTool, page, x, y, w, h })
    }
    setDrag(null)
  }

  const pageAnnotations = annotations.filter((a) => (a.page ?? 0) === page)
    .filter((a) => (a.source === "ai" ? showAi : showHuman))

  return (
    <div className="flex flex-col h-full bg-accent/30 rounded-xl border border-border overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-2 border-b border-border bg-card shrink-0 flex-wrap">
        <div className="flex items-center gap-0.5 mr-1">
          {TOOLS.map((t) => (
            <Button
              key={t.tool}
              variant={activeTool === t.tool ? "default" : "ghost"}
              size="icon"
              className="h-8 w-8"
              title={t.label}
              onClick={() => onToolChange(t.tool)}
            >
              <t.icon className="w-4 h-4" />
            </Button>
          ))}
        </div>
        <div className="h-6 w-px bg-border mx-1" />
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={zoomOut} title="Zoom out"><ZoomOut className="w-4 h-4" /></Button>
        <span className="text-xs font-mono w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={zoomIn} title="Zoom in"><ZoomIn className="w-4 h-4" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={rotate} title="Rotate"><RotateCw className="w-4 h-4" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fit} title="Fit / reset"><Maximize className="w-4 h-4" /></Button>
        <div className="h-6 w-px bg-border mx-1" />
        <Button variant={showAi ? "secondary" : "ghost"} size="sm" className="h-8 gap-1.5 text-xs" onClick={onToggleAi} title="Toggle AI markers">
          {showAi ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />} AI
        </Button>
        <Button variant={showHuman ? "secondary" : "ghost"} size="sm" className="h-8 gap-1.5 text-xs" onClick={onToggleHuman} title="Toggle reviewer markups">
          {showHuman ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />} Reviewer
        </Button>
        {isPdf && pageCount > 1 && (
          <div className="flex items-center gap-1 ml-auto">
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft className="w-4 h-4" /></Button>
            <span className="text-xs font-mono">{page + 1} / {pageCount}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        )}
      </div>

      {/* Canvas */}
      <div
        className={cn(
          "flex-1 overflow-auto p-6 flex items-start justify-center",
          activeTool === "hand" ? (panning ? "cursor-grabbing" : "cursor-grab") : "cursor-crosshair",
        )}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerLeave={onCanvasPointerUp}
      >
        {trackedOnly ? (
          <div className="text-center text-muted-foreground p-12 m-auto">
            <FileWarning className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="font-medium">{fileType?.toUpperCase()} source file (tracked only)</p>
            <p className="text-sm mt-1">Native rendering isn't supported. Analysis runs on extracted copy; upload a PNG/JPG/PDF proof to mark up visually.</p>
          </div>
        ) : !src ? (
          <div className="text-center text-muted-foreground p-12 m-auto">
            <FileWarning className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p>No artwork attached.</p>
            <p className="text-sm mt-1">Analysis performed on extracted text only.</p>
          </div>
        ) : (
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
              transformOrigin: "top center",
              transition: panning ? "none" : "transform 0.15s ease",
            }}
            className="relative shadow-2xl"
          >
            <div className="relative bg-white" style={{ width: 520, maxWidth: "none" }}>
              {isImage && <img src={src} alt="Artwork proof" className="block w-full h-auto select-none" draggable={false} />}
              {isPdf && <PdfPage fileUrl={src} page={page + 1} />}

              {/* Markup layer */}
              <div
                ref={layerRef}
                className="absolute inset-0"
                style={{ touchAction: "none", pointerEvents: activeTool === "hand" ? "none" : "auto" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                {pageAnnotations.map((a) => (
                  <Marker key={a.id} a={a} selected={a.id === selectedId} onSelect={onSelect} interactive={activeTool === "hand"} />
                ))}
                {drag && <DragPreview tool={activeTool} drag={drag} />}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function markerColor(a: ViewerAnnotation): string {
  if (a.color) return a.color
  if (a.source === "ai") return findingClassMeta(a.findingClass).color
  return HUMAN_MARKUP_COLOR
}

function Marker({ a, selected, onSelect, interactive }: { a: ViewerAnnotation; selected: boolean; onSelect: (id: number) => void; interactive: boolean }) {
  const color = markerColor(a)
  const x = (a.x ?? 0) * 100
  const y = (a.y ?? 0) * 100
  const resolved = a.status === "resolved"
  const common: React.CSSProperties = {
    position: "absolute",
    left: `${x}%`,
    top: `${y}%`,
    pointerEvents: interactive ? "auto" : "none",
    opacity: resolved ? 0.45 : 1,
  }
  const click = (e: React.MouseEvent) => { e.stopPropagation(); onSelect(a.id) }
  const ring = selected ? "0 0 0 2px white, 0 0 0 4px " + color : "none"

  if (a.type === "pin" || a.type === "text") {
    return (
      <button type="button" onClick={click} style={{ ...common, transform: "translate(-50%, -100%)" }} title={a.text ?? ""}>
        <span className="flex items-center justify-center rounded-full text-white text-[10px] font-bold shadow-lg"
          style={{ background: color, width: 22, height: 22, boxShadow: ring !== "none" ? ring : "0 2px 6px rgba(0,0,0,.4)" }}>
          {a.type === "text" ? "T" : a.index}
        </span>
      </button>
    )
  }

  const w = (a.w ?? 0) * 100
  const h = (a.h ?? 0) * 100

  if (a.type === "arrow" || a.type === "strikethrough") {
    // encoded as x,y start with w,h signed delta
    const x2 = (a.x ?? 0) + (a.w ?? 0)
    const y2 = (a.y ?? 0) + (a.h ?? 0)
    return (
      <svg style={{ ...common, left: 0, top: 0, width: "100%", height: "100%", transform: "none", overflow: "visible" }}
        onClick={click}>
        <line x1={`${(a.x ?? 0) * 100}%`} y1={`${(a.y ?? 0) * 100}%`} x2={`${x2 * 100}%`} y2={`${y2 * 100}%`}
          stroke={color} strokeWidth={selected ? 4 : 3} strokeLinecap="round"
          markerEnd={a.type === "arrow" ? `url(#arrowhead-${a.id})` : undefined} style={{ pointerEvents: interactive ? "stroke" : "none" }} />
        {a.type === "arrow" && (
          <defs>
            <marker id={`arrowhead-${a.id}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill={color} />
            </marker>
          </defs>
        )}
      </svg>
    )
  }

  const shapeStyle: React.CSSProperties = {
    ...common,
    width: `${w}%`,
    height: `${h}%`,
    border: `2px solid ${color}`,
    background: a.type === "highlight" ? `${color}33` : `${color}14`,
    borderRadius: a.type === "circle" ? "50%" : 6,
    boxShadow: selected ? ring : "none",
    pointerEvents: interactive ? "auto" : "none",
  }
  return <button type="button" onClick={click} style={shapeStyle} title={a.text ?? ""} />
}

function DragPreview({ tool, drag }: { tool: MarkupTool; drag: { x: number; y: number; cx: number; cy: number } }) {
  const color = HUMAN_MARKUP_COLOR
  if (tool === "arrow" || tool === "strikethrough") {
    return (
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
        <line x1={`${drag.x * 100}%`} y1={`${drag.y * 100}%`} x2={`${drag.cx * 100}%`} y2={`${drag.cy * 100}%`}
          stroke={color} strokeWidth={3} strokeDasharray="4 3" strokeLinecap="round" />
      </svg>
    )
  }
  const x = Math.min(drag.x, drag.cx) * 100
  const y = Math.min(drag.y, drag.cy) * 100
  const w = Math.abs(drag.cx - drag.x) * 100
  const h = Math.abs(drag.cy - drag.y) * 100
  return (
    <div style={{
      position: "absolute", left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`,
      border: `2px dashed ${color}`, background: `${color}22`,
      borderRadius: tool === "circle" ? "50%" : 6,
    }} />
  )
}
