import {
  useListWorkload,
  getListWorkloadQueryKey,
} from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Gauge, Loader2, AlertTriangle, Timer } from "lucide-react"

function hours(n: number | null | undefined): string {
  if (n == null) return "—"
  if (n < 1) return `${Math.round(n * 60)}m`
  return `${n.toFixed(1)}h`
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

export default function SpecialistWorkloadPage() {
  const { data: rows = [], isLoading } = useListWorkload({
    query: { refetchInterval: 30_000, queryKey: getListWorkloadQueryKey() },
  })

  const totalActive = rows.reduce((s, r) => s + r.activeReviews, 0)
  const totalPending = rows.reduce((s, r) => s + r.pendingTasks, 0)
  const totalEscalated = rows.reduce((s, r) => s + r.escalatedReviews, 0)
  const overloaded = rows.filter((r) => r.maxActiveReviews > 0 && r.activeReviews >= r.maxActiveReviews).length

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Gauge className="w-7 h-7 text-primary" /> Workload Dashboard
        </h1>
        <p className="text-muted-foreground mt-1">Live utilization across specialists, computed from active review assignments.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Active reviews" value={totalActive} />
        <Stat label="Pending" value={totalPending} />
        <Stat label="Escalated" value={totalEscalated} tone={totalEscalated > 0 ? "text-destructive" : ""} />
        <Stat label="At capacity" value={overloaded} tone={overloaded > 0 ? "text-warning" : ""} />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No specialists to report on yet.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Specialist</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead className="w-56">Utilization</TableHead>
                  <TableHead className="text-center">Pending</TableHead>
                  <TableHead className="text-center">Escalated</TableHead>
                  <TableHead className="text-center">Avg resolution</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const pct = r.maxActiveReviews > 0 ? Math.min(100, Math.round((r.activeReviews / r.maxActiveReviews) * 100)) : 0
                  const atCap = r.maxActiveReviews > 0 && r.activeReviews >= r.maxActiveReviews
                  return (
                    <TableRow key={r.specialistId}>
                      <TableCell>
                        <div className="font-medium">{r.name}</div>
                        {!r.acceptingAssignments && <Badge variant="outline" className="text-muted-foreground text-xs mt-0.5">Not accepting</Badge>}
                      </TableCell>
                      <TableCell className="text-sm">{r.departmentName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={pct} className="h-2" />
                          <span className={`text-xs shrink-0 ${atCap ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                            {r.activeReviews}/{r.maxActiveReviews}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center text-sm">{r.pendingTasks}</TableCell>
                      <TableCell className="text-center">
                        {r.escalatedReviews > 0
                          ? <span className="inline-flex items-center gap-1 text-destructive text-sm"><AlertTriangle className="w-3.5 h-3.5" />{r.escalatedReviews}</span>
                          : <span className="text-sm text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell className="text-center text-sm">
                        <span className="inline-flex items-center gap-1"><Timer className="w-3.5 h-3.5 text-muted-foreground" />{hours(r.avgResolutionHours)}</span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
