import { UserProfile } from "@clerk/react"
import { Link } from "wouter"
import {
  LayoutDashboard, ListChecks, Activity, BarChart3, Cpu, Plug, FileText,
  Users, UsersRound, ShieldCheck, GaugeCircle, ScrollText, HeartPulse,
  ChevronRight, UserCog,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { usePermissions } from "@/lib/access"
import { requiredPermFor } from "@/lib/permissions"

// Path routing base for this artifact (mirrors the sign-in page). Clerk drives
// its own sub-navigation (/account/security, etc.) off this absolute path.
const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "")

// Administration entry points, grouped. Each is shown only when the signed-in
// user actually has the permission that guards it — reusing requiredPermFor so
// this page can never drift from the route gate / sidebar nav.
const ADMIN_GROUPS: {
  title: string
  links: { path: string; label: string; description: string; icon: React.ElementType }[]
}[] = [
  {
    title: "Administration",
    links: [
      { path: "/admin/dashboard", label: "Admin dashboard", description: "Org-wide health and KPIs", icon: LayoutDashboard },
      { path: "/admin/queue", label: "Review queue", description: "Oversee all in-flight reviews", icon: ListChecks },
      { path: "/admin/activity", label: "Activity monitor", description: "Live audit activity feed", icon: Activity },
      { path: "/admin/usage", label: "Usage analytics", description: "Adoption and throughput", icon: BarChart3 },
      { path: "/admin/ai-usage", label: "AI usage & cost", description: "Model spend and volume", icon: Cpu },
      { path: "/admin/integrations", label: "AI providers", description: "Models and API keys", icon: Plug },
      { path: "/admin/policies", label: "Policy management", description: "Author internal standards", icon: FileText },
    ],
  },
  {
    title: "Operations",
    links: [
      { path: "/operations/users", label: "Users", description: "Roles and team assignment", icon: Users },
      { path: "/operations/teams", label: "Teams", description: "Team structure", icon: UsersRound },
      { path: "/operations/roles", label: "Roles & permissions", description: "Access control", icon: ShieldCheck },
      { path: "/operations/workload", label: "Workload & SLA", description: "Assignment load and SLAs", icon: GaugeCircle },
      { path: "/operations/audit", label: "Audit center", description: "Immutable audit trail", icon: ScrollText },
      { path: "/operations/system", label: "System health", description: "Service and job status", icon: HeartPulse },
    ],
  },
]

export default function AccountPage() {
  const { me, has } = usePermissions()

  const displayName = me?.name || me?.email || "Your account"
  const email = me?.email ?? null
  const role = me?.role ?? "Member"

  // Filter each group to the links this user is allowed to open.
  const visibleGroups = ADMIN_GROUPS.map((g) => ({
    ...g,
    links: g.links.filter((l) => {
      const perm = requiredPermFor(l.path)
      return perm === null || has(perm)
    }),
  })).filter((g) => g.links.length > 0)

  return (
    <div className="space-y-8 animate-in fade-in duration-300 max-w-5xl mx-auto pb-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <UserCog className="w-7 h-7 text-primary" /> Account
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your profile, security, and — for administrators — org-wide controls.
          </p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1">
          <span className="text-sm font-medium">{displayName}</span>
          <div className="flex items-center gap-2">
            {email && <span className="text-xs text-muted-foreground">{email}</span>}
            <Badge variant="secondary" className="capitalize">{role}</Badge>
          </div>
        </div>
      </div>

      {/* Personal account (Clerk) — rendered inline as a page, not a modal. */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Profile &amp; security
        </h2>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <UserProfile
            routing="path"
            path={`${BASE_PATH}/account`}
            appearance={{
              elements: {
                rootBox: "w-full",
                cardBox: "w-full max-w-none shadow-none border-0 rounded-none",
                navbar: "border-r border-border",
              },
            }}
          />
        </div>
      </section>

      {/* Administration & operations — only the surfaces this user can access. */}
      {visibleGroups.length > 0 && (
        <section className="space-y-6">
          {visibleGroups.map((group) => (
            <div key={group.title}>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                {group.title}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.links.map((link) => (
                  // This page renders inside a `nest`ed /account route (so Clerk
                  // can own its sub-routes). A plain "/admin/..." href would
                  // resolve relative to /account and go nowhere — the `~` prefix
                  // escapes the nest, and we re-add BASE_PATH since `~` also
                  // strips the app's top-level router base.
                  <Link key={link.path} href={`~${BASE_PATH}${link.path}`}>
                    <Card className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-sm">
                      <CardContent className="p-4 flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <link.icon className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{link.label}</p>
                          <p className="text-xs text-muted-foreground truncate">{link.description}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
