import {
  useListSuppliers,
  useCreateSupplier,
  getListSuppliersQueryKey,
} from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Building2, Search, Plus, ChevronRight, Loader2 } from "lucide-react"
import { useState } from "react"
import { Link } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import { usePermissions } from "@/lib/access"
import { useToast } from "@/hooks/use-toast"

const STATUS_TONE: Record<string, "success" | "warning" | "destructive" | "outline"> = {
  Active: "success",
  Prospective: "outline",
  Suspended: "warning",
  Offboarded: "destructive",
}

export default function SuppliersPage() {
  const { data: suppliers = [], isLoading } = useListSuppliers()
  const [search, setSearch] = useState("")
  const { has } = usePermissions()
  const canWrite = has("suppliers:write")

  const filtered = suppliers.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-muted-foreground mt-1">
            Vendor lifecycle, compliance performance, and submissions.
          </p>
        </div>
        {canWrite && <CreateSupplierDialog />}
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
                <TableHead>Status</TableHead>
                <TableHead>Risk Level</TableHead>
                <TableHead className="text-right">Compliance Score</TableHead>
                <TableHead className="text-right">Packages</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-24">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                    No suppliers found.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((s) => (
                  <TableRow key={s.id} className="cursor-pointer hover-elevate">
                    <TableCell>
                      <Link href={`/suppliers/${s.id}`}>
                        <div className="font-medium flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-muted-foreground" />
                          {s.name}
                        </div>
                        {s.code && (
                          <div className="text-xs text-muted-foreground ml-6">{s.code}</div>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell>{s.category ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_TONE[s.status] ?? "outline"}>{s.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          s.riskLevel === "High"
                            ? "destructive"
                            : s.riskLevel === "Medium"
                              ? "warning"
                              : "success"
                        }
                      >
                        {s.riskLevel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={`font-bold ${s.complianceScore > 80 ? "text-success" : s.complianceScore > 60 ? "text-warning" : "text-destructive"}`}
                      >
                        {s.complianceScore}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono">{s.packagesReviewed}</TableCell>
                    <TableCell>
                      <Link href={`/suppliers/${s.id}`}>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function CreateSupplierDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [category, setCategory] = useState("")
  const [country, setCountry] = useState("")
  const [contactEmail, setContactEmail] = useState("")
  const [riskLevel, setRiskLevel] = useState("Low")
  const [status, setStatus] = useState("Active")
  const qc = useQueryClient()
  const { toast } = useToast()
  const create = useCreateSupplier({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() })
        toast({ title: "Supplier created" })
        setOpen(false)
        setName("")
        setCode("")
        setCategory("")
        setCountry("")
        setContactEmail("")
        setRiskLevel("Low")
        setStatus("Active")
      },
      onError: () => toast({ title: "Could not create supplier", variant: "destructive" }),
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" /> Add supplier
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add supplier</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Packaging Co." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SUP-1006" />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Food & Beverage" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Country</Label>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="USA" />
            </div>
            <div className="space-y-2">
              <Label>Contact email</Label>
              <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="qa@acme.com" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Risk level</Label>
              <Select value={riskLevel} onValueChange={setRiskLevel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Low">Low</SelectItem>
                  <SelectItem value="Medium">Medium</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Prospective">Prospective</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Suspended">Suspended</SelectItem>
                  <SelectItem value="Offboarded">Offboarded</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!name.trim() || create.isPending}
            onClick={() =>
              create.mutate({
                data: {
                  name: name.trim(),
                  code: code.trim() || undefined,
                  category: category.trim() || undefined,
                  country: country.trim() || undefined,
                  contactEmail: contactEmail.trim() || undefined,
                  riskLevel,
                  status,
                },
              })
            }
          >
            {create.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Create supplier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
