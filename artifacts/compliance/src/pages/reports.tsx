import { useListReports } from "@workspace/api-client-react"
import { useRegisterPageContext } from "@/lib/workspace-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FileText, Download, FileJson, FileSpreadsheet } from "lucide-react"
import { servingUrl } from "@/lib/proof-utils"

export default function ReportsPage() {
  const { data: reports = [], isLoading } = useListReports()

  useRegisterPageContext({
    path: "/reports",
    title: "Compliance Reports",
    summary: `The reports library currently holds ${reports.length} generated compliance report(s).`,
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
        <Button className="gap-2"><FileText className="w-4 h-4"/> New Report</Button>
      </div>

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
                <TableRow><TableCell colSpan={5} className="text-center h-24 text-muted-foreground">No reports generated yet.</TableCell></TableRow>
              ) : reports.map(r => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium text-foreground">{r.title}</div>
                    {r.summary && <div className="text-xs text-muted-foreground line-clamp-1">{r.summary}</div>}
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
