import { useGetMyWork } from "@workspace/api-client-react"
import { Link } from "wouter"
import { Card, CardContent } from "@/components/ui/card"
import { ReviewOwnership } from "@/components/review-ownership"
import {
  Briefcase,
  Loader2,
  Clock,
  AlertTriangle,
  ShieldAlert,
  CheckCircle,
  Timer,
  ArrowRight,
} from "lucide-react"

function mins(n: number | null | undefined): string {
  if (n == null) return "—"
  if (n < 60) return `${Math.round(n)}m`
  return `${(n / 60).toFixed(1)}h`
}
function pct(n: number | null | undefined): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`
}

function Tile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: string | number
  icon: React.ComponentType<{ className?: string }>
  tone?: string
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`rounded-lg p-2 ${tone ?? "bg-primary/10 text-primary"}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <div className="text-2xl font-bold leading-none">{value}</div>
          <div className="text-xs text-muted-foreground mt-1">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function MyWorkPage() {
  const { data, isLoading } = useGetMyWork()

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Briefcase className="w-7 h-7 text-primary" /> My Work
        </h1>
        <p className="text-muted-foreground mt-1">Your review queue, workload, and service-level performance.</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : !data ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No work to show yet.</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <Tile label="Assigned" value={data.metrics.assigned} icon={Briefcase} />
            <Tile label="In progress" value={data.metrics.inProgress} icon={Timer} tone="bg-primary/10 text-primary" />
            <Tile label="Due today" value={data.metrics.dueToday} icon={Clock} tone={data.metrics.dueToday > 0 ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"} />
            <Tile label="Overdue" value={data.metrics.overdue} icon={AlertTriangle} tone={data.metrics.overdue > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"} />
            <Tile label="Escalated" value={data.metrics.escalated} icon={ShieldAlert} tone={data.metrics.escalated > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"} />
            <Tile label="Completed today" value={data.metrics.completedToday} icon={CheckCircle} tone="bg-success/10 text-success" />
            <Tile label="SLA compliance" value={pct(data.metrics.slaComplianceRate)} icon={ShieldAlert} tone="bg-success/10 text-success" />
            <Tile label="Avg review time" value={mins(data.metrics.avgReviewMinutes)} icon={Timer} tone="bg-muted text-muted-foreground" />
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-3">My queue</h2>
            {data.queue.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">Nothing assigned to you right now. 🎉</CardContent></Card>
            ) : (
              <div className="space-y-3">
                {data.queue.map((item) => (
                  <Card key={item.assignment.id} className="hover-elevate transition-all">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-xs font-mono text-muted-foreground">{item.packageSku}</div>
                          <Link href={`/reviews/${item.assignment.packageId}`}>
                            <span className="font-semibold hover:text-primary cursor-pointer">{item.packageName}</span>
                          </Link>
                          <div className="text-xs text-muted-foreground mt-0.5">{item.category}</div>
                        </div>
                        <Link href={`/reviews/${item.assignment.packageId}`}>
                          <ArrowRight className="w-4 h-4 text-muted-foreground hover:text-primary" />
                        </Link>
                      </div>
                      <div className="mt-3">
                        <ReviewOwnership assignment={item.assignment} variant="inline" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-3">Recent activity</h2>
            {data.recentActivity.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">No recent activity.</CardContent></Card>
            ) : (
              <Card>
                <CardContent className="p-0 divide-y divide-border">
                  {data.recentActivity.map((a) => (
                    <div key={a.id} className="p-3 text-sm flex items-start gap-3">
                      <Clock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div>
                          <span className="font-medium capitalize">{a.action}</span>
                          {" — "}
                          <Link href={`/reviews/${a.packageId}`}><span className="text-primary hover:underline cursor-pointer">{a.packageName}</span></Link>
                        </div>
                        {(a.detail || a.reason) && (
                          <div className="text-xs text-muted-foreground">{a.reason ? `${a.reason}. ` : ""}{a.detail}</div>
                        )}
                        <div className="text-[11px] text-muted-foreground mt-0.5">{a.actorName} • {new Date(a.createdAt).toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  )
}
