import { useMemo, useState } from "react"
import {
  useListPolicies,
  useSearchPolicies,
  getListPoliciesQueryKey,
  getSearchPoliciesQueryKey,
  type Policy,
} from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Search, BookOpen, ShieldCheck, CalendarClock, Sparkles } from "lucide-react"

function severityTone(sev: string): string {
  if (sev === "critical") return "bg-destructive/10 text-destructive"
  if (sev === "major") return "bg-amber-500/10 text-amber-600 dark:text-amber-400"
  if (sev === "minor") return "bg-blue-500/10 text-blue-600 dark:text-blue-400"
  return "bg-muted text-muted-foreground"
}

type Row = {
  id: number
  name: string
  category: string
  source?: string | null
  summary?: string | null
  defaultSeverity: string
  effectiveDate?: string | null
  expirationDate?: string | null
  version: number
  similarity?: number
}

function PolicyCard({ p }: { p: Row }) {
  return (
    <Card className="hover-elevate transition-all">
      <CardHeader className="py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-primary/10 text-primary hover:bg-primary/20">{p.category}</Badge>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${severityTone(p.defaultSeverity)}`}>{p.defaultSeverity}</span>
              <Badge variant="outline">v{p.version}</Badge>
              {typeof p.similarity === "number" && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Sparkles className="w-3 h-3" /> {(p.similarity * 100).toFixed(0)}% match
                </span>
              )}
            </div>
            <CardTitle className="text-lg leading-tight mt-1">{p.name}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="py-0 pb-4">
        <p className="text-sm text-foreground/80 leading-relaxed">
          {p.summary || "No rule statement provided. Refer to the attached policy document."}
        </p>
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground bg-accent/50 p-3 rounded-md">
          {p.source && <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> {p.source}</span>}
          {p.effectiveDate && <span className="flex items-center gap-1"><CalendarClock className="w-3 h-3" /> Effective {p.effectiveDate}</span>}
          {p.expirationDate && <span className="flex items-center gap-1">Expires {p.expirationDate}</span>}
        </div>
      </CardContent>
    </Card>
  )
}

export default function PolicyRepository() {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string>("all")

  const trimmed = query.trim()
  const isSearching = trimmed.length >= 3

  const listParams = { status: "active" }
  const { data: allPolicies = [], isLoading: listLoading } = useListPolicies(
    listParams,
    { query: { enabled: !isSearching, queryKey: getListPoliciesQueryKey(listParams) } },
  )
  const searchParams = { q: trimmed, limit: 25 }
  const { data: searchResults = [], isLoading: searchLoading } = useSearchPolicies(searchParams, {
    query: { enabled: isSearching, queryKey: getSearchPoliciesQueryKey(searchParams) },
  })

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const p of allPolicies as Policy[]) set.add(p.category)
    return ["all", ...Array.from(set).sort()]
  }, [allPolicies])

  const rows: Row[] = useMemo(() => {
    if (isSearching) return searchResults as Row[]
    const base = allPolicies as Policy[]
    const filtered = category === "all" ? base : base.filter((p) => p.category === category)
    return filtered.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      source: p.source,
      summary: p.summary,
      defaultSeverity: p.defaultSeverity,
      effectiveDate: p.effectiveDate,
      expirationDate: p.expirationDate,
      version: p.version,
    }))
  }, [isSearching, searchResults, allPolicies, category])

  const loading = isSearching ? searchLoading : listLoading

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <BookOpen className="w-7 h-7 text-primary" />
          Policy Repository
        </h1>
        <p className="text-muted-foreground mt-1 max-w-2xl">
          Browse and search your organization&apos;s internal standards. These policies are enforced automatically during compliance reviews.
        </p>
      </div>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          placeholder="Ask in plain language, e.g. 'price legend rules for private label'…"
          className="pl-10 h-12 text-base bg-card"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {!isSearching && categories.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <Button
              key={c}
              variant={category === c ? "default" : "outline"}
              size="sm"
              onClick={() => setCategory(c)}
              className="capitalize"
            >
              {c === "all" ? "All" : c}
            </Button>
          ))}
        </div>
      )}

      {isSearching && (
        <p className="text-sm text-muted-foreground">
          Showing semantic matches for &ldquo;{trimmed}&rdquo;
        </p>
      )}

      <div className="grid gap-4">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">Loading policies…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center bg-card rounded-xl border border-dashed text-muted-foreground">
            {isSearching ? "No policies matched your search." : "No active policies to display."}
          </div>
        ) : (
          rows.map((p) => <PolicyCard key={p.id} p={p} />)
        )}
      </div>
    </div>
  )
}
