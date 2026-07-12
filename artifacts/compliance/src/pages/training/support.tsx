import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { formatDistanceToNow } from "date-fns"
import {
  LifeBuoy,
  Send,
  Inbox,
  MessageSquare,
  Loader2,
  CheckCircle2,
} from "lucide-react"
import {
  useCreateSupportRequest,
  useGetMySupportRequests,
  useGetAllSupportRequests,
  useUpdateSupportRequest,
  getGetMySupportRequestsQueryKey,
  getGetAllSupportRequestsQueryKey,
  type SupportRequest,
} from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { TrainingHeader } from "@/components/training/kit"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/lib/access"
import { cn } from "@/lib/utils"

const CATEGORIES = [
  { value: "general", label: "General question" },
  { value: "bug", label: "Something's broken" },
  { value: "feature", label: "Feature request" },
  { value: "account", label: "Account or access" },
  { value: "billing", label: "Billing" },
  { value: "training", label: "Training & help" },
  { value: "other", label: "Other" },
]
const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
]
const STATUS_META: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  in_progress: { label: "In progress", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  resolved: { label: "Resolved", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  closed: { label: "Closed", className: "bg-muted text-muted-foreground" },
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, className: "bg-muted text-muted-foreground" }
  return <Badge variant="secondary" className={cn("border-0", meta.className)}>{meta.label}</Badge>
}

function timeAgo(iso: string) {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return ""
  }
}

export default function ContactSupport() {
  const { has } = usePermissions()
  const isAdmin = has("users:read")
  const { toast } = useToast()
  const qc = useQueryClient()

  const [subject, setSubject] = useState("")
  const [category, setCategory] = useState("general")
  const [priority, setPriority] = useState("normal")
  const [message, setMessage] = useState("")

  const createMut = useCreateSupportRequest()
  const { data: mine } = useGetMySupportRequests()
  const myRequests = mine?.items ?? []

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!subject.trim() || !message.trim()) {
      toast({ title: "Add a subject and a message", variant: "destructive" })
      return
    }
    createMut.mutate(
      {
        data: {
          subject: subject.trim(),
          message: message.trim(),
          category,
          priority,
          pageContext: "Training & Help → Contact Support",
        },
      },
      {
        onSuccess: async () => {
          toast({
            title: "Request submitted",
            description: "An administrator has been notified and will follow up.",
          })
          setSubject("")
          setMessage("")
          setCategory("general")
          setPriority("normal")
          await qc.invalidateQueries({ queryKey: getGetMySupportRequestsQueryKey() })
        },
        onError: () =>
          toast({ title: "Couldn't submit your request", description: "Please try again.", variant: "destructive" }),
      },
    )
  }

  return (
    <div className="space-y-8">
      <TrainingHeader
        icon={LifeBuoy}
        eyebrow="Training & Help"
        title="Contact Support"
        description="Can't find an answer in the guides? Send us a request and an administrator will get back to you — right here in the platform."
      />

      <Tabs defaultValue="new" className="w-full">
        <TabsList>
          <TabsTrigger value="new" className="gap-2">
            <Send className="h-4 w-4" />
            New request
          </TabsTrigger>
          <TabsTrigger value="mine" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            My requests
            {myRequests.length > 0 && (
              <Badge variant="secondary" className="ml-1">{myRequests.length}</Badge>
            )}
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="inbox" className="gap-2">
              <Inbox className="h-4 w-4" />
              Inbox
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="new" className="mt-6">
          <Card className="max-w-2xl">
            <CardContent className="p-6">
              <form onSubmit={submit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="subject">Subject</Label>
                  <Input
                    id="subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Briefly, what do you need help with?"
                    maxLength={200}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <Select value={priority} onValueChange={setPriority}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PRIORITIES.map((p) => (
                          <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="message">Message</Label>
                  <Textarea
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Give us as much detail as you can — what you expected, what happened, and where."
                    rows={6}
                  />
                </div>
                <Button type="submit" disabled={createMut.isPending} className="gap-2">
                  {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Submit request
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mine" className="mt-6">
          {myRequests.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
                <MessageSquare className="h-8 w-8" />
                <p>You haven't filed any support requests yet.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {myRequests.map((r) => (
                <RequestCard key={r.id} request={r} />
              ))}
            </div>
          )}
        </TabsContent>

        {isAdmin && (
          <TabsContent value="inbox" className="mt-6">
            <AdminInbox />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

function RequestCard({ request: r }: { request: SupportRequest }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-foreground">{r.subject}</h3>
            <p className="text-xs text-muted-foreground">
              {r.category} · {r.priority} priority · {timeAgo(r.createdAt)}
            </p>
          </div>
          <StatusBadge status={r.status} />
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{r.message}</p>
        {r.adminResponse && (
          <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-primary">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Response from support
            </p>
            <p className="whitespace-pre-wrap text-sm text-foreground">{r.adminResponse}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function AdminInbox() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [statusFilter, setStatusFilter] = useState<string>("open")
  const params = statusFilter === "all" ? undefined : { status: statusFilter }
  const { data, isLoading } = useGetAllSupportRequests(params)
  const requests = data?.items ?? []

  const [active, setActive] = useState<SupportRequest | null>(null)
  const [response, setResponse] = useState("")
  const [newStatus, setNewStatus] = useState("in_progress")
  const updateMut = useUpdateSupportRequest()

  const openDialog = (r: SupportRequest) => {
    setActive(r)
    setResponse(r.adminResponse ?? "")
    setNewStatus(r.status === "open" ? "in_progress" : r.status)
  }

  const save = () => {
    if (!active) return
    updateMut.mutate(
      { id: active.id, data: { status: newStatus, adminResponse: response.trim() || undefined } },
      {
        onSuccess: async () => {
          toast({ title: "Request updated", description: "The requester has been notified." })
          setActive(null)
          await Promise.all([
            qc.invalidateQueries({ queryKey: getGetAllSupportRequestsQueryKey(params) }),
            qc.invalidateQueries({ queryKey: getGetAllSupportRequestsQueryKey() }),
          ])
        },
        onError: () =>
          toast({ title: "Couldn't update the request", variant: "destructive" }),
      },
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label className="text-sm text-muted-foreground">Filter</Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 p-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading requests…
        </div>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
            <Inbox className="h-8 w-8" />
            <p>No requests{statusFilter !== "all" ? ` with status “${statusFilter}”` : ""}.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => (
            <Card key={r.id} className="hover-elevate transition-all">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-foreground">{r.subject}</h3>
                    <p className="text-xs text-muted-foreground">
                      {r.requesterName || r.requesterEmail || "Unknown user"} · {r.category} ·{" "}
                      {r.priority} priority · {timeAgo(r.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{r.message}</p>
                {r.adminResponse && (
                  <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-foreground">
                    <span className="font-medium text-primary">Response: </span>
                    {r.adminResponse}
                  </div>
                )}
                <div className="mt-4">
                  <Button variant="outline" size="sm" onClick={() => openDialog(r)}>
                    Respond & update
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Respond to request</DialogTitle>
            <DialogDescription>{active?.subject}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Response to the requester</Label>
              <Textarea
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                rows={5}
                placeholder="Write a reply the requester will see and be notified about."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActive(null)}>Cancel</Button>
            <Button onClick={save} disabled={updateMut.isPending} className="gap-2">
              {updateMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
