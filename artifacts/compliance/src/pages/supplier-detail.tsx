import { useState } from "react"
import { Link, useRoute } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import {
  useGetSupplier,
  useUpdateSupplier,
  useAddSupplierContact,
  useRemoveSupplierContact,
  useRecordSupplierScorecard,
  useReviewSupplierSubmission,
  getGetSupplierQueryKey,
  getListSuppliersQueryKey,
} from "@workspace/api-client-react"
import type {
  SupplierDetail as SupplierDetailModel,
  SupplierSubmission,
  SupplierContact,
  SupplierScorecard,
  SupplierStatusEvent,
  Package as PackageModel,
} from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  ArrowLeft,
  Building2,
  Loader2,
  Plus,
  Trash2,
  Mail,
  Phone,
  Star,
  Globe,
  Link2,
} from "lucide-react"
import { usePermissions } from "@/lib/access"
import { useToast } from "@/hooks/use-toast"

const STATUS_TONE: Record<string, "success" | "warning" | "destructive" | "outline"> = {
  Active: "success",
  Prospective: "outline",
  Suspended: "warning",
  Offboarded: "destructive",
}

const SUB_TONE: Record<string, "success" | "warning" | "destructive" | "outline" | "secondary"> = {
  Submitted: "secondary",
  UnderReview: "warning",
  ChangesRequested: "warning",
  Approved: "success",
  Rejected: "destructive",
}

export default function SupplierDetail() {
  const [, params] = useRoute("/suppliers/:id")
  const id = Number(params?.id)
  const { data: supplier, isLoading } = useGetSupplier(id, {
    query: { enabled: Number.isFinite(id), queryKey: getGetSupplierQueryKey(id) },
  })
  const { has } = usePermissions()
  const canWrite = has("suppliers:write")
  const canReview = has("submissions:review")

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }
  if (!supplier) {
    return (
      <div className="text-center py-24">
        <p className="text-lg font-medium">Supplier not found</p>
        <Link href="/suppliers">
          <Button variant="outline" className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to suppliers
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <Link href="/suppliers">
          <Button variant="ghost" size="sm" className="mb-2 -ml-2">
            <ArrowLeft className="w-4 h-4 mr-2" /> Suppliers
          </Button>
        </Link>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Building2 className="w-7 h-7 text-primary" /> {supplier.name}
            </h1>
            <div className="flex items-center gap-2 mt-2">
              {supplier.code && (
                <span className="text-xs font-mono text-muted-foreground">{supplier.code}</span>
              )}
              <Badge variant={STATUS_TONE[supplier.status] ?? "outline"}>{supplier.status}</Badge>
              <Badge
                variant={
                  supplier.riskLevel === "High"
                    ? "destructive"
                    : supplier.riskLevel === "Medium"
                      ? "warning"
                      : "success"
                }
              >
                {supplier.riskLevel} risk
              </Badge>
            </div>
          </div>
          {canWrite && <StatusDialog id={id} current={supplier.status} />}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Compliance score" value={`${supplier.complianceScore}%`} />
        <StatCard label="Packages reviewed" value={String(supplier.packagesReviewed)} />
        <StatCard label="Submissions" value={String(supplier.submissions.length)} />
        <StatCard label="Contacts" value={String(supplier.contacts.length)} />
      </div>

      <Tabs defaultValue="submissions">
        <TabsList>
          <TabsTrigger value="submissions">Submissions</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="scorecards">Scorecards</TabsTrigger>
          <TabsTrigger value="packages">Packages</TabsTrigger>
          <TabsTrigger value="history">Lifecycle</TabsTrigger>
          <TabsTrigger value="linkage">Master data</TabsTrigger>
        </TabsList>

        <TabsContent value="submissions" className="mt-4">
          <SubmissionsPanel supplierId={id} submissions={supplier.submissions} canReview={canReview} />
        </TabsContent>
        <TabsContent value="contacts" className="mt-4">
          <ContactsPanel supplierId={id} contacts={supplier.contacts} canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="scorecards" className="mt-4">
          <ScorecardsPanel supplierId={id} scorecards={supplier.scorecards} canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="packages" className="mt-4">
          <PackagesPanel packages={supplier.packages} />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <HistoryPanel history={supplier.statusHistory} />
        </TabsContent>
        <TabsContent value="linkage" className="mt-4">
          <LinkagePanel supplier={supplier} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </CardContent>
    </Card>
  )
}

