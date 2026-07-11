import {
  useGetQueueMetrics,
  useGetSystemHealth,
  getGetQueueMetricsQueryKey,
  getGetSystemHealthQueryKey,
} from "@workspace/api-client-react"
import type { Job } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Activity, Loader2, CheckCircle2, AlertTriangle, XCircle, Server, ListChecks } from "lucide-react"

function healthTone(status: string): string {
  if (status === "operational") return "text-success"
  if (status === "degraded" || status === "idle") return "text-warning"
  return "text-destructive"
}
function HealthIcon({ status }: { status: string }) {
  if (status === "operational") return <CheckCircle2 className="w-5 h-5 text-success" />
  if (status === "degraded" || status === "idle") return <AlertTriangle className="w-5 h-5 text-warning" />
  return <XCircle className="w-5 h-5 text-destructive" />
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold mt-1 ${tone ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  )
}

function fmt(dt: string | null | undefined): string {
  return dt ? new Date(dt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—"
}

export default function SystemHealthPage() {
  const { data: metrics, isLoading: metricsLoading } = useGetQueueMetrics({
    query: { queryKey: getGetQueueMetricsQueryKey(), refetchInterval: 15000 },
  })
  const { data: health, isLoading: healthLoading } = useGetSystemHealth({
    query: { queryKey: getGetSystemHealthQueryKey(), refetchInterval: 15000 },
  })

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="w-7 h-7 text-primary" /> Queue & System Health
        </h1>
        <p className="text-muted-foreground mt-1">Background job throughput, backlog, and live service status. Auto-refreshes.</p>
      </div>

      {/* Service health */}
      {healthLoading ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : health && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2"><Server className="w-5 h-5 text-primary" />System status</CardTitle>
              <Badge className={`gap-1 ${health.overall === "operational" ? "bg-success/10 text-success hover:bg-success/20" : health.overall === "degraded" ? "bg-warning/10 text-warning hover:bg-warning/20" : "bg-destructive/10 text-destructive hover:bg-destructive/20"}`}>
                {health.overall}
              </Badge>
            </div>
            <CardDescription>Last checked {fmt(health.checkedAt)}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {health.services.map((s) => (
              <div key={s.name} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <HealthIcon status={s.status} />
                <div>
                  <div className="font-medium text-sm">{s.name}</div>
                  <div className={`text-xs ${healthTone(s.status)}`}>{s.detail}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Queue metrics */}
      {metricsLoading ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : metrics && (
        <>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <Stat label="Backlog" value={metrics.backlog} tone={metrics.backlog > 0 ? "text-warning" : ""} />
            <Stat label="Completed (24h)" value={metrics.completed24h} tone="text-success" />
            <Stat label="Failed (24h)" value={metrics.failed24h} tone={metrics.failed24h > 0 ? "text-destructive" : ""} />
            <Stat label="Running" value={metrics.byStatus.running ?? 0} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ListChecks className="w-5 h-5 text-primary" />Throughput by job type</CardTitle>
              <CardDescription>Current queue state per background job type.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {metrics.byType.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">No jobs recorded yet.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                      <TableHead className="text-right">Running</TableHead>
                      <TableHead className="text-right">Completed</TableHead>
                      <TableHead className="text-right">Failed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {metrics.byType.map((t) => (
                      <TableRow key={t.type}>
                        <TableCell className="font-mono text-sm">{t.type}</TableCell>
                        <TableCell className="text-right">{t.pending}</TableCell>
                        <TableCell className="text-right">{t.running}</TableCell>
                        <TableCell className="text-right text-success">{t.completed}</TableCell>
                        <TableCell className={`text-right ${t.failed > 0 ? "text-destructive font-medium" : ""}`}>{t.failed}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {metrics.recentFailures.length > 0 && (
            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive"><AlertTriangle className="w-5 h-5" />Recent failures</CardTitle>
                <CardDescription>The most recently failed background jobs and their last error.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {metrics.recentFailures.map((j: Job) => (
                  <div key={j.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm">{j.type}</span>
                      <span className="text-xs text-muted-foreground">{fmt(j.updatedAt)} · {j.attempts}/{j.maxAttempts} attempts</span>
                    </div>
                    {j.lastError && <div className="text-xs text-destructive mt-1 break-words">{j.lastError}</div>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
