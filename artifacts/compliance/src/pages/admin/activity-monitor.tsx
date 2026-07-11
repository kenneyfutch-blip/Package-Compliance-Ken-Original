import { useListAuditEvents, getListAuditEventsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Loader2 } from "lucide-react";

function RelativeTime({ dateString }: { dateString: string }) {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  return date.toLocaleDateString();
}

export default function ActivityMonitor() {
  const { data: events, isLoading } = useListAuditEvents(undefined, { 
    query: { refetchInterval: 15000, queryKey: getListAuditEventsQueryKey() } 
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="w-7 h-7 text-primary" /> Live Activity Stream
        </h1>
        <p className="text-muted-foreground mt-1">Real-time audit events across the compliance platform.</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : !events?.length ? (
            <div className="py-16 text-center text-muted-foreground">
              No recent activity.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {events.map((e) => (
                <div key={e.id} className="p-4 hover:bg-accent/40 transition-colors flex items-start gap-4">
                  <div className="mt-1.5 h-2 w-2 rounded-full bg-primary ring-4 ring-primary/20 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm text-foreground">{e.actor}</span>
                      <Badge variant="outline" className="text-[10px] py-0 h-5 font-mono">{e.action}</Badge>
                      {e.entityType && (
                        <Badge variant="secondary" className="text-[10px] py-0 h-5 text-muted-foreground">
                          {e.entityType} {e.entityId ? `#${e.entityId}` : ""}
                        </Badge>
                      )}
                    </div>
                    {e.detail && (
                      <div className="text-sm text-muted-foreground mt-1">{e.detail}</div>
                    )}
                  </div>
                  <div className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                    <RelativeTime dateString={e.createdAt} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
