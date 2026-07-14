import { useState } from "react"
import { useListPackages, useBulkAnalyze, useBulkPackageAction, useExportProof, useBulkLanguageReview } from "@workspace/api-client-react"
import { Link } from "wouter"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { downloadProof } from "@/lib/proof-utils"
import {
  Search, Loader2, BrainCircuit, Eye, CheckCircle, ShieldCheck, XCircle,
  UserPlus, FileDown, Languages,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { BulkAssignDialog } from "@/components/bulk-assign-dialog"

const APPROVAL_STYLE: Record<string, string> = {
  Approved: "bg-success/10 text-success border-success/20",
  "Approved with Comments": "bg-success/10 text-success border-success/20",
  Rejected: "bg-destructive/10 text-destructive border-destructive/20",
  "Needs Revision": "bg-warning/10 text-warning border-warning/20",
  Escalated: "bg-primary/10 text-primary border-primary/20",
  Pending: "bg-muted text-muted-foreground border-border",
}

export default function BulkQueuePage() {
  const [search, setSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [assignOpen, setAssignOpen] = useState(false)

  const { data: packages = [], isLoading, refetch } = useListPackages({ search })
  const bulkAnalyze = useBulkAnalyze()
  const bulkAction = useBulkPackageAction()
  const bulkLanguage = useBulkLanguageReview()
  const exportProof = useExportProof()

  const ids = Array.from(selectedIds)
  const busy = bulkAnalyze.isPending || bulkAction.isPending

  const toggleSelectAll = () =>
    setSelectedIds(selectedIds.size === packages.length ? new Set() : new Set(packages.map((p) => p.id)))
  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelectedIds(next)
  }
  const done = () => { setSelectedIds(new Set()); refetch() }

  const runAction = (action: string, assignee?: string) => {
    if (ids.length === 0) return
    bulkAction.mutate({ data: { ids, action, assignee } }, { onSuccess: done })
  }
  const runAnalyze = () => {
    if (ids.length === 0) return
    bulkAnalyze.mutate({ data: { ids } }, { onSuccess: done })
  }
  const exportSelected = () => {
    ids.forEach((id) =>
      exportProof.mutate({ id }, { onSuccess: (r) => { if (r?.url) downloadProof(r.url, r.filename) } }))
  }
  const runLanguage = () => {
    if (ids.length === 0) return
    bulkLanguage.mutate({ data: { ids } }, { onSuccess: done })
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Review Queue</h1>
          <p className="text-muted-foreground mt-1">Batch scan, approve, assign, and export packaging proofs.</p>
        </div>
      </div>

      <Card>
        <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search SKU, name, vendor..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap animate-in fade-in slide-in-from-right-2">
              <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
              <Button size="sm" className="gap-1.5" disabled={busy} onClick={runAnalyze}>
                {bulkAnalyze.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BrainCircuit className="w-4 h-4" />} Re-scan
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" disabled={busy || bulkLanguage.isPending} onClick={runLanguage}>
                {bulkLanguage.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />} Language
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 text-success border-success/30 hover:bg-success/10" disabled={busy} onClick={() => runAction("approve")}>
                <ShieldCheck className="w-4 h-4" /> Approve
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10" disabled={busy} onClick={() => runAction("reject")}>
                <XCircle className="w-4 h-4" /> Reject
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => setAssignOpen(true)}>
                <UserPlus className="w-4 h-4" /> Assign
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" disabled={exportProof.isPending} onClick={exportSelected}>
                {exportProof.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} Export
              </Button>
            </div>
          )}
        </div>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">
                  <Checkbox checked={packages.length > 0 && selectedIds.size === packages.length} onCheckedChange={toggleSelectAll} />
                </TableHead>
                <TableHead>SKU / Name</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Approval</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead className="text-right">Language</TableHead>
                <TableHead className="text-right">Risk</TableHead>
                <TableHead className="text-right">Findings</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="h-32 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />Loading queue...</TableCell></TableRow>
              ) : packages.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="h-32 text-center text-muted-foreground">No packages found.</TableCell></TableRow>
              ) : packages.map((pkg) => (
                <TableRow key={pkg.id} className="group" data-state={selectedIds.has(pkg.id) ? "selected" : undefined}>
                  <TableCell><Checkbox checked={selectedIds.has(pkg.id)} onCheckedChange={() => toggleSelect(pkg.id)} /></TableCell>
                  <TableCell>
                    <div className="font-medium text-foreground">{pkg.sku}</div>
                    <div className="text-xs text-muted-foreground max-w-[220px] truncate" title={pkg.name}>{pkg.name}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{pkg.vendor}</div>
                    <div className="text-xs text-muted-foreground">{pkg.brand}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-[10px]", APPROVAL_STYLE[pkg.approvalStatus] ?? APPROVAL_STYLE.Pending)}>{pkg.approvalStatus}</Badge>
                  </TableCell>
                  <TableCell>
                    {pkg.grade ? <span className={cn("font-bold text-lg", pkg.grade === "A" || pkg.grade === "B" ? "text-success" : pkg.grade === "F" ? "text-destructive" : "text-warning")}>{pkg.grade}</span> : "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {pkg.languageScore != null ? <span className={pkg.languageScore >= 90 ? "text-success" : pkg.languageScore >= 80 ? "text-warning" : "text-destructive font-bold"}>{pkg.languageScore}</span> : "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {pkg.riskScore ? <span className={pkg.riskScore > 70 ? "text-destructive font-bold" : pkg.riskScore > 30 ? "text-warning" : "text-success"}>{pkg.riskScore}</span> : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {pkg.criticalCount > 0 && <Badge variant="destructive" className="px-1.5 h-5 rounded-sm">{pkg.criticalCount}</Badge>}
                      {pkg.majorCount > 0 && <Badge variant="warning" className="px-1.5 h-5 rounded-sm">{pkg.majorCount}</Badge>}
                      {pkg.criticalCount === 0 && pkg.majorCount === 0 && pkg.status !== "Draft" && <CheckCircle className="w-4 h-4 text-success" />}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/reviews/${pkg.id}`}>
                      <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity"><Eye className="w-4 h-4 mr-2" /> Review</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <BulkAssignDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        packageIds={ids}
        onAssigned={done}
      />
    </div>
  )
}
