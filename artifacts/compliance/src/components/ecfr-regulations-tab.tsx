import { useGetEcfrIntelligence, getGetEcfrIntelligenceQueryKey } from "@workspace/api-client-react"
import { Badge } from "@/components/ui/badge"
import { Loader2, ExternalLink, Landmark, FileText, WifiOff, Info } from "lucide-react"

export function EcfrRegulationsTab({ packageId }: { packageId: number }) {
  const { data, isLoading, isError } = useGetEcfrIntelligence(
    { packageId },
    {
      query: {
        enabled: !!packageId,
        queryKey: getGetEcfrIntelligenceQueryKey({ packageId }),
      },
    },
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Consulting eCFR regulations…
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <WifiOff className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p>Couldn't load synced eCFR regulations.</p>
        <p className="text-sm mt-1">Review can continue on internal standards.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Detected category */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
          Detected category
        </span>
        <Badge variant={data.detectedCategory ? "default" : "outline"}>
          {data.categoryLabel}
        </Badge>
        {data.searchTerm && (
          <span className="text-xs text-muted-foreground">
            for “{data.searchTerm}”
          </span>
        )}
      </div>

      {/* Availability notice */}
      {data.message && (
        <div className="p-3 rounded-lg border border-warning/30 bg-warning/5 text-sm flex items-start gap-2">
          <Info className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <span>{data.message}</span>
        </div>
      )}

      {/* Applicable sections */}
      {data.sections.length > 0 && (
        <div className="space-y-3">
          <h4 className="flex items-center gap-2 font-bold">
            <Landmark className="w-4 h-4 text-primary" /> Applicable CFR Sections
          </h4>
          {data.sections.map((s, i) => (
            <div key={i} className="p-4 rounded-lg border border-border bg-card space-y-2">
              <div className="flex justify-between items-start gap-3">
                <div className="flex items-start gap-2 min-w-0">
                  <FileText className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted border border-border shrink-0">
                        {s.citation}
                      </span>
                      <h5 className="font-semibold text-sm">{s.heading}</h5>
                    </div>
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  Title {s.title} · Part {s.part}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed pl-6">{s.snippet}</p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground pl-6">
                {s.editionDate && <span>Edition {s.editionDate}</span>}
                {s.url && (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    View on eCFR <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {data.available && data.sections.length === 0 && !data.message && (
        <div className="text-center py-8 text-muted-foreground">
          <Landmark className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No matching eCFR sections found for this product.</p>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground leading-relaxed">{data.disclaimer}</p>
    </div>
  )
}