function useRefresh(id: number) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: getGetSupplierQueryKey(id) })
    qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() })
  }
}

function StatusDialog({ id, current }: { id: number; current: string }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState(current)
  const [reason, setReason] = useState("")
  const refresh = useRefresh(id)
  const { toast } = useToast()
  const update = useUpdateSupplier({
    mutation: {
      onSuccess: () => {
        refresh()
        toast({ title: "Supplier updated" })
        setOpen(false)
        setReason("")
      },
      onError: () => toast({ title: "Update failed", variant: "destructive" }),
    },
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Change status</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change supplier status</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
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
          <div className="space-y-2">
            <Label>Reason (optional)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is the status changing?" />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={status === current || update.isPending}
            onClick={() => update.mutate({ id, data: { status, statusReason: reason.trim() || undefined } })}
          >
            {update.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SubmissionsPanel({
  supplierId,
  submissions,
  canReview,
}: {
  supplierId: number
  submissions: SupplierSubmission[]
  canReview: boolean
}) {
  if (submissions.length === 0) {
    return (
      <div className="text-center py-16 border border-dashed rounded-xl bg-card text-muted-foreground">
        No submissions yet.
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {submissions.map((s) => (
        <Card key={s.id}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium">{s.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {s.category ?? "Uncategorized"} · by {s.submittedByName} ·{" "}
                  {new Date(s.createdAt).toLocaleDateString()}
                </div>
                {s.notes && <p className="text-sm mt-2">{s.notes}</p>}
                {s.reviewNotes && (
                  <div className="mt-2 rounded-md bg-accent/50 p-2 text-sm">
                    <span className="font-medium">Reviewer feedback: </span>
                    {s.reviewNotes}
                  </div>
                )}
              </div>
              <Badge variant={SUB_TONE[s.status] ?? "outline"}>{s.status}</Badge>
            </div>
            {canReview && s.status !== "Approved" && s.status !== "Rejected" && (
              <ReviewControls supplierId={supplierId} submissionId={s.id} />
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function ReviewControls({ supplierId, submissionId }: { supplierId: number; submissionId: number }) {
  const [notes, setNotes] = useState("")
  const refresh = useRefresh(supplierId)
  const { toast } = useToast()
  const review = useReviewSupplierSubmission({
    mutation: {
      onSuccess: () => {
        refresh()
        toast({ title: "Decision recorded" })
        setNotes("")
      },
      onError: () => toast({ title: "Could not record decision", variant: "destructive" }),
    },
  })
  const decide = (status: string) =>
    review.mutate({ id: submissionId, data: { status, reviewNotes: notes.trim() || undefined } })
  return (
    <div className="mt-3 pt-3 border-t space-y-2">
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Feedback for the supplier (optional)"
        className="min-h-16"
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => decide("UnderReview")}>
          Mark under review
        </Button>
        <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => decide("ChangesRequested")}>
          Request changes
        </Button>
        <Button size="sm" disabled={review.isPending} onClick={() => decide("Approved")}>
          Approve
        </Button>
        <Button size="sm" variant="destructive" disabled={review.isPending} onClick={() => decide("Rejected")}>
          Reject
        </Button>
      </div>
    </div>
  )
}

function ContactsPanel({
  supplierId,
  contacts,
  canWrite,
}: {
  supplierId: number
  contacts: SupplierContact[]
  canWrite: boolean
}) {
  return (
    <div className="space-y-4">
      {canWrite && <AddContactForm supplierId={supplierId} />}
      {contacts.length === 0 ? (
        <div className="text-center py-12 border border-dashed rounded-xl bg-card text-muted-foreground">
          No contacts recorded.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {contacts.map((c) => (
            <Card key={c.id}>
              <CardContent className="p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-2">
                    {c.name}
                    {c.isPrimary && <Star className="w-3.5 h-3.5 text-warning fill-warning" />}
                  </div>
                  {c.title && <div className="text-xs text-muted-foreground">{c.title}</div>}
                  <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {c.email && (
                      <div className="flex items-center gap-2 truncate">
                        <Mail className="w-3.5 h-3.5" /> {c.email}
                      </div>
                    )}
                    {c.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5" /> {c.phone}
                      </div>
                    )}
                  </div>
                </div>
                {canWrite && <RemoveContactButton supplierId={supplierId} contactId={c.id} />}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function AddContactForm({ supplierId }: { supplierId: number }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [title, setTitle] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [isPrimary, setIsPrimary] = useState(false)
  const refresh = useRefresh(supplierId)
  const { toast } = useToast()
  const add = useAddSupplierContact({
    mutation: {
      onSuccess: () => {
        refresh()
        toast({ title: "Contact added" })
        setOpen(false)
        setName("")
        setTitle("")
        setEmail("")
        setPhone("")
        setIsPrimary(false)
      },
      onError: () => toast({ title: "Could not add contact", variant: "destructive" }),
    },
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="w-4 h-4 mr-2" /> Add contact
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add contact</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="QA Lead" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            Primary contact
          </label>
        </div>
        <DialogFooter>
          <Button
            disabled={!name.trim() || add.isPending}
            onClick={() =>
              add.mutate({
                id: supplierId,
                data: {
                  name: name.trim(),
                  title: title.trim() || undefined,
                  email: email.trim() || undefined,
                  phone: phone.trim() || undefined,
                  isPrimary,
                },
              })
            }
          >
            {add.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Add contact
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RemoveContactButton({ supplierId, contactId }: { supplierId: number; contactId: number }) {
  const refresh = useRefresh(supplierId)
  const { toast } = useToast()
  const remove = useRemoveSupplierContact({
    mutation: {
      onSuccess: () => {
        refresh()
        toast({ title: "Contact removed" })
      },
      onError: () => toast({ title: "Could not remove contact", variant: "destructive" }),
    },
  })
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={remove.isPending}
      onClick={() => remove.mutate({ id: supplierId, contactId })}
    >
      <Trash2 className="w-4 h-4 text-destructive" />
    </Button>
  )
}

function ScorecardsPanel({
  supplierId,
  scorecards,
  canWrite,
}: {
  supplierId: number
  scorecards: SupplierScorecard[]
  canWrite: boolean
}) {
  return (
    <div className="space-y-4">
      {canWrite && <RecordScorecardForm supplierId={supplierId} />}
      {scorecards.length === 0 ? (
        <div className="text-center py-12 border border-dashed rounded-xl bg-card text-muted-foreground">
          No scorecards recorded.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Overall</TableHead>
              <TableHead className="text-right">Quality</TableHead>
              <TableHead className="text-right">Compliance</TableHead>
              <TableHead className="text-right">Timeliness</TableHead>
              <TableHead className="text-right">Approved / Rejected</TableHead>
              <TableHead>Recorded by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scorecards.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.period}</TableCell>
                <TableCell className="text-right font-bold">{s.overallScore}%</TableCell>
                <TableCell className="text-right">{s.qualityScore ?? "—"}</TableCell>
                <TableCell className="text-right">{s.complianceScore ?? "—"}</TableCell>
                <TableCell className="text-right">{s.timelinessScore ?? "—"}</TableCell>
                <TableCell className="text-right">
                  {s.approvedCount} / {s.rejectedCount}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{s.recordedByName}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function RecordScorecardForm({ supplierId }: { supplierId: number }) {
  const [open, setOpen] = useState(false)
  const [period, setPeriod] = useState("")
  const [overallScore, setOverallScore] = useState("")
  const [qualityScore, setQualityScore] = useState("")
  const [complianceScore, setComplianceScore] = useState("")
  const [timelinessScore, setTimelinessScore] = useState("")
  const [notes, setNotes] = useState("")
  const refresh = useRefresh(supplierId)
  const { toast } = useToast()
  const record = useRecordSupplierScorecard({
    mutation: {
      onSuccess: () => {
        refresh()
        toast({ title: "Scorecard recorded" })
        setOpen(false)
        setPeriod("")
        setOverallScore("")
        setQualityScore("")
        setComplianceScore("")
        setTimelinessScore("")
        setNotes("")
      },
      onError: () => toast({ title: "Could not record scorecard", variant: "destructive" }),
    },
  })
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v))
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="w-4 h-4 mr-2" /> Record scorecard
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record scorecard</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Period</Label>
              <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-Q2" />
            </div>
            <div className="space-y-2">
              <Label>Overall score</Label>
              <Input type="number" value={overallScore} onChange={(e) => setOverallScore(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Quality</Label>
              <Input type="number" value={qualityScore} onChange={(e) => setQualityScore(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Compliance</Label>
              <Input type="number" value={complianceScore} onChange={(e) => setComplianceScore(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Timeliness</Label>
              <Input type="number" value={timelinessScore} onChange={(e) => setTimelinessScore(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!period.trim() || overallScore.trim() === "" || record.isPending}
            onClick={() =>
              record.mutate({
                id: supplierId,
                data: {
                  period: period.trim(),
                  overallScore: Number(overallScore),
                  qualityScore: num(qualityScore),
                  complianceScore: num(complianceScore),
                  timelinessScore: num(timelinessScore),
                  notes: notes.trim() || undefined,
                },
              })
            }
          >
            {record.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PackagesPanel({ packages }: { packages: PackageModel[] }) {
  if (packages.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed rounded-xl bg-card text-muted-foreground">
        No packages linked to this supplier.
      </div>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>SKU</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {packages.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="font-mono text-xs">{p.sku}</TableCell>
            <TableCell>
              <Link href={`/packages/${p.id}`} className="hover:underline">
                {p.name}
              </Link>
            </TableCell>
            <TableCell>{p.category ?? "—"}</TableCell>
            <TableCell>
              <Badge variant="outline">{p.complianceStatus ?? p.status}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function HistoryPanel({ history }: { history: SupplierStatusEvent[] }) {
  if (history.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed rounded-xl bg-card text-muted-foreground">
        No status changes recorded.
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {history.map((h) => (
        <div key={h.id} className="flex items-start gap-3 text-sm">
          <div className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" />
          <div>
            <div>
              <span className="font-medium">{h.fromStatus ?? "—"}</span> →{" "}
              <span className="font-medium">{h.toStatus}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {h.actorName} · {new Date(h.createdAt).toLocaleString()}
            </div>
            {h.reason && <p className="text-muted-foreground mt-1">{h.reason}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

function LinkagePanel({ supplier }: { supplier: SupplierDetailModel }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="w-4 h-4" /> External master data
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          These fields link this supplier to an external system of record (e.g. a corporate CIA
          master-data source). No live sync is configured yet.
        </p>
        <Separator />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Source system</div>
            <div>{supplier.externalSource ?? "Not linked"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">External ID</div>
            <div className="font-mono">{supplier.externalId ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Last synced</div>
            <div>
              {supplier.externalSyncedAt
                ? new Date(supplier.externalSyncedAt).toLocaleString()
                : "Never"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Country</div>
            <div className="flex items-center gap-2">
              {supplier.country && <Globe className="w-3.5 h-3.5" />}
              {supplier.country ?? "—"}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
