import * as React from "react"
import {
  useListReports,
  useListPackages,
  useGenerateReport,
  useArchiveReport,
  useRestoreReport,
  useDeleteReport,
  getListReportsQueryKey,
} from "@workspace/api-client-react"
import type { ListReportsParams } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { useRegisterPageContext } from "@/lib/workspace-context"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FileText, Download, FileJson, FileSpreadsheet, MoreHorizontal, Archive, Trash2, ArchiveRestore } from "lucide-react"
import { servingUrl } from "@/lib/proof-utils"
import { useToast } from "@/hooks/use-toast"

// Small artwork thumbnail for the package a report was generated from, so the
// list is scannable at a glance. Uses the same server-rendered (and cached)
// thumbnail endpoint as the package cards; falls back to a document icon when
// the report has no package or no renderable artwork.
function ReportThumb({ packageId, title }: { packageId?: number | null; title: string }) {
  const [broken, setBroken] = React.useState(false)
  if (!packageId || broken) {
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
        <FileText className="w-5 h-5" />
      </div>
    )
  }
  return (
    <img
      src={`/api/packages/${packageId}/thumbnail`}
      alt={`${title} artwork`}
      loading="lazy"
      onError={() => setBroken(true)}
      className="h-12 w-12 shrink-0 rounded-md border border-border bg-white object-contain"
    />
  )
}

type View = NonNullable<ListReportsParams["view"]>

export default function ReportsPage() {
  const [view, setView] = React.useState<View>("active")
  const params: ListReportsParams = { view }
  const { data: reports = [], isLoading } = useListReports(params)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  // Refresh every bucket: a mutation always moves a row between buckets.
  const refreshAll = () =>
    queryClient.invalidateQueries({ queryKey: getListReportsQueryKey().slice(0, 1) })

  const archive = useArchiveReport({ mutation: { onSuccess: () => { refreshAll(); toast({ title: "Report archived" }) } } })
  const restore = useRestoreReport({ mutation: { onSuccess: () => { refreshAll(); toast({ title: "Report restored" }) } } })
  const trash = useDeleteReport({ mutation: { onSuccess: () => { refreshAll(); toast({ title: "Report moved to trash", description: "You can restore it from the Trash tab." }) } } })
  const mutationError = (err: unknown) =>
    toast({ title: "Action failed", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" })

  // --- New Report dialog -----------------------------------------------
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [pkgId, setPkgId] = React.useState<string>("")
  const [title, setTitle] = React.useState("")
  const { data: packages = [] } = useListPackages()
  const generate = useGenerateReport({
    mutation: {
      onSuccess: (r) => {
        refreshAll()
        setDialogOpen(false)
        toast({ title: "Report generated", description: `"${r.title}" was added to the list.` })
      },
      onError: mutationError,
    },
  })
  const selectedPkg = packages.find((p) => String(p.id) === pkgId)
  React.useEffect(() => {
    if (selectedPkg) setTitle(`Compliance Report - ${selectedPkg.name}`)
  }, [selectedPkg?.id])

  useRegisterPageContext({
    path: "/reports",
    title: "Compliance Reports",
    summary: `The reports library currently holds ${reports.length} ${view} compliance report(s).`,
  })

  const getFormatIcon = (format: string) => {
    switch(format.toLowerCase()) {
      case 'json': return <FileJson className="w-4 h-4" />
      case 'excel':
      case 'csv': return <FileSpreadsheet className="w-4 h-4" />
      default: return <FileText className="w-4 h-4" />
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground mt-1">Generated compliance documentation and exports.</p>
        </div>
        <Button className="gap-2" onClick={() => { setPkgId(""); setTitle(""); setDialogOpen(true) }}>
          <FileText className="w-4 h-4"/> New Report
        </Button>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="archived">Archived</TabsTrigger>
          <TabsTrigger value="trash">Trash</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Report Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Generated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center h-24">Loading...</TableCell></TableRow>
              ) : reports.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
                  {view === "active" ? "No reports generated yet." : view === "archived" ? "No archived reports." : "Trash is empty."}
                </TableCell></TableRow>
              ) : reports.map(r => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <ReportThumb packageId={r.packageId} title={r.title} />
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{r.title}</div>
                        {r.summary && <div className="text-xs text-muted-foreground line-clamp-1">{r.summary}</div>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{r.type}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm uppercase text-muted-foreground font-mono">
                      {getFormatIcon(r.format)} {r.format}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {(() => {
                        const url = servingUrl(r.objectPath)
                        return (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-2"
                            disabled={!url}
                            title={url ? "Download report" : "No file available for this report"}
                            onClick={() => { if (url) window.open(url, "_blank", "noopener") }}
                          >
                            <Download className="w-4 h-4" /> Download
                          </Button>
                        )
                      })()}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Report actions">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {view === "active" && (
                            <DropdownMenuItem onClick={() => archive.mutate({ id: r.id }, { onError: mutationError })}>
                              <Archive className="w-4 h-4 mr-2" /> Archive
                            </DropdownMenuItem>
                          )}
                          {view !== "active" && (
                            <DropdownMenuItem onClick={() => restore.mutate({ id: r.id }, { onError: mutationError })}>
                              <ArchiveRestore className="w-4 h-4 mr-2" /> Restore
                            </DropdownMenuItem>
                          )}
                          {view !== "trash" && (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => trash.mutate({ id: r.id }, { onError: mutationError })}
                            >
                              <Trash2 className="w-4 h-4 mr-2" /> Move to trash
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Report</DialogTitle>
            <DialogDescription>Generate a compliance report for one of your packages.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Package</Label>
              <Select value={pkgId} onValueChange={setPkgId}>
                <SelectTrigger><SelectValue placeholder="Select a package" /></SelectTrigger>
                <SelectContent>
                  {packages.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-title">Report title</Label>
              <Input id="report-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Compliance Report - ..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!pkgId || !title.trim() || generate.isPending}
              onClick={() => generate.mutate({ id: Number(pkgId), data: { title: title.trim() } })}
            >
              {generate.isPending ? "Generating..." : "Generate Report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
