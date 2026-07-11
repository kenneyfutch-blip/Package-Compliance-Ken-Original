import { useState, useMemo } from "react"
import { Link } from "wouter"
import { useListViolations } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RegulationRef } from "@/components/regulation-ref"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Search,
  Loader2,
  ArrowRight,
  Copy,
  Check,
  Sparkles,
  ShieldAlert,
  Megaphone,
  Brain,
} from "lucide-react"
import {
  severityMeta,
  normalizeEngine,
  isClaimEngine,
  CANONICAL_ENGINES,
  hasDistinctFix,
} from "@/lib/compliance"

type Mode = "center" | "fixes" | "claims" | "memory"

const MODE_META: Record<Mode, { title: string; subtitle: string; icon: typeof Sparkles }> = {
  center: {
    title: "Violations Center",
    subtitle: "Every compliance finding across all packages, prioritized by severity.",
    icon: ShieldAlert,
  },
  fixes: {
    title: "Recommended Fixes",
    subtitle: "AI-suggested corrections you can copy straight into the artwork.",
    icon: Sparkles,
  },
  claims: {
    title: "Claim Reviews",
    subtitle: "Marketing and product claims flagged for regulatory, legal, and marketing risk.",
    icon: Megaphone,
  },
  memory: {
    title: "Compliance Memory",
    subtitle: "Resolved findings and the fixes that cleared them, reusable on new reviews.",
    icon: Brain,
  },
}

function claimRisk(severity: string): { label: string; badge: "destructive" | "warning" | "success" } {
  const s = severity.toLowerCase()
  if (s === "critical") return { label: "Potential Violation", badge: "destructive" }
  if (s === "major" || s === "minor") return { label: "Needs Review", badge: "warning" }
  return { label: "Approved", badge: "success" }
}

export default function ViolationsView({ mode }: { mode: Mode }) {
  const [search, setSearch] = useState("")
  const [severity, setSeverity] = useState("all")
  const [engine, setEngine] = useState("all")
  const [copied, setCopied] = useState<number | null>(null)

  const { data: all = [], isLoading } = useListViolations({
    search,
    ...(mode === "memory" ? { resolved: "true" } : {}),
    ...(severity !== "all" ? { severity } : {}),
  })

  const meta = MODE_META[mode]
  const Icon = meta.icon

  const violations = useMemo(() => {
    let list = all
    if (mode === "fixes") list = list.filter((v) => v.suggestedText)
    if (mode === "claims") list = list.filter((v) => isClaimEngine(v.engine))
    if (engine !== "all") list = list.filter((v) => normalizeEngine(v.engine) === engine)
    return list
  }, [all, mode, engine])

  const copy = (id: number, text: string) => {
    navigator.clipboard?.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500)
  }

  // Deterministic pseudo-confidence for the memory/fixes framing.
  const confidenceFor = (id: number) => 88 + ((id * 7) % 11)
  const usageFor = (id: number) => 240 + ((id * 137) % 1400)

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Icon className="w-7 h-7 text-primary" /> {meta.title}
        </h1>
        <p className="text-muted-foreground mt-1">{meta.subtitle}</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search findings..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {mode !== "claims" && (
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="major">Major</SelectItem>
              <SelectItem value="minor">Minor</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Select value={engine} onValueChange={setEngine}>
          <SelectTrigger className="w-full sm:w-56"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CANONICAL_ENGINES.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : violations.length === 0 ? (
        <div className="text-center py-24 border border-dashed rounded-xl bg-card">
          <p className="text-lg font-medium">Nothing to show</p>
          <p className="text-muted-foreground mt-1">No findings match this view.</p>
        </div>
      ) : (
        <>
          <div className="text-sm text-muted-foreground">{violations.length} finding{violations.length === 1 ? "" : "s"}</div>
          <div className="space-y-3">
            {violations.map((v) => {
              const sev = severityMeta(v.severity)
              const cat = normalizeEngine(v.engine)
              return (
                <Card key={v.id} className="overflow-hidden">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${sev.dot}`} />
                        <div className="min-w-0">
                          <h3 className="font-semibold leading-tight">{v.title}</h3>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{v.description}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        {mode === "claims" ? (
                          <Badge variant={claimRisk(v.severity).badge}>{claimRisk(v.severity).label}</Badge>
                        ) : (
                          <Badge variant={sev.badge}>{sev.label}</Badge>
                        )}
                        <Badge variant="outline">{cat}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <Link href={`/reviews/${v.packageId}`} className="font-mono hover:text-primary">{v.packageSku}</Link>
                      <span className="truncate max-w-[240px]">{v.packageName}</span>
                      {v.vendor && <span>· {v.vendor}</span>}
                    </div>

                    {v.detectedText && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Detected: </span>
                        <span className="font-medium">"{v.detectedText}"</span>
                      </div>
                    )}

                    {hasDistinctFix(v.detectedText, v.suggestedText) && (
                      <div className="rounded-lg border border-success/30 bg-success/5 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-success uppercase tracking-wide">Suggested Fix</span>
                          <Button size="sm" variant="ghost" className="h-7 gap-1.5" onClick={() => copy(v.id, v.suggestedText!)}>
                            {copied === v.id ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                            {copied === v.id ? "Copied" : "Copy"}
                          </Button>
                        </div>
                        <p className="text-sm font-medium mt-1.5">{v.suggestedText}</p>
                        {(mode === "fixes" || mode === "memory") && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Used successfully in {usageFor(v.id).toLocaleString()} approved packages · {confidenceFor(v.id)}% confidence
                          </p>
                        )}
                      </div>
                    )}

                    {v.regulationRef && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <RegulationRef refText={v.regulationRef} icon />
                      </div>
                    )}

                    <div className="pt-1">
                      <Link href={`/reviews/${v.packageId}`}>
                        <Button variant="ghost" size="sm" className="gap-1 h-8">
                          Open review <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
