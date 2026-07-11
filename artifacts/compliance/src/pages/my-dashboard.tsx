import { useGetMyWork, useListNotifications, useMarkNotificationRead } from "@workspace/api-client-react"
import { Link } from "wouter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ReviewOwnership } from "@/components/review-ownership"
import {
  LayoutDashboard,
  Loader2,
  Bell,
  ShieldCheck,
  Timer,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
} from "lucide-react"

function mins(n: number | null | undefined): string {
  if (n == null) return "—"
  if (n < 60) return `${Math.round(n)}m`
  return `${(n / 60).toFixed(1)}h`
}

export default function MyDashboardPage() {
  const { data, isLoading } = useGetMyWork()
  const { data: notifications = [] } = useListNotifications()
  const markRead = useMarkNotificationRead()

  const personal = notifications.filter((n) => n.userId != null)
  const unread = personal.filter((n) => !n.read)
  const sla = data?.metrics.slaComplianceRate
  const slaPct = sla == null ? null : Math.round(sla * 100)

  const dueSoon = (data?.queue ?? [])
    .filter((i) => i.assignment.dueAt && i.assignment.status !== "Completed")
    .slice(0, 5)

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <LayoutDashboard className="w-7 h-7 text-primary" /> My Dashboard
        </h1>
        <p className="text-muted-foreground mt-1">Your personal snapshot: performance, notifications, and what needs attention.</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : !data ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">Nothing to show yet.</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-success" />SLA compliance</CardTitle></CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{slaPct == null ? "—" : `${slaPct}%`}</div>
                {slaPct != null && <Progress value={slaPct} className="mt-2" />}
                <p className="text-xs text-muted-foreground mt-2">Across your completed reviews.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Timer className="w-4 h-4 text-primary" />Avg review time</CardTitle></CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{mins(data.metrics.avgReviewMinutes)}</div>
                <p className="text-xs text-muted-foreground mt-2">{data.metrics.completedToday} completed today.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-warning" />Needs attention</CardTitle></CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{data.metrics.overdue + data.metrics.escalated}</div>
                <p className="text-xs text-muted-foreground mt-2">{data.metrics.overdue} overdue · {data.metrics.escalated} escalated</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Bell className="w-5 h-5 text-primary" />My notifications
                  {unread.length > 0 && <Badge variant="destructive">{unread.length} new</Badge>}
                </CardTitle>
                <CardDescription>Assignments, priority and due-date changes, and escalations for you.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {personal.length === 0 ? (
                  <div className="py-10 text-center text-muted-foreground text-sm">No personal notifications.</div>
                ) : (
                  <div className="divide-y divide-border max-h-[420px] overflow-y-auto">
                    {personal.slice(0, 20).map((n) => (
                      <div key={n.id} className={`p-3 text-sm ${n.read ? "" : "bg-accent/40"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium">{n.title}</div>
                            <div className="text-xs text-muted-foreground">{n.message}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[11px] text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</span>
                              {n.packageId && (
                                <Link href={`/reviews/${n.packageId}`}><span className="text-[11px] text-primary hover:underline cursor-pointer">Open review</span></Link>
                              )}
                            </div>
                          </div>
                          {!n.read && (
                            <Button size="sm" variant="ghost" className="h-6 text-xs shrink-0"
                              onClick={() => markRead.mutate({ id: n.id })}>Mark read</Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><CheckCircle className="w-5 h-5 text-primary" />Due soon</CardTitle>
                <CardDescription>Your next reviews by deadline.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {dueSoon.length === 0 ? (
                  <div className="py-10 text-center text-muted-foreground text-sm">Nothing due — you're all caught up.</div>
                ) : (
                  dueSoon.map((item) => (
                    <div key={item.assignment.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/reviews/${item.assignment.packageId}`}>
                          <span className="font-medium text-sm hover:text-primary cursor-pointer">{item.packageName}</span>
                        </Link>
                        <Link href={`/reviews/${item.assignment.packageId}`}><ArrowRight className="w-4 h-4 text-muted-foreground" /></Link>
                      </div>
                      <div className="mt-2"><ReviewOwnership assignment={item.assignment} variant="inline" /></div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
