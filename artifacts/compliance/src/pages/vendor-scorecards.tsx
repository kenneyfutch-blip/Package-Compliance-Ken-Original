import { useMemo } from "react"
import { Link } from "wouter"
import { useListPackages, useListViolations } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Loader2, Trophy, AlertTriangle } from "lucide-react"
import {
  gradePoints,
  pointsToGrade,
  gradeColor,
  normalizeEngine,
} from "@/lib/compliance"

interface Scorecard {
  vendor: string
  totalReviews: number
  passRate: number
  avgGrade: string
  avgRisk: number
  topViolation: string
  score: number
}

export default function VendorScorecards() {
  const { data: packages = [], isLoading: pkgLoading } = useListPackages({})
  const { data: violations = [], isLoading: vioLoading } = useListViolations({})

  const scorecards = useMemo<Scorecard[]>(() => {
    const byVendor: Record<string, typeof packages> = {}
    for (const p of packages) {
      const v = p.vendor || "Unknown"
      ;(byVendor[v] ??= []).push(p)
    }
    const vioByVendor: Record<string, Record<string, number>> = {}
    for (const v of violations) {
      const vendor = v.vendor || "Unknown"
      const cat = normalizeEngine(v.engine)
      ;(vioByVendor[vendor] ??= {})[cat] = (vioByVendor[vendor]?.[cat] ?? 0) + 1
    }

    return Object.entries(byVendor).map(([vendor, pkgs]) => {
      const total = pkgs.length
      const passed = pkgs.filter((p) => p.complianceStatus === "Passed").length
      const passRate = Math.round((passed / total) * 100)
      const gradeVals = pkgs.map((p) => gradePoints(p.grade)).filter((g): g is number => g !== null)
      const avgPts = gradeVals.length ? gradeVals.reduce((a, b) => a + b, 0) / gradeVals.length : 0
      const avgRisk = Math.round(pkgs.reduce((a, p) => a + (p.riskScore ?? 0), 0) / total)
      const cats = vioByVendor[vendor] ?? {}
      const topViolation = Object.entries(cats).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "None"
      // Composite score: pass rate weighted, risk inverted.
      const score = Math.round(passRate * 0.6 + (100 - avgRisk) * 0.4)
      return { vendor, totalReviews: total, passRate, avgGrade: pointsToGrade(avgPts), avgRisk, topViolation, score }
    })
  }, [packages, violations])

  const topVendors = [...scorecards].sort((a, b) => b.score - a.score)
  const highRisk = [...scorecards].sort((a, b) => b.avgRisk - a.avgRisk)

  if (pkgLoading || vioLoading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
  }

  const renderCard = (s: Scorecard, rank: number) => (
    <Card key={s.vendor} className="hover-elevate transition-all">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-sm font-bold">#{rank}</div>
            <CardTitle className="text-lg">{s.vendor}</CardTitle>
          </div>
          <div className={`text-3xl font-black ${gradeColor(s.avgGrade)}`}>{s.avgGrade}</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">Pass Rate</span>
            <span className="font-medium">{s.passRate}%</span>
          </div>
          <Progress value={s.passRate} indicatorColor={s.passRate >= 70 ? "bg-success" : s.passRate >= 40 ? "bg-warning" : "bg-destructive"} />
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-accent/50 rounded-lg p-3">
            <div className="text-xl font-bold">{s.totalReviews}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Reviews</div>
          </div>
          <div className="bg-accent/50 rounded-lg p-3">
            <div className="text-xl font-bold">{s.avgRisk}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Avg Risk</div>
          </div>
          <div className="bg-accent/50 rounded-lg p-3">
            <div className="text-xl font-bold">{s.score}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Score</div>
          </div>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Most common issue</span>
          <Badge variant="outline">{s.topViolation}</Badge>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Trophy className="w-7 h-7 text-primary" /> Vendor Scorecards
        </h1>
        <p className="text-muted-foreground mt-1">Supplier compliance performance, ranked.</p>
      </div>

      <Tabs defaultValue="top">
        <TabsList>
          <TabsTrigger value="top" className="gap-2"><Trophy className="w-4 h-4" /> Top Vendors</TabsTrigger>
          <TabsTrigger value="risk" className="gap-2"><AlertTriangle className="w-4 h-4" /> High-Risk Vendors</TabsTrigger>
        </TabsList>
        <TabsContent value="top" className="mt-6">
          {topVendors.length === 0 ? (
            <p className="text-muted-foreground">No vendor data yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {topVendors.map((s, i) => renderCard(s, i + 1))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="risk" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {highRisk.map((s, i) => renderCard(s, i + 1))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
