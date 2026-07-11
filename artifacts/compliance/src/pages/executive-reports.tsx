import {
  useGetDashboardStats,
  useGetVendorPerformance,
  useGetViolationDistribution,
  useGetCategoryDistribution,
  useGetComplianceTrends,
} from "@workspace/api-client-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
} from "recharts"
import { Briefcase, TrendingUp, ShieldAlert, CheckCircle, Loader2 } from "lucide-react"
import { normalizeEngine } from "@/lib/compliance"

export default function ExecutiveReports() {
  const { data: stats, isLoading: l1 } = useGetDashboardStats()
  const { data: vendors = [], isLoading: l2 } = useGetVendorPerformance()
  const { data: vioDist = [], isLoading: l3 } = useGetViolationDistribution()
  const { data: catDist = [], isLoading: l4 } = useGetCategoryDistribution()
  const { data: trends = [], isLoading: l5 } = useGetComplianceTrends()

  if (l1 || l2 || l3 || l4 || l5) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
  }

  const passRate = stats ? Math.round((stats.passed / (stats.totalPackages || 1)) * 100) : 0

  // Normalize the raw engine distribution into canonical buckets.
  const normalizedVio = Object.entries(
    vioDist.reduce<Record<string, number>>((acc, d) => {
      const k = normalizeEngine(d.label)
      acc[k] = (acc[k] ?? 0) + d.count
      return acc
    }, {}),
  )
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)

  const kpis = [
    { label: "Total Packages", value: stats?.totalPackages ?? 0, icon: Briefcase, color: "border-l-primary" },
    { label: "Pass Rate", value: `${passRate}%`, icon: CheckCircle, color: "border-l-success" },
    { label: "Critical Violations", value: stats?.criticalViolations ?? 0, icon: ShieldAlert, color: "border-l-destructive" },
    { label: "Review Velocity", value: `${stats?.complianceVelocity ?? 0}/day`, icon: TrendingUp, color: "border-l-warning" },
  ]

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Briefcase className="w-7 h-7 text-primary" /> Executive Reports
        </h1>
        <p className="text-muted-foreground mt-1">Program-level compliance health for leadership.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className={`border-l-4 ${k.color}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{k.label}</CardTitle>
              <k.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{typeof k.value === "number" ? k.value.toLocaleString() : k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Compliance Volume</CardTitle>
            <CardDescription>Passed vs failed over the last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trends} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                  <Area type="monotone" dataKey="passed" stackId="1" stroke="hsl(var(--success))" fill="hsl(var(--success))" fillOpacity={0.2} />
                  <Area type="monotone" dataKey="failed" stackId="1" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive))" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Violation Categories</CardTitle>
            <CardDescription>Where compliance risk concentrates</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={normalizedVio.slice(0, 8)} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="label" width={130} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Vendor Compliance Ranking</CardTitle>
            <CardDescription>Suppliers by compliance score</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {vendors.slice(0, 8).map((v) => (
              <div key={v.vendor} className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{v.vendor}</p>
                  <p className="text-xs text-muted-foreground">{v.packages} packages</p>
                </div>
                <div className="flex items-center gap-3 w-40">
                  <Progress value={v.complianceScore} indicatorColor={v.complianceScore > 80 ? "bg-success" : v.complianceScore > 60 ? "bg-warning" : "bg-destructive"} />
                  <Badge variant={v.complianceScore > 80 ? "success" : v.complianceScore > 60 ? "warning" : "destructive"}>{v.complianceScore}%</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Category Distribution</CardTitle>
            <CardDescription>Review volume by product category</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {catDist.slice(0, 8).map((c) => {
              const max = Math.max(...catDist.map((x) => x.count), 1)
              return (
                <div key={c.label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="truncate">{c.label}</span>
                    <span className="text-muted-foreground">{c.count}</span>
                  </div>
                  <Progress value={(c.count / max) * 100} />
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
