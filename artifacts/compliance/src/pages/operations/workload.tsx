import { useGetReviewMetrics, useGetReviewOversight } from "@workspace/api-client-react"
import type { OversightMember } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { initialsFor } from "@/components/review-ownership"
import {
  Gauge,
  Loader2,
  AlertTriangle,
  Timer,
  ShieldCheck,
  Users,
  UserRound,
} from "lucide-react"

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

const STATUS_META: Record<OversightMember["status"], { label: string; className: string }> = {
  idle: { label: "Idle", className: "text-muted-foreground border-border" },
  available: { label: "Available", className: "text-success border-success/40" },
  busy: { label: "Busy", className: "text-warning border-warning/40" },
  overloaded: { label: "Overloaded", className: "text-destructive border-destructive/40" },
}

export default function WorkloadDashboard() {
  const { data: oversight, isLoading } = useGetReviewOversight()
  const { data: metrics } = useGetReviewMetrics()

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Gauge className="w-7 h-7 text-primary" /> Workload & SLA
        </h1>
        <p className="text-muted-foreground mt-1">Review ownership, reviewer load, team capacity, and service-level performance.</p>
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
      ) : !oversight ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No workload data to show yet.</CardContent></Card>
      ) : (
        <Tabs defaultValue="reviewers">
          <TabsList>
            <TabsTrigger value="reviewers" className="gap-2"><UserRound className="w-4 h-4" />Reviewers</TabsTrigger>
            <TabsTrigger value="teams" className="gap-2"><Users className="w-4 h-4" />Teams</TabsTrigger>
          </TabsList>

          <TabsContent value="reviewers" className="mt-4">
            {oversight.members.length === 0 ? (
              <Card><CardContent className="py-14 text-center text-muted-foreground">No reviewers in scope.</CardContent></Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {oversight.members.map((m) => {
                  const meta = STATUS_META[m.status]
                  const util = Math.round(m.utilization * 100)
                  return (
                    <Card key={m.userId} className={m.status === "overloaded" ? "border-destructive/40" : ""}>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{initialsFor(m.name)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{m.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{m.teamNames.join(", ") || "No team"}</div>
                          </div>
                          <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
                        </div>

                        <div>
                          <Progress value={Math.min(util, 100)} />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{m.assigned}/{m.capacity} active</span>
                            <span>{util}% utilized</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-center text-xs">
                          <div><div className="font-semibold text-sm">{m.inProgress}</div><div className="text-muted-foreground">In progress</div></div>
                          <div><div className={`font-semibold text-sm ${m.overdue > 0 ? "text-destructive" : ""}`}>{m.overdue}</div><div className="text-muted-foreground">Overdue</div></div>
                          <div><div className={`font-semibold text-sm ${m.escalated > 0 ? "text-warning" : ""}`}>{m.escalated}</div><div className="text-muted-foreground">Escalated</div></div>
                        </div>

                        <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border/60 pt-2">
                          <span className="flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" />{pct(m.slaComplianceRate)} SLA</span>
                          <span className="flex items-center gap-1"><Timer className="w-3.5 h-3.5" />Avg {mins(m.avgReviewMinutes)}</span>
                          <span>{m.completedToday} done today</span>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="teams" className="mt-4">
            {oversight.teams.length === 0 ? (
              <Card><CardContent className="py-14 text-center text-muted-foreground">No teams to show.</CardContent></Card>
            ) : (
              <div className="space-y-4">
                {oversight.teams.map((t) => {
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
                            <span className={`font-semibold ${tone}`}>{t.assigned}/{t.capacity} active</span>
                          </div>
                        </div>
                        <div className="pt-2">
                          <Progress value={Math.min(util, 100)} />
                          <div className="text-xs text-muted-foreground mt-1">{util}% utilized</div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                          <div><div className="font-semibold">{t.open}</div><div className="text-xs text-muted-foreground">Open</div></div>
                          <div><div className={`font-semibold ${t.overdue > 0 ? "text-destructive" : ""}`}>{t.overdue}</div><div className="text-xs text-muted-foreground">Overdue</div></div>
                          <div><div className={`font-semibold ${t.critical > 0 ? "text-destructive" : ""}`}>{t.critical}</div><div className="text-xs text-muted-foreground">Critical</div></div>
                          <div><div className="font-semibold text-success">{pct(t.slaComplianceRate)}</div><div className="text-xs text-muted-foreground">SLA on time</div></div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
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

      {oversight && oversight.members.some((m) => m.status === "overloaded") && (
        <Card className="border-warning/40">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
            <span className="text-sm">
              {oversight.members.filter((m) => m.status === "overloaded").map((m) => m.name).join(", ")} {" "}
              {oversight.members.filter((m) => m.status === "overloaded").length === 1 ? "is" : "are"} over capacity — consider rebalancing their reviews.
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
