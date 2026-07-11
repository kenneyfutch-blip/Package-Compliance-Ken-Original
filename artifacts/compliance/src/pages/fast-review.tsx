import { useState, useEffect, useCallback } from "react"
import { useLocation } from "wouter"
import {
  useListPackages,
  useUpdatePackage,
  getListPackagesQueryKey,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Loader2, Check, X, ArrowDown, Eye, Plus, Zap } from "lucide-react"
import { gradeColor, riskBand } from "@/lib/compliance"

const SHORTCUTS = [
  { key: "A", label: "Approve", icon: Check },
  { key: "R", label: "Reject", icon: X },
  { key: "N", label: "Next", icon: ArrowDown },
  { key: "V", label: "View Details", icon: Eye },
  { key: "F", label: "Add Finding", icon: Plus },
]

export default function FastReview() {
  const [, navigate] = useLocation()
  const queryClient = useQueryClient()
  const { data: packages = [], isLoading } = useListPackages({})
  const update = useUpdatePackage()
  const [index, setIndex] = useState(0)
  const [decisions, setDecisions] = useState<Record<number, string>>({})

  const current = packages[index]

  const decide = useCallback(
    (status: string) => {
      if (!current) return
      setDecisions((d) => ({ ...d, [current.id]: status }))
      update.mutate(
        { id: current.id, data: { status } },
        {
          onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: getListPackagesQueryKey() }),
        },
      )
      setIndex((i) => Math.min(i + 1, packages.length - 1))
    },
    [current, update, queryClient, packages.length],
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const k = e.key.toLowerCase()
      if (k === "a") decide("Approved")
      else if (k === "r") decide("Needs Revision")
      else if (k === "n") setIndex((i) => Math.min(i + 1, packages.length - 1))
      else if (k === "v" && current) navigate(`/reviews/${current.id}`)
      else if (k === "f" && current) navigate(`/reviews/${current.id}`)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [decide, current, navigate, packages.length])

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Zap className="w-7 h-7 text-primary" /> Fast Review
          </h1>
          <p className="text-muted-foreground mt-1">
            High-volume review. Decide with your keyboard, never leave the queue.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {SHORTCUTS.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Kbd>{s.key}</Kbd> {s.label}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Focused package */}
        <div className="lg:col-span-2">
          {current ? (
            <Card className="p-6 space-y-5">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-xs font-mono text-muted-foreground mb-1">{current.sku}</div>
                  <h2 className="text-2xl font-bold leading-tight">{current.name}</h2>
                  <p className="text-muted-foreground mt-1">{current.vendor} • {current.brand} • {current.category}</p>
                </div>
                {current.grade && (
                  <div className={`text-5xl font-black ${gradeColor(current.grade)}`}>{current.grade}</div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-accent/50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold">{current.riskScore ?? 0}</div>
                  <div className="text-xs text-muted-foreground mt-1">Risk Score</div>
                </div>
                <div className="bg-accent/50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-destructive">{current.criticalCount}</div>
                  <div className="text-xs text-muted-foreground mt-1">Critical</div>
                </div>
                <div className="bg-accent/50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-warning">{current.majorCount}</div>
                  <div className="text-xs text-muted-foreground mt-1">Major</div>
                </div>
              </div>

              {current.summary && (
                <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4">{current.summary}</p>
              )}

              <div className="flex flex-wrap gap-3 pt-2">
                <Button className="gap-2" onClick={() => decide("Approved")}>
                  <Check className="w-4 h-4" /> Approve <Kbd className="ml-1">A</Kbd>
                </Button>
                <Button variant="destructive" className="gap-2" onClick={() => decide("Needs Revision")}>
                  <X className="w-4 h-4" /> Reject <Kbd className="ml-1">R</Kbd>
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => navigate(`/reviews/${current.id}`)}>
                  <Eye className="w-4 h-4" /> View Details <Kbd className="ml-1">V</Kbd>
                </Button>
                <Button variant="ghost" className="gap-2" onClick={() => setIndex((i) => Math.min(i + 1, packages.length - 1))}>
                  <ArrowDown className="w-4 h-4" /> Next <Kbd className="ml-1">N</Kbd>
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="p-12 text-center text-muted-foreground">Queue empty.</Card>
          )}
        </div>

        {/* Queue list */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground px-1">
            Queue · {index + 1} of {packages.length}
          </div>
          <div className="space-y-1.5 max-h-[560px] overflow-y-auto pr-1">
            {packages.map((pkg, i) => {
              const band = riskBand(pkg.riskScore)
              const decision = decisions[pkg.id]
              return (
                <button
                  key={pkg.id}
                  onClick={() => setIndex(i)}
                  className={`w-full text-left rounded-lg border p-3 transition-colors ${
                    i === index ? "border-primary bg-primary/5" : "border-border hover:bg-accent"
                  }`}
                >
                  <div className="flex justify-between items-center gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-mono text-muted-foreground truncate">{pkg.sku}</div>
                      <div className="font-medium text-sm truncate">{pkg.name}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {decision === "Approved" && <Check className="w-4 h-4 text-success" />}
                      {decision === "Needs Revision" && <X className="w-4 h-4 text-destructive" />}
                      <Badge variant={band.badge}>{pkg.riskScore ?? 0}</Badge>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
