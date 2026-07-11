import { useState, useMemo } from "react"
import { useListViolations } from "@workspace/api-client-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, Grid3x3 } from "lucide-react"
import { normalizeEngine, CANONICAL_ENGINES } from "@/lib/compliance"

const SEVERITIES = ["critical", "major", "minor", "info"] as const

function cellColor(count: number, max: number): string {
  if (count === 0) return "bg-muted/30 text-muted-foreground"
  const intensity = Math.min(1, count / (max || 1))
  if (intensity > 0.66) return "bg-destructive text-destructive-foreground"
  if (intensity > 0.33) return "bg-warning text-white"
  return "bg-primary/20 text-foreground"
}

export default function Heatmaps() {
  const { data: violations = [], isLoading } = useListViolations({})
  const [vendor, setVendor] = useState("all")
  const [category, setCategory] = useState("all")

  const vendors = useMemo(
    () => Array.from(new Set(violations.map((v) => v.vendor).filter(Boolean))) as string[],
    [violations],
  )
  const categories = useMemo(
    () => Array.from(new Set(violations.map((v) => v.category).filter(Boolean))) as string[],
    [violations],
  )

  const filtered = useMemo(
    () =>
      violations.filter(
        (v) =>
          (vendor === "all" || v.vendor === vendor) &&
          (category === "all" || v.category === category),
      ),
    [violations, vendor, category],
  )

  // Matrix: canonical engine x severity
  const { matrix, rowTotals, max } = useMemo(() => {
    const m: Record<string, Record<string, number>> = {}
    let mx = 0
    const totals: Record<string, number> = {}
    for (const eng of CANONICAL_ENGINES) {
      m[eng] = {}
      for (const s of SEVERITIES) m[eng][s] = 0
      totals[eng] = 0
    }
    for (const v of filtered) {
      const eng = normalizeEngine(v.engine)
      const sev = (v.severity || "info").toLowerCase()
      const key = SEVERITIES.includes(sev as typeof SEVERITIES[number]) ? sev : "info"
      m[eng][key] += 1
      totals[eng] += 1
      if (m[eng][key] > mx) mx = m[eng][key]
    }
    return { matrix: m, rowTotals: totals, max: mx }
  }, [filtered])

  const activeRows = CANONICAL_ENGINES.filter((e) => rowTotals[e] > 0)

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Grid3x3 className="w-7 h-7 text-primary" /> Compliance Heatmaps
          </h1>
          <p className="text-muted-foreground mt-1">Where violations concentrate, by category and severity.</p>
        </div>
        <div className="flex gap-2">
          <Select value={vendor} onValueChange={setVendor}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Vendor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vendors</SelectItem>
              {vendors.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : activeRows.length === 0 ? (
        <div className="text-center py-24 border border-dashed rounded-xl bg-card">
          <p className="text-lg font-medium">No violations in this slice</p>
          <p className="text-muted-foreground mt-1">Adjust the filters to see the heatmap.</p>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Category × Severity</CardTitle>
            <CardDescription>{filtered.length} violations mapped across {activeRows.length} categories</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-1">
                <thead>
                  <tr>
                    <th className="text-left text-xs font-medium text-muted-foreground p-2 w-56">Category</th>
                    {SEVERITIES.map((s) => (
                      <th key={s} className="text-center text-xs font-medium text-muted-foreground p-2 capitalize">{s}</th>
                    ))}
                    <th className="text-center text-xs font-medium text-muted-foreground p-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRows.map((eng) => (
                    <tr key={eng}>
                      <td className="text-sm font-medium p-2">{eng}</td>
                      {SEVERITIES.map((s) => {
                        const count = matrix[eng][s]
                        return (
                          <td key={s} className="p-1">
                            <div className={`h-11 rounded-md flex items-center justify-center text-sm font-bold ${cellColor(count, max)}`}>
                              {count || ""}
                            </div>
                          </td>
                        )
                      })}
                      <td className="p-1">
                        <div className="h-11 rounded-md flex items-center justify-center text-sm font-bold bg-accent">{rowTotals[eng]}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
