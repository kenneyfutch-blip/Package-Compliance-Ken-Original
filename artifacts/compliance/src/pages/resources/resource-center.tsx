import { useMemo, useState } from "react"
import { Link, useSearch, useLocation } from "wouter"
import {
  useGetResourceOverview,
  useSearchResources,
  getSearchResourcesQueryKey,
  type ResourceSearchResult,
  type ResourceGroupSummary,
  type ResourceAgencySummary,
} from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Search,
  BookOpen,
  Scale,
  ScrollText,
  FileText,
  Languages,
  Library,
  ArrowLeft,
  ArrowRight,
  History,
  Sparkles,
  Loader2,
  Compass,
  ShieldAlert,
  Radio,
  ShieldCheck,
  Clock,
} from "lucide-react"
import { recordResourceView, useRecentResources } from "@/lib/recent-resources"

// Icon + tone per resource type so a result is recognizable at a glance and the
// whole hub reads as one Resource Center.
const TYPE_META: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; label: string; tone: string }
> = {
  regulation: { icon: Scale, label: "Regulations", tone: "text-blue-600 dark:text-blue-400 bg-blue-500/10" },
  internal_sop: { icon: BookOpen, label: "Internal SOPs", tone: "text-violet-600 dark:text-violet-400 bg-violet-500/10" },
  policy: { icon: ScrollText, label: "Policies", tone: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" },
  sop_document: { icon: FileText, label: "SOP Documents", tone: "text-amber-600 dark:text-amber-400 bg-amber-500/10" },
  glossary: { icon: Languages, label: "Glossary", tone: "text-rose-600 dark:text-rose-400 bg-rose-500/10" },
  guide: { icon: Compass, label: "Guides", tone: "text-cyan-600 dark:text-cyan-400 bg-cyan-500/10" },
}

function typeMeta(type: string) {
  return TYPE_META[type] ?? { icon: Library, label: type, tone: "text-muted-foreground bg-muted" }
}

// Curated reference guides. These are reachable elsewhere in the app; the
// Resource Center gathers them so everything a reviewer needs is in one place.
const GUIDES: { title: string; description: string; href: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { title: "Regulatory Knowledge Base", description: "Search FDA, EPA, CPSC and internal rules together.", href: "/regulations", icon: Library },
  { title: "Regulatory Sources", description: "Where each regulation is sourced and verified.", href: "/regulatory/sources", icon: ShieldCheck },
  { title: "Regulatory Updates", description: "Recent changes to the rules that affect reviews.", href: "/regulatory-updates", icon: Radio },
  { title: "FDA Recalls", description: "Live recall intelligence from the FDA.", href: "/regulatory/recalls", icon: ShieldAlert },
]

function ResultCard({ r, onOpen }: { r: ResourceSearchResult; onOpen: () => void }) {
  const meta = typeMeta(r.type)
  const Icon = meta.icon
  return (
    <Link href={r.href} onClick={onOpen}>
      <Card className="hover-elevate transition-all cursor-pointer">
        <CardContent className="flex items-start gap-4 p-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[11px]">{r.typeLabel}</Badge>
              {r.category && <span className="text-xs text-muted-foreground">{r.category}</span>}
              {r.badge && <span className="font-mono text-[11px] text-muted-foreground">{r.badge}</span>}
            </div>
            <p className="mt-1 truncate font-medium leading-tight">{r.title}</p>
            {r.subtitle && <p className="text-xs text-muted-foreground">{r.subtitle}</p>}
            {r.description && (
              <p className="mt-1 line-clamp-2 text-sm text-foreground/80">{r.description}</p>
            )}
          </div>
          <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  )
}

function GroupCard({ g, onOpen }: { g: ResourceGroupSummary; onOpen: () => void }) {
  const meta = typeMeta(g.type)
  const Icon = meta.icon
  const reserved = !g.available
  const inner = (
    <Card className={`h-full transition-all ${reserved ? "opacity-70" : "hover-elevate cursor-pointer"}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${meta.tone}`}>
            <Icon className="h-5 w-5" />
          </div>
          {reserved ? (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">Coming soon</Badge>
          ) : (
            <span className="text-2xl font-bold tabular-nums">{g.count}</span>
          )}
        </div>
        <CardTitle className="mt-3 text-base">{g.label}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-sm text-muted-foreground">{g.description}</p>
      </CardContent>
    </Card>
  )
  if (reserved) return <div>{inner}</div>
  return (
    <Link href={g.href} onClick={onOpen}>
      {inner}
    </Link>
  )
}

function AgencyPill({ a }: { a: ResourceAgencySummary }) {
  return (
    <Link href={a.href}>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover-elevate cursor-pointer">
        <Scale className="h-4 w-4 text-primary" />
        <span className="font-medium">{a.label}</span>
        <Badge variant="secondary" className="ml-auto tabular-nums">{a.count}</Badge>
      </div>
    </Link>
  )
}

export default function ResourceCenter() {
  const [, navigate] = useLocation()
  const queryString = useSearch()
  const params = new URLSearchParams(queryString)
  const returnPath = params.get("return")
  const returnLabel = params.get("returnLabel") || "your work"

  const [query, setQuery] = useState("")
  const [activeType, setActiveType] = useState<string>("all")
  const trimmed = query.trim()
  const isSearching = trimmed.length >= 2

  const { data: overview, isLoading: overviewLoading } = useGetResourceOverview()

  const typeParam = activeType === "all" ? undefined : activeType
  const searchParams = { q: trimmed, limit: 30, ...(typeParam ? { types: typeParam } : {}) }
  const { data: searchData, isLoading: searchLoading } = useSearchResources(searchParams, {
    query: {
      enabled: isSearching,
      queryKey: getSearchResourcesQueryKey(searchParams),
    },
  })

  const { recent, mostUsed } = useRecentResources()
  const [quickView, setQuickView] = useState<"recent" | "used">("recent")
  const quickItems = (quickView === "recent" ? recent : mostUsed).slice(0, 6)

  const results = searchData?.results ?? []

  // Type-filter chips derived from the overview so the labels/counts match.
  const filterTypes = useMemo(() => {
    const base = [
      { key: "regulation", label: "Regulations" },
      { key: "internal_sop", label: "Internal SOPs" },
      { key: "policy", label: "Policies" },
    ]
    return base
  }, [])

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {returnPath && (
        <button
          onClick={() => navigate(returnPath)}
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to {returnLabel}
        </button>
      )}

      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <Library className="h-7 w-7 text-primary" />
          Resource Center
        </h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          Every compliance reference in one place — regulatory libraries, internal standards,
          policies and guides. Search across all of them without leaving your review.
        </p>
      </div>

      {/* Unified search */}
      <div className="space-y-3">
        <div className="relative max-w-2xl">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search regulations, SOPs, policies… e.g. 'allergen declaration'"
            className="h-12 bg-card pl-10 text-base"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searchLoading && (
            <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        {isSearching && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant={activeType === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveType("all")}
            >
              All types
            </Button>
            {filterTypes.map((t) => (
              <Button
                key={t.key}
                variant={activeType === t.key ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveType(t.key)}
              >
                {t.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {isSearching ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {searchLoading
              ? "Searching…"
              : `${results.length} result${results.length === 1 ? "" : "s"} for “${trimmed}”`}
          </p>
          {!searchLoading && results.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card p-10 text-center text-muted-foreground">
              No resources matched your search.
            </div>
          ) : (
            <div className="grid gap-3">
              {results.map((r) => (
                <ResultCard
                  key={`${r.type}-${r.refId}`}
                  r={r}
                  onOpen={() =>
                    recordResourceView({
                      type: r.type,
                      typeLabel: r.typeLabel,
                      refId: r.refId,
                      title: r.title,
                      href: r.href,
                      category: r.category,
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Quick access */}
          {quickItems.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <History className="h-5 w-5 text-primary" />
                  Quick access
                </h2>
                <div className="flex gap-1 rounded-lg border border-border p-0.5">
                  <button
                    onClick={() => setQuickView("recent")}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      quickView === "recent" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Clock className="mr-1 inline h-3 w-3" /> Recent
                  </button>
                  <button
                    onClick={() => setQuickView("used")}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      quickView === "used" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Sparkles className="mr-1 inline h-3 w-3" /> Most used
                  </button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {quickItems.map((item) => {
                  const meta = typeMeta(item.type)
                  const Icon = meta.icon
                  return (
                    <Link
                      key={`${item.type}-${item.refId}`}
                      href={item.href}
                      onClick={() =>
                        recordResourceView({
                          type: item.type,
                          typeLabel: item.typeLabel,
                          refId: item.refId,
                          title: item.title,
                          href: item.href,
                          category: item.category,
                        })
                      }
                    >
                      <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover-elevate cursor-pointer">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{item.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.typeLabel}
                            {quickView === "used" && item.count > 1 ? ` · viewed ${item.count}×` : ""}
                          </p>
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </section>
          )}

          {/* Resource groups */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Browse by type</h2>
            {overviewLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(overview?.groups ?? []).map((g) => (
                  <GroupCard key={g.type} g={g} onOpen={() => {}} />
                ))}
              </div>
            )}
          </section>

          {/* Regulatory libraries */}
          {(overview?.agencies?.length ?? 0) > 0 && (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Scale className="h-5 w-5 text-primary" /> Regulatory libraries
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {overview!.agencies.map((a) => (
                  <AgencyPill key={a.agency} a={a} />
                ))}
              </div>
            </section>
          )}

          {/* Guides */}
          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Compass className="h-5 w-5 text-primary" /> Guides & references
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {GUIDES.map((guide) => {
                const Icon = guide.icon
                return (
                  <Link key={guide.href} href={guide.href}>
                    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 hover-elevate cursor-pointer">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-medium leading-tight">{guide.title}</p>
                        <p className="mt-0.5 text-sm text-muted-foreground">{guide.description}</p>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
