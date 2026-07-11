import { useListNotifications, useMarkNotificationRead } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Bell, Check, Package, ShieldAlert } from "lucide-react"
import { getListNotificationsQueryKey } from "@workspace/api-client-react"

export default function NotificationsPage() {
  const { data: notifications = [], isLoading } = useListNotifications()
  const markRead = useMarkNotificationRead()
  const queryClient = useQueryClient()

  const handleMarkRead = (id: number) => {
    markRead.mutate({ id }, {
      onSuccess: () => {
        // Invalidate the query to refresh the notifications list and update the top nav badge
        queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() })
      }
    })
  }

  const getIcon = (type: string) => {
    if (type.includes('alert')) return <ShieldAlert className="w-5 h-5 text-destructive" />
    if (type.includes('package')) return <Package className="w-5 h-5 text-primary" />
    return <Bell className="w-5 h-5 text-muted-foreground" />
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-3xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground mt-1">Alerts, analysis results, and system messages.</p>
        </div>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <div className="text-center py-8">Loading notifications...</div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-16 border border-dashed rounded-xl bg-card">
            <Bell className="w-12 h-12 text-muted-foreground opacity-20 mx-auto mb-3" />
            <p className="text-lg font-medium">All caught up!</p>
            <p className="text-muted-foreground">You have no new notifications.</p>
          </div>
        ) : notifications.map(notif => (
          <Card key={notif.id} className={`transition-all ${!notif.read ? 'border-primary/50 bg-primary/5' : 'opacity-70'}`}>
            <CardContent className="p-4 flex gap-4">
              <div className="mt-1 shrink-0">
                {getIcon(notif.type)}
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex justify-between items-start">
                  <h4 className={`font-semibold ${!notif.read ? 'text-foreground' : 'text-foreground/80'}`}>{notif.title}</h4>
                  <span className="text-xs text-muted-foreground font-mono">{new Date(notif.createdAt).toLocaleDateString()}</span>
                </div>
                <p className="text-sm text-foreground/80 leading-relaxed">{notif.message}</p>
              </div>
              {!notif.read && (
                <div className="shrink-0 flex items-center">
                  <Button variant="ghost" size="icon" onClick={() => handleMarkRead(notif.id)} title="Mark as read" className="text-primary hover:bg-primary/20 hover:text-primary">
                    <Check className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
