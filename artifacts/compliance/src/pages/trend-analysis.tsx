import { useGetComplianceTrends } from "@workspace/api-client-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts"
import { LineChart as LineIcon, Loader2 } from "lucide-react"

export default function TrendAnalysis() {
  const { data: trends = [], isLoading } = useGetComplianceTrends()

  if (isLoading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
  }

  const totalPassed = trends.reduce((a, t) => a + (t.passed ?? 0), 0)
  const totalFailed = trends.reduce((a, t) => a + (t.failed ?? 0), 0)
  const avgRisk = trends.length ? Math.round(trends.reduce((a, t) => a + (t.avgRisk ?? 0), 0) / trends.length) : 0
  const passRate = totalPassed + totalFailed ? Math.round((totalPassed / (totalPassed + totalFailed)) * 100) : 0

  const summary = [
    { label: "Total Passed", value: totalPassed, tone: "text-success" },
    { label: "Total Failed", value: totalFailed, tone: "text-destructive" },
    { label: "Avg Risk", value: avgRisk, tone: "text-warning" },
    { label: "Pass Rate", value: `${passRate}%`, tone: "text-primary" },
  ]

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <LineIcon className="w-7 h-7 text-primary" /> Trend Analysis
        </h1>
        <p className="text-muted-foreground mt-1">Compliance patterns over the last 30 days.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {summary.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-6">
              <div className={`text-2xl font-bold ${s.tone}`}>{typeof s.value === "number" ? s.value.toLocaleString() : s.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pass / Fail Trend</CardTitle>
          <CardDescription>Daily review outcomes</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trends} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                <Legend />
                <Line type="monotone" dataKey="passed" stroke="hsl(var(--success))" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="failed" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Review Volume</CardTitle>
            <CardDescription>Packages reviewed per day</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trends} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                  <Bar dataKey="reviewVolume" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Average Risk Score</CardTitle>
            <CardDescription>Portfolio risk trend</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trends} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                  <Line type="monotone" dataKey="avgRisk" stroke="hsl(var(--warning))" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
