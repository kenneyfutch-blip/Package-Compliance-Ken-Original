import { useState } from "react"
import {
  useListPackages,
  useListReviewAssignments,
  useGetReviewPresence,
  getGetReviewPresenceQueryKey,
  useGetReviewLocks,
  getGetReviewLocksQueryKey,
} from "@workspace/api-client-react"
import { Link } from "wouter"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Search, Loader2, ArrowRight, Clock } from "lucide-react"
import { ReviewOwnership } from "@/components/review-ownership"
import { PresenceStrip, LockIndicator } from "@/components/presence-indicators"
import { usePermissions } from "@/lib/access"

export default function ReviewsPage() {
  const [search, setSearch] = useState("")
  const { me } = usePermissions()
  const canSeePresence = !!me && me.roleKey !== "supplier_user"
  const { data: packages = [], isLoading } = useListPackages({ search })
  const { data: assignments = [] } = useListReviewAssignments()
  const { data: presence } = useGetReviewPresence({
    query: {
      enabled: canSeePresence,
      refetchInterval: canSeePresence ? 10_000 : false,
      queryKey: getGetReviewPresenceQueryKey(),
    },
  })
  const { data: locks = [] } = useGetReviewLocks({
    query: {
      enabled: canSeePresence,
      refetchInterval: canSeePresence ? 10_000 : false,
      queryKey: getGetReviewLocksQueryKey(),
    },
  })
  const lockByPkg = new Map(locks.map((l) => [l.packageId, l]))
  const assignmentByPkg = new Map(
    assignments.map((a) => [a.assignment.packageId, a.assignment]),
  )

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reviews</h1>
          <p className="text-muted-foreground mt-1">Browse all packaging compliance reviews.</p>
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search reviews..." 
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {canSeePresence && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <span className="text-sm font-medium text-muted-foreground">Reviewers online</span>
          <PresenceStrip presence={presence} />
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : packages.length === 0 ? (
        <div className="text-center py-24 border border-dashed rounded-xl bg-card">
          <p className="text-lg font-medium">No reviews found</p>
          <p className="text-muted-foreground mt-1">Try adjusting your search filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {packages.map(pkg => (
            <Card key={pkg.id} className="flex flex-col hover-elevate transition-all border-t-4" style={{
              borderTopColor: pkg.grade === 'A' || pkg.grade === 'B' ? 'hsl(var(--success))' : pkg.grade === 'F' ? 'hsl(var(--destructive))' : pkg.grade ? 'hsl(var(--warning))' : 'hsl(var(--muted))'
            }}>
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-xs font-mono text-muted-foreground mb-1">{pkg.sku}</div>
                    <h3 className="font-semibold text-lg leading-tight line-clamp-2">{pkg.name}</h3>
                    <div className="text-sm text-muted-foreground mt-1">{pkg.vendor} • {pkg.brand}</div>
                  </div>
                  {pkg.grade && (
                    <div className={`text-3xl font-black ${pkg.grade === 'A' || pkg.grade === 'B' ? 'text-success' : pkg.grade === 'F' ? 'text-destructive' : 'text-warning'}`}>
                      {pkg.grade}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex-1 pb-3">
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <Badge variant="outline">{pkg.status}</Badge>
                  <Badge variant="outline">{pkg.category}</Badge>
                  {lockByPkg.has(pkg.id) && (
                    <LockIndicator
                      lock={lockByPkg.get(pkg.id)!}
                      isMine={!!me && lockByPkg.get(pkg.id)!.userId === me.id}
                    />
                  )}
                </div>

                {assignmentByPkg.has(pkg.id) && (
                  <div className="mb-4">
                    <ReviewOwnership assignment={assignmentByPkg.get(pkg.id)} variant="inline" />
                  </div>
                )}
                
                {pkg.status !== 'Draft' && (
                  <div className="space-y-2 text-sm bg-accent/50 p-3 rounded-lg">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Risk Score</span>
                      <span className="font-mono font-medium">{pkg.riskScore || 0}/100</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Violations</span>
                      <div className="flex gap-2">
                        {pkg.criticalCount > 0 && <span className="text-destructive font-semibold">{pkg.criticalCount} Crit</span>}
                        {pkg.majorCount > 0 && <span className="text-warning font-semibold">{pkg.majorCount} Maj</span>}
                        {pkg.criticalCount === 0 && pkg.majorCount === 0 && <span className="text-success font-medium">None</span>}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
              <CardFooter className="pt-0 justify-between border-t border-border mt-auto p-4">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {new Date(pkg.updatedAt).toLocaleDateString()}
                </div>
                <Link href={`/reviews/${pkg.id}`}>
                  <Button variant="ghost" size="sm" className="gap-1">
                    Workspace <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
