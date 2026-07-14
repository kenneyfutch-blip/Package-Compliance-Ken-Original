import { useState, useEffect, useMemo } from "react"
import { Link, useSearch } from "wouter"
import {
  useListPackages,
  useListReviewAssignments,
  type AssignmentListItem,
} from "@workspace/api-client-react"
import {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ReviewOwnership } from "@/components/review-ownership"
import { Loader2, PackageX, ArrowRight, Sparkles, Users, Search, AlertCircle, RefreshCw } from "lucide-react"

// "Active Reviews" = everything currently moving through the review pipeline:
// packages the AI is still analyzing (package.status === "AI Review") AND
// packages a specialist has an open assignment on. The latter never shows up
// under a package-status filter because an assigned package keeps its own status
// (e.g. "Needs Review"), so we pull it from the assignment side instead.
const ACTIVE_STATUSES = ["Assigned", "InProgress", "Escalated"] as const

function sortAssignments(items: AssignmentListItem[]): AssignmentListItem[] {
  return [...items].sort((a, b) => {
    // Escalated work floats to the top, then soonest-due (overdue first).
    const esc = Number(b.assignment.escalationLevel > 0) - Number(a.assignment.escalationLevel > 0)
    if (esc !== 0) return esc
    const da = a.assignment.dueAt ? new Date(a.assignment.dueAt).getTime() : Infinity
    const db = b.assignment.dueAt ? new Date(b.assignment.dueAt).getTime() : Infinity
    return da - db
  })
}

