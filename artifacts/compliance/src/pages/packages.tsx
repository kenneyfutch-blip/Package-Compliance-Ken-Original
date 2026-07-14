import { useState, useEffect, useRef } from "react"
import * as pdfjsLib from "pdfjs-dist"
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import {
  useListPackages,
  useUpdatePackage,
  useDeletePackage,
  getListPackagesQueryKey,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Link, useSearch } from "wouter"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Search,
  Loader2,
  ArrowRight,
  Clock,
  PackageX,
  MoreVertical,
  Archive,
  ArchiveRestore,
  Trash2,
  Loader2 as Spinner,
  ImageOff,
  FileText,
} from "lucide-react"
import { servingUrl, fileTypeFromName } from "@/lib/proof-utils"

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
import { gradeColor, riskBand } from "@/lib/compliance"
import { usePermissions } from "@/lib/access"
import { useToast } from "@/hooks/use-toast"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface Props {
  title: string
  subtitle: string
  statusFilter?: string
  riskFilter?: string
  emptyText?: string
}

// Small artwork thumbnail shown at the top of each package card. Reuses the
// same URL resolver the review workspace uses so object-storage, seed, and
// public artwork all render. Falls back to a typed placeholder for PDFs / vector
// source files (.ai/.indd) and for missing or broken images.
// Renders the first page of a PDF to a canvas so the package card shows the real
// artwork proof instead of a generic placeholder. Falls back (via onFail) to the
// placeholder if the file isn't actually a readable PDF.
function PdfThumbnail({ src, onFail }: { src: string; onFail: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    setReady(false)
    const loadingTask = pdfjsLib.getDocument(src)
    let renderTask: pdfjsLib.RenderTask | null = null
    ;(async () => {
      try {
        const doc = await loadingTask.promise
        if (cancelled) return
        const page = await doc.getPage(1)
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(2, 480 / base.width)
        const viewport = page.getViewport({ scale })
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        renderTask = page.render({ canvasContext: ctx, viewport })
        await renderTask.promise
        if (!cancelled) setReady(true)
      } catch {
        if (!cancelled) onFail()
      }
    })()
    return () => {
      cancelled = true
      try { renderTask?.cancel() } catch { /* noop */ }
      // destroy() aborts an in-flight getDocument and frees the document +
      // worker resources — important since the list can hold many cards.
      void loadingTask.destroy().catch(() => { /* noop */ })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  return (
    <div className="flex h-full w-full items-center justify-center bg-white">
      {!ready && <Loader2 className="absolute h-6 w-6 animate-spin text-muted-foreground/40" />}
      <canvas ref={canvasRef} className="max-h-full max-w-full" />
    </div>
  )
}

function ArtworkPreview({ url, name }: { url: string | null | undefined; name: string }) {
  const [broken, setBroken] = useState(false)
  const [pdfFailed, setPdfFailed] = useState(false)
  const src = servingUrl(url)
  const type = url ? fileTypeFromName(url) : "other"
  const isImage = type === "png" || type === "jpg"
  const isTrackedOnly = type === "ai" || type === "indd"
  const showImage = Boolean(src) && isImage && !broken
  // Render a PDF thumbnail for PDFs and for legacy extensionless uploads (type
  // "other"), which in this app are almost always PDF artwork proofs. Native
  // source files (.ai/.indd) can't be rasterized in the browser.
  const showPdf = Boolean(src) && !isImage && !isTrackedOnly && !pdfFailed

  return (
    <div className="relative aspect-[16/9] w-full overflow-hidden rounded-t-md border-b border-border bg-muted">
      {showImage ? (
        <img
          src={src!}
          alt={`${name} artwork`}
          loading="lazy"
          className="h-full w-full object-contain"
          onError={() => setBroken(true)}
        />
      ) : showPdf ? (
        <PdfThumbnail src={src!} onFail={() => setPdfFailed(true)} />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
          {isTrackedOnly ? (
            <>
              <FileText className="h-7 w-7" />
              <span className="text-[10px] font-medium uppercase tracking-wide">
                {type} file
              </span>
            </>
          ) : (
            <>
              <ImageOff className="h-7 w-7" />
              <span className="text-[10px] font-medium uppercase tracking-wide">
                No preview
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function PackageCardMenu({
  pkg,
  archived,
}: {
  pkg: { id: number; name: string; status: string }
  archived: boolean
}) {
  const { has } = usePermissions()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const update = useUpdatePackage()
  const remove = useDeletePackage()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const canArchive = has("packages:write")
  const canDelete = has("packages:delete")
  // Nothing to show if the user can neither archive/restore nor delete.
  if (!canArchive && !canDelete) return null

  const busy = update.isPending || remove.isPending

  const refetchLists = () =>
    queryClient.invalidateQueries({ queryKey: getListPackagesQueryKey() })

  const setStatus = (status: string, verb: string) =>
    update.mutate(
      { id: pkg.id, data: { status } },
      {
        onSuccess: () => {
          refetchLists()
          toast({ title: `Package ${verb}`, description: `"${pkg.name}" was ${verb}.` })
        },
        onError: () =>
          toast({
            variant: "destructive",
            title: `Could not ${verb === "archived" ? "archive" : "restore"} package`,
            description: "Something went wrong. Please try again.",
          }),
      },
    )

  const doDelete = () =>
    remove.mutate(
      { id: pkg.id },
      {
        onSuccess: () => {
          setConfirmOpen(false)
          refetchLists()
          toast({ title: "Package deleted", description: `"${pkg.name}" was permanently deleted.` })
        },
        onError: () =>
          toast({
            variant: "destructive",
            title: "Could not delete package",
            description: "Something went wrong. Please try again.",
          }),
      },
    )

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Package actions"
            disabled={busy}
          >
            {busy ? (
              <Spinner className="w-4 h-4 animate-spin" />
            ) : (
              <MoreVertical className="w-4 h-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canArchive &&
            (archived ? (
              <DropdownMenuItem onSelect={() => setStatus("Uploaded", "restored")}>
                <ArchiveRestore className="w-4 h-4 mr-2" /> Restore
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => setStatus("Archived", "archived")}>
                <Archive className="w-4 h-4 mr-2" /> Archive
              </DropdownMenuItem>
            ))}
          {canDelete && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={(e) => {
                e.preventDefault()
                setConfirmOpen(true)
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this package?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <span className="font-medium">"{pkg.name}"</span> and its
              violations. This cannot be undone. To keep the record but remove it from active views,
              archive it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                doDelete()
              }}
              disabled={remove.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {remove.isPending ? (
                <>
                  <Spinner className="w-4 h-4 mr-2 animate-spin" /> Deleting…
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default function PackagesView({
  title,
  subtitle,
  statusFilter,
  riskFilter,
  emptyText,
}: Props) {
  const searchString = useSearch()
  const initialQ = new URLSearchParams(searchString).get("q") ?? ""
  const [search, setSearch] = useState(initialQ)
  useEffect(() => {
    setSearch(initialQ)
  }, [initialQ])
  const { data: packages = [], isLoading } = useListPackages({
    search,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(riskFilter ? { risk: riskFilter } : {}),
  })

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground mt-1">{subtitle}</p>
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, SKU, vendor..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {!isLoading && packages.length > 0 && (
        <div className="text-sm text-muted-foreground">
          {packages.length} package{packages.length === 1 ? "" : "s"}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : packages.length === 0 ? (
        <div className="text-center py-24 border border-dashed rounded-xl bg-card">
          <PackageX className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-lg font-medium">No packages here</p>
          <p className="text-muted-foreground mt-1">
            {emptyText ?? "Nothing matches this view yet."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {packages.map((pkg) => {
            const band = riskBand(pkg.riskScore)
            return (
              <Card
                key={pkg.id}
                className="flex flex-col hover-elevate transition-all border-t-4 overflow-hidden"
                style={{ borderTopColor: band.border }}
              >
                <ArtworkPreview url={pkg.artworkUrl} name={pkg.name} />
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-xs font-mono text-muted-foreground mb-1">{pkg.sku}</div>
                      <h3 className="font-semibold text-lg leading-tight line-clamp-2">{pkg.name}</h3>
                      <div className="text-sm text-muted-foreground mt-1">{pkg.vendor} • {pkg.brand}</div>
                    </div>
                    {pkg.grade && (
                      <div className={`text-3xl font-black ${gradeColor(pkg.grade)}`}>{pkg.grade}</div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 pb-3">
                  <div className="flex flex-wrap gap-2 mb-4">
                    <Badge variant="outline">{pkg.status}</Badge>
                    {pkg.category && <Badge variant="outline">{pkg.category}</Badge>}
                    <Badge variant={band.badge}>{band.label} risk</Badge>
                  </div>
                  <div className="space-y-2 text-sm bg-accent/50 p-3 rounded-lg">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Risk Score</span>
                      <span className="font-mono font-medium">{pkg.riskScore ?? 0}/100</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Violations</span>
                      <div className="flex gap-2">
                        {pkg.criticalCount > 0 && <span className="text-destructive font-semibold">{pkg.criticalCount} Crit</span>}
                        {pkg.majorCount > 0 && <span className="text-warning font-semibold">{pkg.majorCount} Maj</span>}
                        {pkg.criticalCount === 0 && pkg.majorCount === 0 && <span className="text-success font-medium">None</span>}
                      </div>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="pt-0 justify-between border-t border-border mt-auto p-4">
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {new Date(pkg.updatedAt).toLocaleDateString()}
                  </div>
                  <div className="flex items-center gap-1">
                    <PackageCardMenu
                      pkg={{ id: pkg.id, name: pkg.name, status: pkg.status }}
                      archived={(statusFilter ?? pkg.status) === "Archived"}
                    />
                    <Link href={`/reviews/${pkg.id}`}>
                      <Button variant="ghost" size="sm" className="gap-1">
                        Open <ArrowRight className="w-4 h-4" />
                      </Button>
                    </Link>
                  </div>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
