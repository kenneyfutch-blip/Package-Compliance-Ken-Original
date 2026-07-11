import { useState, useMemo } from "react"
import {
  useListSupplierSubmissions,
  useCreateSupplierSubmission,
  getListSupplierSubmissionsQueryKey,
} from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Building2, Loader2, Plus, PackageCheck } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { usePermissions } from "@/lib/access"
import { useToast } from "@/hooks/use-toast"

const SUB_TONE: Record<string, "success" | "warning" | "destructive" | "outline" | "secondary"> = {
  Submitted: "secondary",
  UnderReview: "warning",
  ChangesRequested: "warning",
  Approved: "success",
  Rejected: "destructive",
}

export default function SupplierPortal() {
  const { me, has } = usePermissions()
  const { data: submissions = [], isLoading } = useListSupplierSubmissions()
  const canSubmit = has("submissions:write")

  const stats = useMemo(() => {
    const total = submissions.length
    const approved = submissions.filter((s) => s.status === "Approved").length
    const pending = submissions.filter(
      (s) => s.status === "Submitted" || s.status === "UnderReview",
    ).length
    const changes = submissions.filter((s) => s.status === "ChangesRequested").length
    return { total, approved, pending, changes }
  }, [submissions])

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="w-7 h-7 text-primary" /> Supplier Portal
          </h1>
          <p className="text-muted-foreground mt-1">
            {me?.supplierName
              ? `Submit packaging and track review outcomes for ${me.supplierName}.`
              : "Submit packaging for compliance review and track its status."}
          </p>
        </div>
        {canSubmit && <SubmitDialog />}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Total submissions" value={stats.total} />
        <Stat label="Pending review" value={stats.pending} />
        <Stat label="Changes requested" value={stats.changes} />
        <Stat label="Approved" value={stats.approved} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">My submissions</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center h-40">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : submissions.length === 0 ? (
            <div className="text-center py-16 border border-dashed rounded-xl text-muted-foreground">
              <PackageCheck className="w-8 h-8 mx-auto mb-2 opacity-60" />
              No submissions yet.
              {canSubmit && " Use “New submission” to send packaging for review."}
            </div>
          ) : (
            <div className="space-y-3">
              {submissions.map((s) => (
                <div key={s.id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium">{s.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {s.supplierName ? `${s.supplierName} · ` : ""}
                        {s.category ?? "Uncategorized"} ·{" "}
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
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </CardContent>
    </Card>
  )
}

function SubmitDialog() {
  const { me } = usePermissions()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [category, setCategory] = useState("")
  const [notes, setNotes] = useState("")
  const [supplierId, setSupplierId] = useState("")
  const qc = useQueryClient()
  const { toast } = useToast()
  // Supplier users are bound server-side to their own supplier; internal users
  // acting through the portal must name the supplier they submit for.
  const isSupplierUser = me?.roleKey === "supplier_user"

  const create = useCreateSupplierSubmission({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListSupplierSubmissionsQueryKey() })
        toast({ title: "Submission sent for review" })
        setOpen(false)
        setTitle("")
        setCategory("")
        setNotes("")
        setSupplierId("")
      },
      onError: () => toast({ title: "Could not submit", variant: "destructive" }),
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" /> New submission
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit packaging for review</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!isSupplierUser && (
            <div className="space-y-2">
              <Label>Supplier ID</Label>
              <Input
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                placeholder="Numeric supplier id"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Cereal box front panel v3"
            />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Food & Beverage"
            />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Context for the reviewer"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={
              !title.trim() ||
              create.isPending ||
              (!isSupplierUser && supplierId.trim() === "")
            }
            onClick={() =>
              create.mutate({
                data: {
                  title: title.trim(),
                  category: category.trim() || undefined,
                  notes: notes.trim() || undefined,
                  ...(isSupplierUser ? {} : { supplierId: Number(supplierId) }),
                },
              })
            }
          >
            {create.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
