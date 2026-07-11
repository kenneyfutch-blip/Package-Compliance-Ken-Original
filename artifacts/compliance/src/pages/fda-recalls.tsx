import { useState } from "react"
import { useListFdaRecalls } from "@workspace/api-client-react"
import type { FdaRecall } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  Loader2,
  Search,
  ShieldAlert,
  Building2,
  MapPin,
  CalendarClock,
  AlertTriangle,
  ExternalLink,
} from "lucide-react"

const CATEGORIES = [
  { id: "food", label: "Food" },
  { id: "drug", label: "Drug" },
  { id: "device", label: "Device" },
] as const

type Category = (typeof CATEGORIES)[number]["id"]

type Tone = "default" | "secondary" | "destructive" | "warning" | "success" | "outline"

function classificationTone(c: string): Tone {
  if (/class i(\b|$)/i.test(c) && !/class ii/i.test(c)) return "destructive"
  if (/class ii(\b|$)/i.test(c) && !/class iii/i.test(c)) return "warning"
  if (/class iii/i.test(c)) return "secondary"
  return "outline"
}

function statusTone(s: string): Tone {
  if (/ongoing/i.test(s)) return "warning"
  if (/terminated|completed/i.test(s)) return "success"
  return "outline"
}

// The openFDA enforcement dataset has no per-record web page; its API query
// filtered by recall number is the authoritative source record to "click out" to.
function openFdaRecordUrl(r: FdaRecall): string {
  return `https://api.fda.gov/${r.category}/enforcement.json?search=recall_number:%22${encodeURIComponent(
    r.recallNumber,
  )}%22`
}

export default function FdaRecalls() {
  const [category, setCategory] = useState<Category>("food")
  const [input, setInput] = useState("")
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<FdaRecall | null>(null)

  const { data, isLoading, isError } = useListFdaRecalls({
    category,
    ...(search ? { search } : {}),
  })

  const results = data?.results ?? []

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <ShieldAlert className="w-7 h-7 text-primary" /> FDA Recalls &amp; Enforcement
        </h1>
        <p className="text-muted-foreground mt-1">
          Live recall and enforcement actions from openFDA — screen brands, ingredients, and product
          types against active FDA actions before they reach the shelf.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 bg-accent/50 p-1 rounded-lg w-fit">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={cn(
                "px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors",
                category === c.id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            setSearch(input.trim())
          }}
          className="relative w-full sm:max-w-sm"
        >
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search product, firm, or reason..."
            className="w-full h-9 bg-accent/50 border border-border rounded-md pl-9 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-primary transition-all"
          />
        </form>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <div className="text-center py-20 border border-dashed rounded-xl bg-card">
          <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto" />
          <p className="text-lg font-medium mt-3">FDA data is unavailable</p>
          <p className="text-muted-foreground mt-1">
            The openFDA integration may not be configured yet, or the service is temporarily
            unreachable. Try again in a moment.
          </p>
        </div>
      ) : results.length === 0 ? (
        <div className="text-center py-24 border border-dashed rounded-xl bg-card">
          <p className="text-lg font-medium">No recalls found</p>
          <p className="text-muted-foreground mt-1">
            {search
              ? `Nothing matched \u201C${search}\u201D in ${category} recalls.`
              : "No recent recalls in this category."}
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Showing the {results.length} most recent
            {typeof data?.total === "number" ? ` of ${data.total.toLocaleString()}` : ""} recalls
            {typeof data?.total === "number" && data.total > results.length && !search
              ? " — refine with search to narrow the list"
              : ""}
          </p>
          <div className="grid gap-4">
            {results.map((r, i) => (
              <Card
                key={r.recallNumber || `${r.recallingFirm}-${i}`}
                onClick={() => setSelected(r)}
                className="hover-elevate transition-all cursor-pointer"
              >
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      {r.classification && (
                        <Badge variant={classificationTone(r.classification)}>{r.classification}</Badge>
                      )}
                      {r.status && <Badge variant={statusTone(r.status)}>{r.status}</Badge>}
                      {r.recallNumber && (
                        <Badge variant="outline" className="font-mono text-xs">
                          {r.recallNumber}
                        </Badge>
                      )}
                    </div>
                    {r.reportDate && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                        <CalendarClock className="w-3.5 h-3.5" /> {r.reportDate}
                      </span>
                    )}
                  </div>

                  <p className="mt-3 font-medium leading-snug line-clamp-3">
                    {r.productDescription || "Untitled product"}
                  </p>
                  {r.reason && (
                    <p className="text-sm text-muted-foreground mt-1.5 line-clamp-3">{r.reason}</p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {r.recallingFirm && (
                      <span className="flex items-center gap-1">
                        <Building2 className="w-3.5 h-3.5" /> {r.recallingFirm}
                      </span>
                    )}
                    {r.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" /> {r.location}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {data?.disclaimer && (
            <p className="text-xs text-muted-foreground pt-2">{data.disclaimer}</p>
          )}
        </>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 flex-wrap">
                  {selected.classification && (
                    <Badge variant={classificationTone(selected.classification)}>
                      {selected.classification}
                    </Badge>
                  )}
                  {selected.status && (
                    <Badge variant={statusTone(selected.status)}>{selected.status}</Badge>
                  )}
                  {selected.recallNumber && (
                    <Badge variant="outline" className="font-mono text-xs">
                      {selected.recallNumber}
                    </Badge>
                  )}
                </div>
                <DialogTitle className="text-left leading-snug pt-1">
                  {selected.productDescription || "Untitled product"}
                </DialogTitle>
              </DialogHeader>

              <dl className="space-y-4 text-sm">
                <Field label="Reason for recall" value={selected.reason} />
                <Field label="Recalling firm" value={selected.recallingFirm} />
                <Field label="Location" value={selected.location} />
                <Field label="Distribution pattern" value={selected.distributionPattern} />
                <Field label="Product quantity" value={selected.productQuantity} />
                <Field label="Code / lot information" value={selected.codeInfo} />
                <Field label="Voluntary or mandated" value={selected.voluntaryMandated} />
                <Field
                  label="Initial firm notification"
                  value={selected.initialFirmNotification}
                />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Initiation date" value={selected.initiationDate} />
                  <Field label="Report date" value={selected.reportDate} />
                </div>
              </dl>

              {selected.recallNumber && (
                <a
                  href={openFdaRecordUrl(selected)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline w-fit"
                >
                  <ExternalLink className="w-4 h-4" /> View full record on openFDA
                </a>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 leading-relaxed">{value}</dd>
    </div>
  )
}
