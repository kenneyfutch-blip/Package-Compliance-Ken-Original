import {
  useGetPackageExtraction,
  useGetDocumentAiStatus,
  useReprocessPackage,
  getGetPackageExtractionQueryKey,
  getGetPackageQueryKey,
  type ExtractedComponent,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ScanText, Loader2, RefreshCw, FileText, CheckCircle2,
  AlertCircle, Layers, Cpu, Settings2,
} from "lucide-react"

function statusVariant(status: string): { label: string; className: string } {
  switch (status) {
    case "Complete":
      return { label: "Complete", className: "bg-success/10 text-success border-success/20" }
    case "Processing":
    case "Pending":
      return { label: status, className: "bg-warning/10 text-warning border-warning/20" }
    case "Failed":
      return { label: "Failed", className: "bg-destructive/10 text-destructive border-destructive/20" }
    default:
      return { label: status, className: "bg-muted text-muted-foreground border-border" }
  }
}

export function DocumentAiTab({ packageId }: { packageId: number }) {
  const queryClient = useQueryClient()
  const { data: status } = useGetDocumentAiStatus()
  const { data: extraction, isLoading } = useGetPackageExtraction(packageId, {
    query: { enabled: !!packageId, queryKey: getGetPackageExtractionQueryKey(packageId) },
  })
  const reprocess = useReprocessPackage()

  const handleReprocess = () => {
    reprocess.mutate({ id: packageId }, {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getGetPackageExtractionQueryKey(packageId) })
        queryClient.setQueryData(getGetPackageQueryKey(packageId), data.package)
      },
    })
  }

  const configured = status?.configured ?? false

  // Group extracted components by taxonomy type for display.
  const grouped = new Map<string, ExtractedComponent[]>()
  for (const c of extraction?.components ?? []) {
    const list = grouped.get(c.type) ?? []
    list.push(c)
    grouped.set(c.type, list)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Engine header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <ScanText className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="font-semibold text-sm flex items-center gap-2">
              Google Document AI
              {configured ? (
                <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/20">Connected</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">Not configured</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Enterprise OCR & component extraction · {status?.processorType ?? "Layout Parser"}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 shrink-0"
          onClick={handleReprocess}
          disabled={!configured || reprocess.isPending}
        >
          {reprocess.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Reprocess
        </Button>
      </div>

      {/* Not configured notice */}
      {!configured && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm space-y-2">
          <div className="flex items-center gap-2 font-medium text-warning">
            <AlertCircle className="w-4 h-4" /> Document AI is not connected yet
          </div>
          <p className="text-muted-foreground">
            Add these secure environment variables to enable enterprise extraction. Until then,
            analysis falls back to any text supplied at upload time.
          </p>
          <ul className="grid grid-cols-2 gap-1.5 font-mono text-xs text-muted-foreground pt-1">
            <li className={status?.projectConfigured ? "text-success" : ""}>GOOGLE_PROJECT_ID</li>
            <li className={status?.locationConfigured ? "text-success" : ""}>GOOGLE_LOCATION</li>
            <li className={status?.processorConfigured ? "text-success" : ""}>DOCUMENT_AI_PROCESSOR_ID</li>
            <li className={status?.serviceAccountConfigured ? "text-success" : ""}>DOCUMENT_AI_SERVICE_ACCOUNT</li>
          </ul>
        </div>
      )}

      {/* No extraction yet */}
      {configured && !extraction && (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>No extraction has run for this package yet.</p>
          <p className="text-sm mt-1">Upload a new version or click Reprocess to run Document AI.</p>
        </div>
      )}

      {extraction && (
        <>
          {/* Extraction metadata */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg border border-border bg-accent/40">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Status</div>
              <Badge variant="outline" className={`mt-1 text-xs ${statusVariant(extraction.status).className}`}>{statusVariant(extraction.status).label}</Badge>
            </div>
            <div className="p-3 rounded-lg border border-border bg-accent/40">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Layers className="w-3 h-3" /> Pages</div>
              <div className="text-lg font-bold mt-0.5">{extraction.pageCount}</div>
            </div>
            <div className="p-3 rounded-lg border border-border bg-accent/40">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Cpu className="w-3 h-3" /> Confidence</div>
              <div className="text-lg font-bold mt-0.5">
                {extraction.confidence != null ? `${Math.round(extraction.confidence * 100)}%` : "—"}
              </div>
            </div>
          </div>

          {extraction.status === "Failed" && extraction.error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {extraction.error}
            </div>
          )}

          {/* Extracted components */}
          {grouped.size > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Detected Components</h4>
              <div className="grid grid-cols-2 gap-3">
                {[...grouped.entries()].map(([type, items]) => (
                  <div key={type} className="p-3 bg-accent/50 rounded-lg border border-border">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{type}</span>
                      <Badge variant="outline" className="text-[9px] opacity-70">{items[0]?.source === "documentai" ? "AI" : "pattern"}</Badge>
                    </div>
                    <span className="text-sm break-words">{items.map((i) => i.text).join(", ")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cached OCR text */}
          {extraction.text && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <Settings2 className="w-3.5 h-3.5" /> Extracted Text (cached)
              </h4>
              <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/40 border border-border rounded-lg p-3 max-h-72 overflow-y-auto">
                {extraction.text}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  )
}
