import { useListSuppliers } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Building2, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useState } from "react"
import { Link } from "wouter"

export default function SuppliersPage() {
  const { data: suppliers = [], isLoading } = useListSuppliers()
  const [search, setSearch] = useState("")

  const filtered = suppliers.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-muted-foreground mt-1">Vendor compliance performance monitoring.</p>
        </div>
      </div>

      <Card>
        <div className="p-4 border-b border-border">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search vendors..." 
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Risk Level</TableHead>
                <TableHead className="text-right">Compliance Score</TableHead>
                <TableHead className="text-right">Packages</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center h-24">Loading...</TableCell></TableRow>
              ) : filtered.map(s => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="font-medium flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-muted-foreground" />
                      {s.name}
                    </div>
                    {s.code && <div className="text-xs text-muted-foreground ml-6">{s.code}</div>}
                  </TableCell>
                  <TableCell>{s.category}</TableCell>
                  <TableCell>
                    <Badge variant={s.riskLevel === 'High' ? 'destructive' : s.riskLevel === 'Medium' ? 'warning' : 'success'}>
                      {s.riskLevel}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={`font-bold ${s.complianceScore > 80 ? 'text-success' : s.complianceScore > 60 ? 'text-warning' : 'text-destructive'}`}>
                      {s.complianceScore}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono">{s.packagesReviewed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
