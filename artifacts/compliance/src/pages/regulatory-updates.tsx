import { useMemo } from "react"
import { useListRegulations } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, Radio, ArrowUpRight } from "lucide-react"

const AGENCY_TONE: Record<string, "default" | "secondary" | "destructive" | "warning" | "success"> = {
  FDA: "destructive",
  EPA: "success",
  CPSC: "warning",
  FTC: "secondary",
  USDA: "default",
}

export default function RegulatoryUpdates() {
  const { data: regs = [], isLoading } = useListRegulations({})

  const sorted = useMemo(
    () =>
      [...regs].sort((a, b) => {
        const da = new Date(a.publicationDate || a.createdAt).getTime()
        const db = new Date(b.publicationDate || b.createdAt).getTime()
        return db - da
      }),
    [regs],
  )

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Radio className="w-7 h-7 text-primary" /> Regulatory Updates
        </h1>
        <p className="text-muted-foreground mt-1">Recent changes across the regulatory landscape, newest first.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-24 border border-dashed rounded-xl bg-card">
          <p className="text-lg font-medium">No updates yet</p>
          <p className="text-muted-foreground mt-1">Regulatory changes will stream in here.</p>
        </div>
      ) : (
        <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-px before:bg-border">
          {sorted.map((r) => (
            <div key={r.id} className="relative">
              <span className="absolute -left-[18px] top-3 w-3 h-3 rounded-full bg-primary ring-4 ring-background" />
              <Card className="hover-elevate transition-all">
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge variant={AGENCY_TONE[r.agency] ?? "outline"}>{r.agency}</Badge>
                        <Badge variant="outline" className="font-mono">{r.ruleCode}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(r.publicationDate || r.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                        </span>
                      </div>
                      <h3 className="font-semibold leading-tight">{r.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{r.summary}</p>
                    </div>
                    {r.source && (
                      <a href={r.source.startsWith("http") ? r.source : undefined} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary shrink-0">
                        <ArrowUpRight className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="secondary">{r.category}</Badge>
                    {r.section && <Badge variant="outline">§ {r.section}</Badge>}
                  </div>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
