import * as React from "react"
import { useListAuditEvents } from "@workspace/api-client-react"
import type { AuditEvent, ListAuditEventsParams } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RegulationRef } from "@/components/regulation-ref"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { History, Loader2, Search, Filter, X, ArrowRight } from "lucide-react"

const ENTITY_TYPES = ["package", "user", "team", "supplier", "report", "regulation", "assignment", "ai_provider"]
const ANY = "__any__"

function fmt(dt: string): string {
  return new Date(dt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function DiffBlock({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null
  return (
    <div className="flex-1 min-w-0">
      <div className="text-xs font-medium text-muted-foreground mb-1">{label}</div>
      <pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-64 whitespace-pre-wrap break-words">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

export default function AuditCenter() {
  const [action, setAction] = React.useState("")
  const [actor, setActor] = React.useState("")
  const [q, setQ] = React.useState("")
  const [entityType, setEntityType] = React.useState<string>(ANY)
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [selected, setSelected] = React.useState<AuditEvent | null>(null)

  // Debounce free-text inputs so we don't refetch on every keystroke.
  const [debounced, setDebounced] = React.useState({ action: "", actor: "", q: "" })
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced({ action, actor, q }), 300)
    return () => clearTimeout(id)
  }, [action, actor, q])

  const params: ListAuditEventsParams = {
    ...(debounced.action ? { action: debounced.action } : {}),
    ...(debounced.actor ? { actor: debounced.actor } : {}),
    ...(debounced.q ? { q: debounced.q } : {}),
    ...(entityType !== ANY ? { entityType } : {}),
    ...(from ? { from: new Date(from).toISOString() } : {}),
    ...(to ? { to: new Date(to).toISOString() } : {}),
    limit: 300,
  }

  const { data: events = [], isLoading, isFetching } = useListAuditEvents(params)

  const hasFilters = !!(action || actor || q || entityType !== ANY || from || to)
  const clearFilters = () => {
    setAction(""); setActor(""); setQ(""); setEntityType(ANY); setFrom(""); setTo("")
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <History className="w-7 h-7 text-primary" /> Audit Center
        </h1>
        <p className="text-muted-foreground mt-1">Search the immutable record of every action taken across the platform.</p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium"><Filter className="w-4 h-4" />Filters</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Search detail</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Free text..." value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Action</Label>
              <Input placeholder="e.g. User.Update" value={action} onChange={(e) => setAction(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Actor</Label>
              <Input placeholder="Who did it" value={actor} onChange={(e) => setActor(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Entity type</Label>
              <Select value={entityType} onValueChange={setEntityType}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any</SelectItem>
                  {ENTITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={clearFilters}>
              <X className="w-3.5 h-3.5" /> Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : events.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">No matching audit events.</div>
          ) : (
            <div className="divide-y divide-border">
              <div className="px-4 py-2 text-xs text-muted-foreground flex items-center gap-2">
                {isFetching && <Loader2 className="w-3 h-3 animate-spin" />}
                {events.length} event{events.length === 1 ? "" : "s"}
              </div>
              {events.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSelected(e)}
                  className="w-full text-left px-4 py-3 hover:bg-accent/40 transition-colors flex items-start gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{e.action}</Badge>
                      {e.entityType && <Badge variant="secondary">{e.entityType}</Badge>}
                      <span className="text-sm font-medium">{e.actor}</span>
                    </div>
                    {e.detail && <div className="text-sm text-muted-foreground mt-1 truncate">{e.detail}</div>}
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">{fmt(e.createdAt)}</div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selected?.action}
              {selected?.entityType && <Badge variant="secondary">{selected.entityType}{selected.entityId ? ` #${selected.entityId}` : ""}</Badge>}
            </DialogTitle>
            <DialogDescription>
              {selected?.actor} · {selected ? fmt(selected.createdAt) : ""}
            </DialogDescription>
          </DialogHeader>
          {selected?.detail && <p className="text-sm">{selected.detail}</p>}
          {(selected?.before != null || selected?.after != null) && (
            <div className="flex flex-col sm:flex-row gap-3 items-stretch">
              <DiffBlock label="Before" value={selected?.before} />
              {selected?.before != null && selected?.after != null && (
                <div className="hidden sm:flex items-center"><ArrowRight className="w-4 h-4 text-muted-foreground" /></div>
              )}
              <DiffBlock label="After" value={selected?.after} />
            </div>
          )}
          {selected?.regulationRefs && selected.regulationRefs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selected.regulationRefs.map((r) => (
                <RegulationRef key={r} refText={r} className="rounded border px-2 py-0.5 text-xs" />
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
