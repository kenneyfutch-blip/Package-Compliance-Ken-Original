import { useState } from "react"
import { useListPackages, useBulkAnalyze } from "@workspace/api-client-react"
import { Link, useLocation } from "wouter"
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Search, Filter, Loader2, PlayCircle, Eye, AlertCircle, CheckCircle } from "lucide-react"

export default function BulkQueuePage() {
  const [search, setSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [, setLocation] = useLocation()
  
  const { data: packages = [], isLoading, refetch } = useListPackages({ search })
  const bulkAnalyze = useBulkAnalyze()

  const toggleSelectAll = () => {
    if (selectedIds.size === packages.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(packages.map(p => p.id)))
    }
  }

  const toggleSelect = (id: number) => {
    const newSet = new Set(selectedIds)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setSelectedIds(newSet)
  }

  const handleBulkAnalyze = () => {
    if (selectedIds.size === 0) return
    bulkAnalyze.mutate({ data: { ids: Array.from(selectedIds) } }, {
      onSuccess: () => {
        setSelectedIds(new Set())
        refetch()
      }
    })
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bulk Process Queue</h1>
          <p className="text-muted-foreground mt-1">Manage and analyze packages at scale.</p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={handleBulkAnalyze} 
            disabled={selectedIds.size === 0 || bulkAnalyze.isPending}
            className="gap-2"
          >
            {bulkAnalyze.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            Analyze Selected ({selectedIds.size})
          </Button>
        </div>
      </div>

      <Card>
        <div className="p-4 border-b border-border flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search SKU, name, vendor..." 
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" className="gap-2">
            <Filter className="w-4 h-4" /> Filters
          </Button>
        </div>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">
                  <Checkbox 
                    checked={packages.length > 0 && selectedIds.size === packages.length}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>SKU / Name</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead className="text-right">Risk</TableHead>
                <TableHead className="text-right">Violations</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Loading queue...
                  </TableCell>
                </TableRow>
              ) : packages.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                    No packages found.
                  </TableCell>
                </TableRow>
              ) : packages.map(pkg => (
                <TableRow key={pkg.id} className="group">
                  <TableCell>
                    <Checkbox 
                      checked={selectedIds.has(pkg.id)}
                      onCheckedChange={() => toggleSelect(pkg.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-foreground">{pkg.sku}</div>
                    <div className="text-xs text-muted-foreground max-w-[200px] truncate" title={pkg.name}>{pkg.name}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{pkg.vendor}</div>
                    <div className="text-xs text-muted-foreground">{pkg.brand}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={pkg.status === 'Approved' ? 'success' : pkg.status.includes('Needs') ? 'warning' : 'secondary'}>
                      {pkg.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {pkg.grade ? (
                      <span className={`font-bold text-lg ${pkg.grade === 'A' || pkg.grade === 'B' ? 'text-success' : pkg.grade === 'F' ? 'text-destructive' : 'text-warning'}`}>
                        {pkg.grade}
                      </span>
                    ) : '-'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {pkg.riskScore ? (
                      <span className={pkg.riskScore > 70 ? 'text-destructive font-bold' : pkg.riskScore > 30 ? 'text-warning' : 'text-success'}>
                        {pkg.riskScore}
                      </span>
                    ) : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {pkg.criticalCount > 0 && <Badge variant="destructive" className="px-1.5 h-5 rounded-sm">{pkg.criticalCount}</Badge>}
                      {pkg.majorCount > 0 && <Badge variant="warning" className="px-1.5 h-5 rounded-sm">{pkg.majorCount}</Badge>}
                      {pkg.criticalCount === 0 && pkg.majorCount === 0 && pkg.status !== 'Draft' && <CheckCircle className="w-4 h-4 text-success" />}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/reviews/${pkg.id}`}>
                      <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <Eye className="w-4 h-4 mr-2" /> Review
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