export default function ActiveReviews() {
  const searchString = useSearch()
  const initialQ = new URLSearchParams(searchString).get("q") ?? ""
  const [search, setSearch] = useState(initialQ)
  useEffect(() => {
    setSearch(initialQ)
  }, [initialQ])

  // The list endpoints cap results at this server-side max. We request the max
  // and surface a notice if a bucket hits it, rather than silently dropping
  // genuinely-active rows from a page whose whole job is to be complete.
  const LIST_LIMIT = 200

  // Packages the AI is still analyzing.
  const aiQ = useListPackages({
    status: "AI Review",
    limit: LIST_LIMIT,
    ...(search ? { search } : {}),
  })
  const aiPackages = aiQ.data ?? []
  const aiLoading = aiQ.isLoading

  // Packages under active specialist review. The endpoint filters by a single
  // status, so we query each active status separately — this keeps completed
  // assignments from crowding active ones off a shared paginated result.
  const assignedQ = useListReviewAssignments({ status: "Assigned", limit: LIST_LIMIT })
  const inProgressQ = useListReviewAssignments({ status: "InProgress", limit: LIST_LIMIT })
  const escalatedQ = useListReviewAssignments({ status: "Escalated", limit: LIST_LIMIT })
  const assignmentsLoading =
    assignedQ.isLoading || inProgressQ.isLoading || escalatedQ.isLoading

  const isError =
    aiQ.isError || assignedQ.isError || inProgressQ.isError || escalatedQ.isError
  const refetchAll = () => {
    void aiQ.refetch()
    void assignedQ.refetch()
    void inProgressQ.refetch()
    void escalatedQ.refetch()
  }
  const capped =
    aiPackages.length >= LIST_LIMIT ||
    (assignedQ.data?.length ?? 0) >= LIST_LIMIT ||
    (inProgressQ.data?.length ?? 0) >= LIST_LIMIT ||
    (escalatedQ.data?.length ?? 0) >= LIST_LIMIT

  const assignments = useMemo(() => {
    const merged = [
      ...(assignedQ.data ?? []),
      ...(inProgressQ.data ?? []),
      ...(escalatedQ.data ?? []),
    ]
    const q = search.trim().toLowerCase()
    const filtered = q
      ? merged.filter(
          (i) =>
            i.packageName.toLowerCase().includes(q) ||
            (i.packageSku ?? "").toLowerCase().includes(q),
        )
      : merged
    return sortAssignments(filtered)
  }, [assignedQ.data, inProgressQ.data, escalatedQ.data, search])

  const loading = aiLoading || assignmentsLoading
  const total = assignments.length + aiPackages.length
  const nothing = !loading && total === 0

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Active Reviews</h1>
          <p className="text-muted-foreground mt-1">
            Packages currently in AI or specialist review.
          </p>
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or SKU..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {!loading && !isError && total > 0 && (
        <div className="text-sm text-muted-foreground">
          {total} package{total === 1 ? "" : "s"} in review
          {assignments.length > 0 && ` · ${assignments.length} with a specialist`}
          {aiPackages.length > 0 && ` · ${aiPackages.length} in AI analysis`}
        </div>
      )}

      {!loading && !isError && capped && (
        <div className="flex items-center gap-2 text-sm text-warning border border-warning/40 bg-warning/5 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Showing the first {LIST_LIMIT} of each kind. Narrow with search to see more.
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <div className="text-center py-24 border border-dashed rounded-xl bg-card">
          <AlertCircle className="w-10 h-10 mx-auto text-destructive mb-3" />
          <p className="text-lg font-medium">Couldn't load active reviews</p>
          <p className="text-muted-foreground mt-1 mb-4">
            Something went wrong fetching the review queue. Your data is safe — try again.
          </p>
          <Button variant="outline" onClick={refetchAll} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Retry
          </Button>
        </div>
      ) : nothing ? (
        <div className="text-center py-24 border border-dashed rounded-xl bg-card">
          <PackageX className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-lg font-medium">No active reviews right now</p>
          <p className="text-muted-foreground mt-1">
            Packages appear here while the AI is analyzing them or a specialist is
            reviewing them.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {assignments.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
                <Users className="w-4 h-4 text-primary" /> In specialist review
                <span className="font-normal normal-case">({assignments.length})</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {assignments.map((item) => (
                  <Card
                    key={item.assignment.id}
                    className="flex flex-col hover-elevate transition-all"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-mono text-muted-foreground mb-1">
                            {item.packageSku ?? "—"}
                          </div>
                          <Link href={`/reviews/${item.assignment.packageId}`}>
                            <h3 className="font-semibold text-lg leading-tight line-clamp-2 hover:text-primary cursor-pointer">
                              {item.packageName}
                            </h3>
                          </Link>
                          {item.category && (
                            <div className="text-sm text-muted-foreground mt-1">
                              {item.category}
                            </div>
                          )}
                        </div>
                        {item.criticalCount > 0 && (
                          <Badge variant="destructive" className="shrink-0">
                            {item.criticalCount} Crit
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="flex-1 pb-3">
                      <ReviewOwnership assignment={item.assignment} variant="card" />
                    </CardContent>
                    <CardFooter className="pt-0 justify-end border-t border-border mt-auto p-4">
                      <Link href={`/reviews/${item.assignment.packageId}`}>
                        <Button variant="ghost" size="sm" className="gap-1">
                          Open <ArrowRight className="w-4 h-4" />
                        </Button>
                      </Link>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {aiPackages.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
                <Sparkles className="w-4 h-4 text-primary" /> In AI analysis
                <span className="font-normal normal-case">({aiPackages.length})</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {aiPackages.map((pkg) => (
                  <Card key={pkg.id} className="flex flex-col hover-elevate transition-all">
                    <CardHeader className="pb-3">
                      <div className="text-xs font-mono text-muted-foreground mb-1">
                        {pkg.sku}
                      </div>
                      <Link href={`/reviews/${pkg.id}`}>
                        <h3 className="font-semibold text-lg leading-tight line-clamp-2 hover:text-primary cursor-pointer">
                          {pkg.name}
                        </h3>
                      </Link>
                      <div className="text-sm text-muted-foreground mt-1">
                        {pkg.vendor}
                        {pkg.brand ? ` • ${pkg.brand}` : ""}
                      </div>
                    </CardHeader>
                    <CardContent className="flex-1 pb-3">
                      <div className="flex items-center gap-2 text-sm text-primary font-medium">
                        <Loader2 className="w-4 h-4 animate-spin" /> AI analyzing…
                      </div>
                      {pkg.category && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          <Badge variant="outline">{pkg.category}</Badge>
                        </div>
                      )}
                    </CardContent>
                    <CardFooter className="pt-0 justify-end border-t border-border mt-auto p-4">
                      <Link href={`/reviews/${pkg.id}`}>
                        <Button variant="ghost" size="sm" className="gap-1">
                          Open <ArrowRight className="w-4 h-4" />
                        </Button>
                      </Link>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
