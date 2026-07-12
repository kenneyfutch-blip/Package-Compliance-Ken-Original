import { useEffect, useMemo, useState } from "react"
import { Link, useSearch } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListGlossaryEntries,
  useCreateGlossaryEntry,
  useUpdateGlossaryEntry,
  useListGlossaryEntryHistory,
  getListGlossaryEntriesQueryKey,
  getListGlossaryEntryHistoryQueryKey,
  type GlossaryEntry,
} from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Languages,
  ArrowLeft,
  Search,
  Plus,
  Pencil,
  Archive,
  RotateCcw,
  History,
  ShieldCheck,
  Loader2,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/lib/access"
import { cn } from "@/lib/utils"

// Suggested groupings (mirrors GLOSSARY_CATEGORIES on the server). Category is
// free-form, so an org can type its own, but these drive the create form + chips.
const CATEGORIES = [
  // Compliance-language types
  "Approved Claim",
  "Required Statement",
  "Defined Term",
  "Allergen & Warning",
  "Brand Language",
  "Prohibited Language",
  // Dollar Tree product categories (diverse ecommerce offerings) so approved
  // language can be organized by the merchandise area it applies to.
  "Food & Beverage",
  "Health & Wellness",
  "Beauty & Personal Care",
  "Household & Cleaning",
  "Baby & Kids",
  "Toys & Games",
  "Pet Supplies",
  "Party & Seasonal",
  "Home & Kitchen",
  "Office & School",
  "Apparel & Accessories",
  "Electronics",
  "Arts & Crafts",
  // Catch-all for anything that doesn't fit above.
  "Other",
]

const CATEGORY_TONE: Record<string, string> = {
  "Approved Claim": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  "Required Statement": "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  "Defined Term": "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  "Allergen & Warning": "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  "Brand Language": "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  "Prohibited Language": "bg-destructive/10 text-destructive",
  "Food & Beverage": "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  "Health & Wellness": "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  "Beauty & Personal Care": "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  "Household & Cleaning": "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  "Baby & Kids": "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  "Toys & Games": "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
  "Pet Supplies": "bg-lime-500/10 text-lime-600 dark:text-lime-400",
  "Party & Seasonal": "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  "Home & Kitchen": "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  "Office & School": "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  "Apparel & Accessories": "bg-red-500/10 text-red-600 dark:text-red-400",
  Electronics: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  "Arts & Crafts": "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  Other: "bg-muted text-muted-foreground",
}

function categoryTone(c: string): string {
  return CATEGORY_TONE[c] ?? "bg-muted text-muted-foreground"
}

type Draft = {
  term: string
  approvedValue: string
  category: string
  status: string
  notes: string
  regulatoryReference: string
}

const EMPTY_DRAFT: Draft = {
  term: "",
  approvedValue: "",
  category: "Defined Term",
  status: "active",
  notes: "",
  regulatoryReference: "",
}

function draftPayload(d: Draft) {
  return {
    term: d.term.trim(),
    approvedValue: d.approvedValue.trim(),
    category: d.category,
    status: d.status,
    notes: d.notes.trim() || null,
    regulatoryReference: d.regulatoryReference.trim() || null,
  }
}

