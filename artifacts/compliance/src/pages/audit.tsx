import { useListAuditEvents } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Clock, User, Package, Settings, ShieldAlert, CheckCircle } from "lucide-react"

export default function AuditPage() {
  const { data: events = [], isLoading } = useListAuditEvents()

  const getActionIcon = (action: string) => {
    if (action.includes('Create')) return <Package className="w-4 h-4 text-primary" />
    if (action.includes('Approve')) return <CheckCircle className="w-4 h-4 text-success" />
    if (action.includes('Reject') || action.includes('Violation')) return <ShieldAlert className="w-4 h-4 text-destructive" />
    if (action.includes('Analyze')) return <Settings className="w-4 h-4 text-warning" />
    return <Clock className="w-4 h-4 text-muted-foreground" />
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Global Audit Log</h1>
          <p className="text-muted-foreground mt-1">Immutable record of system actions and reviews.</p>
        </div>
      </div>

      <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-border">
        {isLoading ? (
          <div className="text-center py-8">Loading audit log...</div>
        ) : events.map((event, i) => (
          <div key={event.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
            {/* Icon */}
            <div className="flex items-center justify-center w-10 h-10 rounded-full border border-border bg-card shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
              {getActionIcon(event.action)}
            </div>
            
            {/* Card */}
            <Card className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] hover-elevate transition-all">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="outline" className="font-mono text-[10px]">{event.action}</Badge>
                  <time className="text-xs text-muted-foreground font-mono">{new Date(event.createdAt).toLocaleString()}</time>
                </div>
                <div className="text-sm font-medium mb-1">
                  {event.detail || "Action performed"}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-3 pt-3 border-t border-border/50">
                  <span className="flex items-center gap-1"><User className="w-3 h-3"/> {event.actor}</span>
                  {event.packageId && (
                    <span className="flex items-center gap-1 font-mono"><Package className="w-3 h-3"/> PKG-{event.packageId}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </div>
  )
}
