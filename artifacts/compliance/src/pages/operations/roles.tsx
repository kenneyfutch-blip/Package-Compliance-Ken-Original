import { useListRoles } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ShieldCheck, Loader2, Star } from "lucide-react"

// Human labels for the permission keys so the read-only role catalog is legible.
function permLabel(key: string): string {
  if (key === "*") return "Full platform access"
  const [domain, action] = key.split(":")
  const d = domain.replace(/(^|_)([a-z])/g, (_m, _s, c) => " " + c.toUpperCase()).trim()
  return `${action === "write" ? "Manage" : action === "read" ? "View" : action === "manage" ? "Manage" : action} ${d}`
}

export default function RoleManagement() {
  const { data: roles = [], isLoading } = useListRoles()
  const sorted = [...roles].sort((a, b) => b.rank - a.rank)

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="w-7 h-7 text-primary" /> Roles & Permissions
        </h1>
        <p className="text-muted-foreground mt-1">
          Roles are defined in code and enforced on every request. This is a read-only reference of what each role can do.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sorted.map((r) => {
            const fullAccess = r.permissions.includes("*")
            return (
              <Card key={r.key}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2">{r.name}</CardTitle>
                    <Badge variant="outline" className="gap-1"><Star className="w-3 h-3" />Rank {r.rank}</Badge>
                  </div>
                  <CardDescription>{r.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  {fullAccess ? (
                    <Badge className="bg-primary/10 text-primary hover:bg-primary/20">Full platform access</Badge>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {r.permissions.length === 0
                        ? <span className="text-sm text-muted-foreground">No permissions.</span>
                        : r.permissions.map((p) => <Badge key={p} variant="secondary">{permLabel(p)}</Badge>)}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