function HistoryDialog({
  entry,
  onClose,
}: {
  entry: GlossaryEntry
  onClose: () => void
}) {
  const params = { query: { queryKey: getListGlossaryEntryHistoryQueryKey(entry.id) } }
  const { data: events = [], isLoading } = useListGlossaryEntryHistory(entry.id, params)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" /> Change history
          </DialogTitle>
          <DialogDescription>{entry.term}</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : events.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No recorded changes.
          </p>
        ) : (
          <ol className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {events.map((ev) => (
              <li key={ev.id} className="border-l-2 border-border pl-3">
                <p className="text-sm font-medium">{ev.action}</p>
                {ev.detail && (
                  <p className="text-xs text-muted-foreground">{ev.detail}</p>
                )}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {ev.actor} · {new Date(ev.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function Glossary() {
  const { has } = usePermissions()
  const canWrite = has("glossary:write")
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string>("all")
  const [status, setStatus] = useState<string>("active")

  const [editing, setEditing] = useState<GlossaryEntry | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [historyFor, setHistoryFor] = useState<GlossaryEntry | null>(null)

  // Deep link: /resources/glossary?entry=<id> highlights an entry (used by the
  // Resource Center so a unified-search result opens here).
  const queryString = useSearch()
  const deepLinkId = new URLSearchParams(queryString).get("entry")

  const listParams = {
    status,
    ...(category !== "all" ? { category } : {}),
    ...(query.trim().length >= 2 ? { search: query.trim() } : {}),
  }
  const { data: entries = [], isLoading } = useListGlossaryEntries(listParams, {
    query: { queryKey: getListGlossaryEntriesQueryKey(listParams) },
  })

  const createMut = useCreateGlossaryEntry()
  const updateMut = useUpdateGlossaryEntry()

  function invalidate() {
    // NOTE: the generated query keys are prefixed with "/api" (e.g.
    // ["/api/glossary", params]). Invalidating "/glossary" / "/resources/overview"
    // never prefix-matched, so newly created/edited/retired entries silently
    // failed to appear — making the whole tool look broken. Match the real keys.
    void queryClient.invalidateQueries({ queryKey: ["/api/glossary"] })
    void queryClient.invalidateQueries({ queryKey: ["/api/resources/overview"] })
  }

  // Group entries by category for a scannable, categorized browse.
  const grouped = useMemo(() => {
    const map = new Map<string, GlossaryEntry[]>()
    for (const e of entries as GlossaryEntry[]) {
      const list = map.get(e.category) ?? []
      list.push(e)
      map.set(e.category, list)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [entries])

  useEffect(() => {
    if (!deepLinkId || isLoading) return
    const el = document.getElementById(`glossary-${deepLinkId}`)
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [deepLinkId, isLoading, entries])

  function openCreate() {
    setDraft(EMPTY_DRAFT)
    setCreating(true)
  }

  function openEdit(e: GlossaryEntry) {
    setDraft({
      term: e.term,
      approvedValue: e.approvedValue,
      category: e.category,
      status: e.status,
      notes: e.notes ?? "",
      regulatoryReference: e.regulatoryReference ?? "",
    })
    setEditing(e)
  }

  async function saveCreate() {
    const payload = draftPayload(draft)
    if (!payload.term || !payload.approvedValue) {
      toast({ title: "Term and approved value are required", variant: "destructive" })
      return
    }
    try {
      await createMut.mutateAsync({ data: payload })
      invalidate()
      setCreating(false)
      toast({ title: "Entry added", description: payload.term })
    } catch {
      toast({ title: "Could not add entry", variant: "destructive" })
    }
  }

  async function saveEdit() {
    if (!editing) return
    const payload = draftPayload(draft)
    if (!payload.term || !payload.approvedValue) {
      toast({ title: "Term and approved value are required", variant: "destructive" })
      return
    }
    try {
      await updateMut.mutateAsync({ id: editing.id, data: payload })
      invalidate()
      void queryClient.invalidateQueries({
        queryKey: getListGlossaryEntryHistoryQueryKey(editing.id),
      })
      setEditing(null)
      toast({ title: "Entry updated", description: payload.term })
    } catch {
      toast({ title: "Could not update entry", variant: "destructive" })
    }
  }

  async function toggleRetire(e: GlossaryEntry) {
    const nextStatus = e.status === "retired" ? "active" : "retired"
    try {
      await updateMut.mutateAsync({ id: e.id, data: { status: nextStatus } })
      invalidate()
      toast({
        title: nextStatus === "retired" ? "Entry retired" : "Entry restored",
        description: e.term,
      })
    } catch {
      toast({ title: "Could not change status", variant: "destructive" })
    }
  }

  const isEmpty = !isLoading && entries.length === 0

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Link
        href="/resources"
        className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Resource Center
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Languages className="h-7 w-7 text-primary" />
            Approved Language & Glossary
          </h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            A maintained library of pre-approved compliance language and defined terms.
            Reviewers reuse these with confidence, and the AI language review reasons
            against them automatically.
          </p>
        </div>
        {canWrite && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> New entry
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search terms, approved values, notes…"
            className="h-11 bg-card pl-10"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-11 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="retired">Retired</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={category === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setCategory("all")}
        >
          All categories
        </Button>
        {CATEGORIES.map((c) => (
          <Button
            key={c}
            variant={category === c ? "default" : "outline"}
            size="sm"
            onClick={() => setCategory(c)}
          >
            {c}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : isEmpty ? (
        <div className="rounded-xl border border-dashed bg-card p-12 text-center text-muted-foreground">
          {query.trim() || category !== "all" || status !== "active"
            ? "No entries match your filters."
            : "No approved-language entries yet."}
          {canWrite && !query.trim() && category === "all" && status === "active" && (
            <div className="mt-4">
              <Button onClick={openCreate} variant="outline">
                <Plus className="mr-2 h-4 w-4" /> Add the first entry
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([cat, items]) => (
            <section key={cat} className="space-y-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    categoryTone(cat),
                  )}
                >
                  {cat}
                </span>
                <span className="text-sm text-muted-foreground">
                  {items.length} {items.length === 1 ? "entry" : "entries"}
                </span>
              </div>
              <div className="grid gap-3">
                {items.map((e) => (
                  <Card
                    key={e.id}
                    id={`glossary-${e.id}`}
                    className={cn(
                      "transition-all",
                      deepLinkId === String(e.id) &&
                        "ring-2 ring-primary ring-offset-2 ring-offset-background",
                      e.status === "retired" && "opacity-60",
                    )}
                  >
                    <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{e.term}</span>
                          {e.status === "retired" && (
                            <Badge variant="outline" className="text-[10px] uppercase">
                              Retired
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-foreground/90">{e.approvedValue}</p>
                        {e.notes && (
                          <p className="text-xs text-muted-foreground">{e.notes}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground">
                          {e.regulatoryReference && (
                            <span className="inline-flex items-center gap-1">
                              <ShieldCheck className="h-3 w-3" /> {e.regulatoryReference}
                            </span>
                          )}
                          {e.updatedBy && <span>Updated by {e.updatedBy}</span>}
                        </div>
                      </div>
                      {canWrite && (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setHistoryFor(e)}
                            title="Change history"
                          >
                            <History className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(e)}
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleRetire(e)}
                            title={e.status === "retired" ? "Restore" : "Retire"}
                          >
                            {e.status === "retired" ? (
                              <RotateCcw className="h-4 w-4" />
                            ) : (
                              <Archive className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Create / edit dialog */}
      <Dialog
        open={creating || editing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false)
            setEditing(null)
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit entry" : "New entry"}</DialogTitle>
            <DialogDescription>
              Approved wording reviewers should reuse. Active entries also guide the
              AI language review.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="g-term">Term or phrase</Label>
              <Input
                id="g-term"
                value={draft.term}
                onChange={(e) => setDraft({ ...draft, term: e.target.value })}
                placeholder="e.g. Contains: Soy"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-value">Approved value / definition</Label>
              <Textarea
                id="g-value"
                value={draft.approvedValue}
                onChange={(e) => setDraft({ ...draft, approvedValue: e.target.value })}
                placeholder="The exact approved phrasing or the definition of the term."
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select
                  value={draft.category}
                  onValueChange={(v) => setDraft({ ...draft, category: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={draft.status}
                  onValueChange={(v) => setDraft({ ...draft, status: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="retired">Retired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-ref">Regulatory reference (optional)</Label>
              <Input
                id="g-ref"
                value={draft.regulatoryReference}
                onChange={(e) =>
                  setDraft({ ...draft, regulatoryReference: e.target.value })
                }
                placeholder="e.g. FDA 21 CFR 101.9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-notes">Reviewer notes (optional)</Label>
              <Textarea
                id="g-notes"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                placeholder="When and how to use this wording."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreating(false)
                setEditing(null)
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={editing ? saveEdit : saveCreate}
              disabled={createMut.isPending || updateMut.isPending}
            >
              {(createMut.isPending || updateMut.isPending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {editing ? "Save changes" : "Add entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {historyFor && (
        <HistoryDialog entry={historyFor} onClose={() => setHistoryFor(null)} />
      )}
    </div>
  )
}
