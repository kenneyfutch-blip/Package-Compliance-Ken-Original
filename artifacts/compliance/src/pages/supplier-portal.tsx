import { useState, useMemo } from "react"
import { useListSuppliers } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Search, Loader2, Globe, Mail, Building2 } from "lucide-react"

const RISK_TONE: Record<string, "success" | "warning" | "destructive"> = {
  Low: "success",
  Medium: "warning",
  High: "destructive",
}

export default function SupplierPortal() {
  const [search, setSearch] = useState("")
  const { data: all = [], isLoading } = useListSuppliers()
  const suppliers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.code ?? "").toLowerCase().includes(q) ||
        (s.category ?? "").toLowerCase().includes(q) ||
        (s.country ?? "").toLowerCase().includes(q),
    )
  }, [all, search])

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="w-7 h-7 text-primary" /> Supplier Portal
          </h1>
          <p className="text-muted-foreground mt-1">Vendor submission activity and compliance standing.</p>
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search suppliers..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : suppliers.length === 0 ? (
        <div className="text-center py-24 border border-dashed rounded-xl bg-card">
          <p className="text-lg font-medium">No suppliers found</p>
          <p className="text-muted-foreground mt-1">Try a different search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {suppliers.map((s) => (
            <Card key={s.id} className="hover-elevate transition-all">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <CardTitle className="text-lg truncate">{s.name}</CardTitle>
                    {s.code && <div className="text-xs font-mono text-muted-foreground mt-1">{s.code}</div>}
                  </div>
                  <Badge variant={RISK_TONE[s.riskLevel] ?? "outline"}>{s.riskLevel} risk</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Compliance Score</span>
                    <span className="font-medium">{s.complianceScore}%</span>
                  </div>
                  <Progress value={s.complianceScore} indicatorColor={s.complianceScore >= 80 ? "bg-success" : s.complianceScore >= 60 ? "bg-warning" : "bg-destructive"} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="bg-accent/50 rounded-lg p-3">
                    <div className="text-xl font-bold">{s.packagesReviewed}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Submissions</div>
                  </div>
                  <div className="bg-accent/50 rounded-lg p-3">
                    <div className="text-xl font-bold">{s.category ?? "—"}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Category</div>
                  </div>
                </div>
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  {s.country && <div className="flex items-center gap-2"><Globe className="w-3.5 h-3.5" /> {s.country}</div>}
                  {s.contactEmail && <div className="flex items-center gap-2 truncate"><Mail className="w-3.5 h-3.5" /> {s.contactEmail}</div>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
