import { useState, useEffect } from "react"
import { useListPackages } from "@workspace/api-client-react"
import { Link, useSearch } from "wouter"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Search, Loader2, ArrowRight, Clock, PackageX } from "lucide-react"
import { gradeBorder, gradeColor, riskBand } from "@/lib/compliance"

interface Props {
  title: string
  subtitle: string
  statusFilter?: string
  riskFilter?: string
  emptyText?: string
}

export default function PackagesView({
  title,
  subtitle,
  statusFilter,
  riskFilter,
  emptyText,
}: Props) {
  const searchString = useSearch()
  const initialQ = new URLSearchParams(searchString).get("q") ?? ""
  const [search, setSearch] = useState(initialQ)
  useEffect(() => {
    setSearch(initialQ)
  }, [initialQ])
  const { data: packages = [], isLoading } = useListPackages({
    search,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(riskFilter ? { risk: riskFilter } : {}),
  })

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground mt-1">{subtitle}</p>
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, SKU, vendor..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {!isLoading && packages.length > 0 && (
        <div className="text-sm text-muted-foreground">
          {packages.length} package{packages.length === 1 ? "" : "s"}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : packages.length === 0 ? (
        <div className="text-center py-24 border border-dashed rounded-xl bg-card">
          <PackageX className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-lg font-medium">No packages here</p>
          <p className="text-muted-foreground mt-1">
            {emptyText ?? "Nothing matches this view yet."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {packages.map((pkg) => {
            const band = riskBand(pkg.riskScore)
            return (
              <Card
                key={pkg.id}
                className="flex flex-col hover-elevate transition-all border-t-4"
                style={{ borderTopColor: gradeBorder(pkg.grade) }}
              >
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-xs font-mono text-muted-foreground mb-1">{pkg.sku}</div>
                      <h3 className="font-semibold text-lg leading-tight line-clamp-2">{pkg.name}</h3>
                      <div className="text-sm text-muted-foreground mt-1">{pkg.vendor} • {pkg.brand}</div>
                    </div>
                    {pkg.grade && (
                      <div className={`text-3xl font-black ${gradeColor(pkg.grade)}`}>{pkg.grade}</div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 pb-3">
                  <div className="flex flex-wrap gap-2 mb-4">
                    <Badge variant="outline">{pkg.status}</Badge>
                    {pkg.category && <Badge variant="outline">{pkg.category}</Badge>}
                    <Badge variant={band.badge}>{band.label} risk</Badge>
                  </div>
                  <div className="space-y-2 text-sm bg-accent/50 p-3 rounded-lg">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Risk Score</span>
                      <span className="font-mono font-medium">{pkg.riskScore ?? 0}/100</span>
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
                </CardContent>
                <CardFooter className="pt-0 justify-between border-t border-border mt-auto p-4">
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {new Date(pkg.updatedAt).toLocaleDateString()}
                  </div>
                  <Link href={`/reviews/${pkg.id}`}>
                    <Button variant="ghost" size="sm" className="gap-1">
                      Open <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
