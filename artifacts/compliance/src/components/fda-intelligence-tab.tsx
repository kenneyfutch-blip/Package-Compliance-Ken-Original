import { useGetFdaIntelligence, getGetFdaIntelligenceQueryKey } from "@workspace/api-client-react"
import { Badge } from "@/components/ui/badge"
import {
  Loader2, ShieldAlert, AlertTriangle, Info, ExternalLink,
  BookMarked, FileSearch, Landmark, WifiOff
} from "lucide-react"

function SeverityIcon({ severity }: { severity?: string }) {
  if (severity === "critical") return <ShieldAlert className="w-4 h-4 text-destructive shrink-0" />
  if (severity === "major") return <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
  return <Info className="w-4 h-4 text-muted-foreground shrink-0" />
}

function findingClasses(severity?: string) {
  if (severity === "critical") return "border-destructive/30 bg-destructive/5"
  if (severity === "major") return "border-warning/30 bg-warning/5"
  return "border-border bg-card"
}

export function FdaIntelligenceTab({ packageId }: { packageId: number }) {
  const { data, isLoading, isError } = useGetFdaIntelligence(
    { packageId },
    {
      query: {
        enabled: !!packageId,
        queryKey: getGetFdaIntelligenceQueryKey({ packageId }),
      },
    },
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Consulting FDA sources…
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <WifiOff className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p>Couldn't reach the FDA intelligence service.</p>
        <p className="text-sm mt-1">Review can continue on internal standards.</p>
      </div>
    )
  }

  const hasSignal =
    data.warnings.length > 0 ||
    data.findings.length > 0 ||
    data.labelExamples.length > 0

  return (
    <div className="space-y-6">
      {/* Category + applicable sources */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
            Detected category
          </span>
          <Badge variant={data.detectedCategory ? "default" : "outline"}>
            {data.categoryLabel}
          </Badge>
          {data.searchTerm && (
            <span className="text-xs text-muted-foreground">
              matched on “{data.searchTerm}”
            </span>
          )}
        </div>
        {data.applicableSources.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {data.applicableSources.map((s) => (
              <Badge key={s.id} variant="outline" className="font-normal" title={s.description}>
                {s.label}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Availability / degradation notices */}
      {data.message && (
        <div className="p-3 rounded-lg border border-warning/30 bg-warning/5 text-sm flex items-start gap-2">
          <Info className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <span>{data.message}</span>
        </div>
      )}
      {data.degraded && !data.message && (
        <div className="p-3 rounded-lg border border-border bg-muted/30 text-sm flex items-start gap-2">
          <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <span>Some FDA sources were unavailable; results may be partial.</span>
        </div>
      )}

      {/* Warnings */}
      {data.warnings.length > 0 && (
        <div className="space-y-3">
          <h4 className="flex items-center gap-2 font-bold text-destructive">
            <ShieldAlert className="w-4 h-4" /> FDA Warnings & Alerts
          </h4>
          {data.warnings.map((w, i) => (
            <div key={i} className={`p-3 rounded-lg border space-y-1 ${findingClasses(w.severity)}`}>
              <div className="flex items-start gap-2">
                <SeverityIcon severity={w.severity} />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start gap-2">
                    <h5 className="font-semibold text-sm">{w.title}</h5>
                    <Badge variant="outline" className="text-[10px] shrink-0">{w.source}</Badge>
                  </div>
                  <p className="text-sm text-foreground/80 mt-1">{w.detail}</p>
                  {w.date && <p className="text-xs text-muted-foreground mt-1">Reported {w.date}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Findings */}
      {data.findings.length > 0 && (
        <div className="space-y-3">
          <h4 className="flex items-center gap-2 font-bold">
            <FileSearch className="w-4 h-4 text-primary" /> Related FDA Activity
          </h4>
          {data.findings.map((f, i) => (
            <div key={i} className={`p-3 rounded-lg border space-y-1 ${findingClasses(f.severity)}`}>
              <div className="flex justify-between items-start gap-2">
                <h5 className="font-medium text-sm">{f.title}</h5>
                <Badge variant="outline" className="text-[10px] shrink-0">{f.source}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{f.detail}</p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {f.date && <span>Reported {f.date}</span>}
                {f.url && (
                  <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    View at FDA <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Label examples */}
      {data.labelExamples.length > 0 && (
        <div className="space-y-3">
          <h4 className="flex items-center gap-2 font-bold">
            <BookMarked className="w-4 h-4 text-primary" /> Reference Labeling
          </h4>
          {data.labelExamples.map((ex, i) => (
            <div key={i} className="p-3 rounded-lg border border-border bg-accent/40 space-y-1">
              <h5 className="font-medium text-sm">{ex.title}</h5>
              <p className="text-sm text-muted-foreground">{ex.description}</p>
              {ex.url && (
                <a href={ex.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  View labeling <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Regulatory references */}
      {data.references.length > 0 && (
        <div className="space-y-3">
          <h4 className="flex items-center gap-2 font-bold">
            <Landmark className="w-4 h-4 text-primary" /> Regulatory References
          </h4>
          <div className="space-y-2">
            {data.references.map((r, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted border border-border shrink-0">{r.code}</span>
                <span className="text-foreground/80">{r.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No signal but sources ran */}
      {data.available && data.detectedCategory && !hasSignal && !data.message && (
        <div className="text-center py-8 text-muted-foreground">
          <FileSearch className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No matching FDA recalls, warnings, or adverse events found.</p>
          <p className="text-sm mt-1">Regulatory references still apply — see below.</p>
        </div>
      )}

      {/* Source links + disclaimer */}
      {data.sourceLinks.length > 0 && (
        <div className="flex flex-wrap gap-3 pt-2 border-t border-border">
          {data.sourceLinks.map((l, i) => (
            <a key={i} href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              {l.label} <ExternalLink className="w-3 h-3" />
            </a>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground leading-relaxed">{data.disclaimer}</p>
    </div>
  )
}
