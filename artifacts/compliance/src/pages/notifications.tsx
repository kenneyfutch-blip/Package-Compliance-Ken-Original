import { useMemo, useState } from "react"
import {
  useListNotifications,
  useMarkNotificationRead,
  useMarkNotificationUnread,
  useMarkAllNotificationsRead,
  useArchiveNotification,
  useUnarchiveNotification,
  useDeleteNotification,
  useGetNotificationPreferences,
  useUpdateNotificationPreferences,
  getListNotificationsQueryKey,
  getGetNotificationPreferencesQueryKey,
} from "@workspace/api-client-react"
import type { Notification as ApiNotification } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Bell,
  Check,
  CheckCheck,
  Archive,
  ArchiveRestore,
  Trash2,
  MoreVertical,
  Settings2,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Undo2,
  BellOff,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"

type Notif = ApiNotification

type Filter = "all" | "unread" | "archived"

// The notification `type` values the backend emits, surfaced as user-togglable
// alert categories. Silencing a type hides it from the feed and the unread badge.
const TYPE_META: {
  type: string
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  tone: string
}[] = [
  {
    type: "critical",
    label: "Critical alerts",
    description: "High-risk packages, escalations, and urgent compliance issues.",
    icon: ShieldAlert,
    tone: "text-destructive",
  },
  {
    type: "warning",
    label: "Warnings",
    description: "Items that may need your attention soon.",
    icon: AlertTriangle,
    tone: "text-amber-500",
  },
  {
    type: "success",
    label: "Completions",
    description: "Finished analyses and successful actions.",
    icon: CheckCircle2,
    tone: "text-emerald-600",
  },
  {
    type: "info",
    label: "System & info",
    description: "General updates, new regulations, and announcements.",
    icon: Bell,
    tone: "text-muted-foreground",
  },
]

function metaFor(type: string) {
  return (
    TYPE_META.find((m) => type.includes(m.type)) ??
    // legacy/heuristic fallbacks used by older notifications
    (type.includes("alert")
      ? TYPE_META[0]
      : type.includes("package")
        ? TYPE_META[3]
        : TYPE_META[3])
  )
}

