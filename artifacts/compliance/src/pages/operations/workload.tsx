import { useGetReviewWorkload, useGetReviewMetrics } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Gauge, Loader2, AlertTriangle, Timer, ShieldCheck, ArrowRightLeft } from "lucide-react"

function pct(n: number | null | undefined): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`
}
function mins(n: number | null | undefined): string {
  if (n == null) return "—"
  if (n < 60) return `${Math.round(n)}m`
  return `${(n / 60).toFixed(1)}h`
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

export default function WorkloadDashboard() {
  const { data: workload, isLoading } = useGetReviewWorkload()
  const { data: metrics } = useGetReviewMetrics()

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Gauge className="w-7 h-7 text-primary" /> Workload & SLA
        </h1>
        <p className="text-muted-foreground mt-1">Live team capacity, reviewer load, and service-level performance.</p>
      </div>

      {metrics && (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Stat label="SLA compliance" value={pct(metrics.slaComplianceRate)} tone="text-success" />
          <Stat label="Open reviews" value={metrics.openReviews} />
          <Stat label="Overdue" value={metrics.overdueReviews} tone={metrics.overdueReviews > 0 ? "text-destructive" : ""} />
          <Stat label="Escalated" value={metrics.escalatedReviews} tone={metrics.escalatedReviews > 0 ? "text-warning" : ""} />
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : !workload || workload.teams.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No team workload to show yet.</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {workload.unassignedCount > 0 && (
            <Card className="border-warning/40">
              <CardContent className="p-4 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-warning" />
                <span className="text-sm font-medium">{workload.unassignedCount} package(s) are waiting to be assigned.</span>
              </CardContent>
            </Card>
          )}

          {workload.teams.map((t) => {
            const util = Math.round(t.utilization * 100)
            const tone = util >= 100 ? "text-destructive" : util >= 80 ? "text-warning" : "text-success"
            return (
              <Card key={t.teamId}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2">{t.teamName}
                      <Badge variant="secondary">{t.memberCount} members</Badge>
                    </CardTitle>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="flex items-center gap-1 text-muted-foreground"><Timer className="w-4 h-4" />Avg {mins(t.avgReviewMinutes)}</span>
                      <span className={`font-semibold ${tone}`}>{t.activeCount}/{t.capacity} active</span>
                    </div>
                  </div>
                  <div className="pt-2">
                    <Progress value={Math.min(util, 100)} />
                    <div className="text-xs text-muted-foreground mt-1">{util}% utilized</div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {t.members.map((m) => {
                      const mu = Math.round(m.utilization * 100)
                      return (
                        <div key={m.userId} className={`rounded-lg border p-3 ${m.overloaded ? "border-destructive/40 bg-destructive/5" : "border-border"}`}>
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">{m.name}</span>
                            {m.overloaded && <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" />Overloaded</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {m.activeCount}/{m.capacity} active · {m.inProgressCount} in progress · {mu}%
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {t.recommendations.length > 0 && (
                    <div className="rounded-lg bg-accent/40 p-3 space-y-1.5">
                      <div className="flex items-center gap-2 text-sm font-medium"><ArrowRightLeft className="w-4 h-4 text-primary" />Rebalancing suggestions</div>
                      {t.recommendations.map((r, i) => (
                        <div key={i} className="text-xs text-muted-foreground">{r.reason}</div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {metrics && metrics.byTeam.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" />SLA performance by team</CardTitle>
            <CardDescription>Completed reviews and on-time rate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {metrics.byTeam.map((tm) => (
              <div key={tm.teamName} className="flex items-center justify-between text-sm border-b border-border/60 last:border-0 py-2">
                <span className="font-medium">{tm.teamName}</span>
                <span className="flex items-center gap-4 text-muted-foreground">
                  <span>{tm.completed} completed</span>
                  <span>Avg {mins(tm.avgReviewMinutes)}</span>
                  <span className="text-success font-medium">{pct(tm.slaComplianceRate)} on time</span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
