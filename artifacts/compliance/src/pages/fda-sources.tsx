import { useGetFdaStatus, getGetFdaStatusQueryKey } from "@workspace/api-client-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Loader2, CheckCircle2, XCircle, ExternalLink, Database,
  Landmark, RefreshCw, ShieldCheck
} from "lucide-react"

export default function FdaSources() {
  const { data, isLoading, isError, isFetching, refetch } = useGetFdaStatus({
    query: { queryKey: getGetFdaStatusQueryKey() },
  })

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary" /> Regulatory Sources
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live FDA (openFDA) data sources the review engine consults, by product category.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-md border border-border hover:bg-accent"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} /> Re-check
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Checking FDA integration…
        </div>
      ) : isError || !data ? (
        <div className="text-center py-12 text-muted-foreground">
          <XCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>Couldn't load FDA integration status.</p>
        </div>
      ) : (
        <>
          {/* Status cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium">Integration</CardTitle>
              </CardHeader>
              <CardContent>
                {data.configured ? (
                  <div className="flex items-center gap-2 text-success font-semibold">
                    <CheckCircle2 className="w-5 h-5" /> Configured
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-destructive font-semibold">
                    <XCircle className="w-5 h-5" /> Not configured
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {data.configured
                    ? "openFDA API key is present on the server."
                    : "Set the OPENFDA_API_KEY secret to enable live FDA data."}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium">Connectivity</CardTitle>
              </CardHeader>
              <CardContent>
                {data.reachable ? (
                  <div className="flex items-center gap-2 text-success font-semibold">
                    <CheckCircle2 className="w-5 h-5" /> Reachable
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-warning font-semibold">
                    <XCircle className="w-5 h-5" /> Unreachable
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  Last checked {new Date(data.checkedAt).toLocaleString()}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium">Categories Covered</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 font-semibold">
                  <Database className="w-5 h-5 text-primary" /> {data.catalog.length}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Product categories mapped to FDA datasets.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Catalog */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.catalog.map((entry) => (
              <Card key={entry.category}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>{entry.label}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">{entry.category}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                      Data sources
                    </p>
                    <div className="space-y-2">
                      {entry.sources.map((s) => (
                        <div key={s.id} className="p-2 rounded-md bg-accent/40 border border-border">
                          <div className="text-sm font-medium">{s.label}</div>
                          <div className="text-xs text-muted-foreground">{s.description}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                      <Landmark className="w-3.5 h-3.5" /> Regulatory references
                    </p>
                    <div className="space-y-1">
                      {entry.references.map((r, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-muted border border-border shrink-0">{r.code}</span>
                          <span className="text-foreground/80">{r.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {entry.links.length > 0 && (
                    <div className="flex flex-wrap gap-3 pt-1">
                      {entry.links.map((l, i) => (
                        <a key={i} href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          {l.label} <ExternalLink className="w-3 h-3" />
                        </a>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">{data.disclaimer}</p>
        </>
      )}
    </div>
  )
}