export default function NotificationsPage() {
  const { data: notifications = [], isLoading } = useListNotifications()
  const { data: prefs } = useGetNotificationPreferences()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [filter, setFilter] = useState<Filter>("all")
  const [settingsOpen, setSettingsOpen] = useState(false)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() })
  }

  const markRead = useMarkNotificationRead()
  const markUnread = useMarkNotificationUnread()
  const markAllRead = useMarkAllNotificationsRead()
  const archive = useArchiveNotification()
  const unarchive = useUnarchiveNotification()
  const del = useDeleteNotification()
  const updatePrefs = useUpdateNotificationPreferences()

  const mutedTypes = prefs?.mutedTypes ?? []

  const counts = useMemo(() => {
    const active = (notifications as Notif[]).filter((n) => !n.archived)
    return {
      all: active.length,
      unread: active.filter((n) => !n.read).length,
      archived: (notifications as Notif[]).filter((n) => n.archived).length,
    }
  }, [notifications])

  const visible = useMemo(() => {
    const list = notifications as Notif[]
    if (filter === "archived") return list.filter((n) => n.archived)
    if (filter === "unread") return list.filter((n) => !n.archived && !n.read)
    return list.filter((n) => !n.archived)
  }, [notifications, filter])

  const handleMarkAllRead = () => {
    if (counts.unread === 0) return
    markAllRead.mutate(undefined, {
      onSuccess: () => {
        invalidate()
        toast({ title: "All caught up", description: "Every notification is marked read." })
      },
    })
  }

  const toggleMute = (type: string, muted: boolean) => {
    const next = muted
      ? Array.from(new Set([...mutedTypes, type]))
      : mutedTypes.filter((t) => t !== type)
    updatePrefs.mutate(
      { data: { mutedTypes: next } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetNotificationPreferencesQueryKey() })
          invalidate()
        },
      },
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-3xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground mt-1">Alerts, analysis results, and system messages.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={counts.unread === 0 || markAllRead.isPending}
          >
            <CheckCheck className="w-4 h-4 mr-1.5" />
            Mark all read
          </Button>
          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings2 className="w-4 h-4 mr-1.5" />
                Settings
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Notification settings</DialogTitle>
                <DialogDescription>
                  Choose which alerts you want to receive. Silenced types are hidden from your
                  feed and won't count toward your unread badge.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1 py-1">
                {TYPE_META.map((m) => {
                  const enabled = !mutedTypes.includes(m.type)
                  const Icon = m.icon
                  return (
                    <div
                      key={m.type}
                      className="flex items-start gap-3 rounded-lg p-3 hover:bg-accent/50 transition-colors"
                    >
                      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${m.tone}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{m.label}</p>
                        <p className="text-xs text-muted-foreground">{m.description}</p>
                      </div>
                      <Switch
                        checked={enabled}
                        onCheckedChange={(on) => toggleMute(m.type, !on)}
                        disabled={updatePrefs.isPending}
                        aria-label={`${enabled ? "Silence" : "Enable"} ${m.label}`}
                      />
                    </div>
                  )
                })}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList>
          <TabsTrigger value="all" className="gap-1.5">
            All
            {counts.all > 0 && <Badge variant="secondary">{counts.all}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="unread" className="gap-1.5">
            Unread
            {counts.unread > 0 && <Badge variant="secondary">{counts.unread}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="archived" className="gap-1.5">
            Archived
            {counts.archived > 0 && <Badge variant="secondary">{counts.archived}</Badge>}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {mutedTypes.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground -mt-2">
          <BellOff className="w-3.5 h-3.5" />
          <span>
            {mutedTypes.length} alert {mutedTypes.length === 1 ? "type is" : "types are"} silenced.
          </span>
          <button
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => setSettingsOpen(true)}
          >
            Manage
          </button>
        </div>
      )}

      <div className="space-y-3">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading notifications...</div>
        ) : visible.length === 0 ? (
          <div className="text-center py-16 border border-dashed rounded-xl bg-card">
            <Bell className="w-12 h-12 text-muted-foreground opacity-20 mx-auto mb-3" />
            <p className="text-lg font-medium">
              {filter === "archived"
                ? "Nothing archived"
                : filter === "unread"
                  ? "No unread notifications"
                  : "All caught up!"}
            </p>
            <p className="text-muted-foreground">
              {filter === "archived"
                ? "Archived notifications will appear here."
                : "You have no new notifications."}
            </p>
          </div>
        ) : (
          visible.map((notif) => {
            const meta = metaFor(notif.type)
            const Icon = meta.icon
            return (
              <Card
                key={notif.id}
                className={`transition-all ${
                  !notif.read && !notif.archived ? "border-primary/50 bg-primary/5" : "opacity-80"
                }`}
              >
                <CardContent className="p-4 flex gap-4">
                  <div className="mt-1 shrink-0">
                    <Icon className={`w-5 h-5 ${meta.tone}`} />
                  </div>
                  <div className="flex-1 space-y-1 min-w-0">
                    <div className="flex justify-between items-start gap-3">
                      <h4
                        className={`font-semibold ${
                          !notif.read && !notif.archived ? "text-foreground" : "text-foreground/80"
                        }`}
                      >
                        {notif.title}
                      </h4>
                      <span className="text-xs text-muted-foreground font-mono shrink-0">
                        {new Date(notif.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/80 leading-relaxed">{notif.message}</p>
                  </div>
                  <div className="shrink-0 flex items-start">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Actions">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {notif.read ? (
                          <DropdownMenuItem
                            onClick={() =>
                              markUnread.mutate({ id: notif.id }, { onSuccess: invalidate })
                            }
                          >
                            <Undo2 className="w-4 h-4 mr-2" />
                            Mark as unread
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() =>
                              markRead.mutate({ id: notif.id }, { onSuccess: invalidate })
                            }
                          >
                            <Check className="w-4 h-4 mr-2" />
                            Mark as read
                          </DropdownMenuItem>
                        )}
                        {notif.archived ? (
                          <DropdownMenuItem
                            onClick={() =>
                              unarchive.mutate({ id: notif.id }, { onSuccess: invalidate })
                            }
                          >
                            <ArchiveRestore className="w-4 h-4 mr-2" />
                            Restore
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() =>
                              archive.mutate({ id: notif.id }, { onSuccess: invalidate })
                            }
                          >
                            <Archive className="w-4 h-4 mr-2" />
                            Archive
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() =>
                            del.mutate(
                              { id: notif.id },
                              {
                                onSuccess: () => {
                                  invalidate()
                                  toast({ title: "Notification deleted" })
                                },
                              },
                            )
                          }
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
