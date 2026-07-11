import {
  useGetDashboardStats,
  useGetQueueMetrics,
  useGetSystemHealth,
  useGetReviewMetrics,
  useListAuditEvents,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  LayoutDashboard,
  Activity,
  ShieldCheck,
  Server,
  Users,
  Loader2
} from "lucide-react";

function pct(n: number | null | undefined): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

function mins(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 60) return `${Math.round(n)}m`;
  return `${(n / 60).toFixed(1)}h`;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold mt-1 ${tone ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

export default function AdminDashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: queue, isLoading: queueLoading } = useGetQueueMetrics();
  const { data: health, isLoading: healthLoading } = useGetSystemHealth();
  const { data: metrics, isLoading: metricsLoading } = useGetReviewMetrics();
  const { data: audit, isLoading: auditLoading } = useListAuditEvents({ limit: 5 });

  const isLoading = statsLoading || queueLoading || healthLoading || metricsLoading || auditLoading;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <LayoutDashboard className="w-7 h-7 text-primary" /> Command Center
        </h1>
        <p className="text-muted-foreground mt-1">Live snapshot of the compliance operation.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : (
        <>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <Stat label="Reviews Today" value={stats?.reviewedToday ?? 0} />
            <Stat label="Critical Violations" value={stats?.criticalViolations ?? 0} tone={stats?.criticalViolations ? "text-destructive" : "text-success"} />
            <Stat label="SLA Compliance" value={pct(metrics?.slaComplianceRate)} tone="text-success" />
            <Stat label="Avg Review Time" value={mins(stats?.avgReviewMinutes)} />
          </div>

          <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5 text-primary" /> Team Performance</CardTitle>
                <CardDescription>SLA and output by team.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Team</TableHead>
                      <TableHead className="text-right">Completed</TableHead>
                      <TableHead className="text-right">Avg Time</TableHead>
                      <TableHead className="text-right">SLA Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {metrics?.byTeam?.map(t => (
                      <TableRow key={t.teamName}>
                        <TableCell className="font-medium">{t.teamName}</TableCell>
                        <TableCell className="text-right">{t.completed}</TableCell>
                        <TableCell className="text-right">{mins(t.avgReviewMinutes)}</TableCell>
                        <TableCell className="text-right text-success">{pct(t.slaComplianceRate)}</TableCell>
                      </TableRow>
                    ))}
                    {!metrics?.byTeam?.length && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">No team data</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Server className="w-5 h-5 text-primary" /> System Health</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Overall Status</span>
                  <Badge variant="outline" className={
                    health?.overall === "operational" ? "border-success text-success bg-success/10" :
                    health?.overall === "degraded" ? "border-warning text-warning bg-warning/10" : "border-destructive text-destructive bg-destructive/10"
                  }>{health?.overall?.toUpperCase()}</Badge>
                </div>
                <div className="space-y-2">
                  {health?.services?.map(s => (
                    <div key={s.name} className="flex justify-between items-center text-sm border-b border-border/50 pb-2 last:border-0">
                      <span>{s.name}</span>
                      <span className={s.status === "operational" ? "text-success" : s.status === "degraded" ? "text-warning" : "text-destructive"}>{s.status}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Activity className="w-5 h-5 text-primary" /> Queue & Backlog</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div className="space-y-1 bg-muted/50 p-4 rounded-lg">
                  <div className="text-sm text-muted-foreground">Pending Jobs</div>
                  <div className="text-2xl font-bold">{queue?.byStatus?.pending ?? 0}</div>
                </div>
                <div className="space-y-1 bg-muted/50 p-4 rounded-lg">
                  <div className="text-sm text-muted-foreground">Running Jobs</div>
                  <div className="text-2xl font-bold text-primary">{queue?.byStatus?.running ?? 0}</div>
                </div>
                <div className="space-y-1 bg-muted/50 p-4 rounded-lg">
                  <div className="text-sm text-muted-foreground">Completed (24h)</div>
                  <div className="text-2xl font-bold text-success">{queue?.completed24h ?? 0}</div>
                </div>
                <div className="space-y-1 bg-muted/50 p-4 rounded-lg">
                  <div className="text-sm text-muted-foreground">Failed (24h)</div>
                  <div className={`text-2xl font-bold ${queue?.failed24h ? "text-destructive" : ""}`}>{queue?.failed24h ?? 0}</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" /> Recent Audit Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {audit?.map(e => (
                    <div key={e.id} className="flex flex-col text-sm border-b border-border/50 pb-2 last:border-0">
                      <div className="flex justify-between items-start gap-2">
                        <span className="font-medium text-foreground">{e.actor}</span>
                        <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">{new Date(e.createdAt).toLocaleTimeString()}</span>
                      </div>
                      <div className="text-muted-foreground mt-1">
                        <Badge variant="secondary" className="text-[10px] py-0 mr-2">{e.action}</Badge>
                        {e.detail || (e.entityType ? `Updated ${e.entityType}` : "System action")}
                      </div>
                    </div>
                  ))}
                  {!audit?.length && <div className="text-center text-muted-foreground">No recent activity.</div>}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
