import * as React from "react"
import { Link, useLocation } from "wouter"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/theme-provider"
import {
  LayoutDashboard,
  Upload,
  Layers,
  ListChecks,
  FileText,
  Scale,
  Building2,
  History,
  Settings,
  Bell,
  Search,
  Sun,
  Moon,
  User,
  ShieldCheck,
  ChevronDown,
  Box,
  Sparkles,
  Menu,
  Zap,
  AlertTriangle,
  ClipboardList,
  Radio,
  Wrench,
  Brain,
  Grid3x3,
  Megaphone,
  Trophy,
  Briefcase,
  LineChart,
  BookOpen,
  PenLine,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet"
import { useListNotifications } from "@workspace/api-client-react"

type NavLink = { name: string; href: string; icon?: React.ComponentType<{ className?: string }> }
type NavGroup = { name: string; icon: React.ComponentType<{ className?: string }>; items: NavLink[] }
type NavEntry = ({ type: "link" } & NavLink) | ({ type: "group" } & NavGroup)

const NAV: NavEntry[] = [
  { type: "link", name: "Dashboard", href: "/", icon: LayoutDashboard },
  {
    type: "group",
    name: "Review Queue",
    icon: ListChecks,
    items: [
      { name: "My Reviews", href: "/reviews", icon: ClipboardList },
      { name: "High Risk", href: "/queue/high-risk", icon: AlertTriangle },
      { name: "Bulk Review", href: "/bulk", icon: Layers },
      { name: "Fast Review", href: "/fast-review", icon: Zap },
      { name: "Proofing Studio", href: "/proofing", icon: PenLine },
      { name: "Assigned Reviews", href: "/queue/assigned", icon: ClipboardList },
    ],
  },
  {
    type: "group",
    name: "Packages",
    icon: Box,
    items: [
      { name: "All Packages", href: "/packages" },
      { name: "Active Reviews", href: "/packages/active" },
      { name: "Approved", href: "/packages/approved" },
      { name: "Rejected", href: "/packages/rejected" },
      { name: "Archived", href: "/packages/archived" },
    ],
  },
  {
    type: "group",
    name: "Regulatory Intelligence",
    icon: Scale,
    items: [
      { name: "FDA Library", href: "/regulatory/fda" },
      { name: "EPA Library", href: "/regulatory/epa" },
      { name: "CPSC Library", href: "/regulatory/cpsc" },
      { name: "FTC Library", href: "/regulatory/ftc" },
      { name: "USDA Library", href: "/regulatory/usda" },
      { name: "Internal SOP", href: "/regulatory/sop", icon: BookOpen },
      { name: "Regulatory Updates", href: "/regulatory-updates", icon: Radio },
    ],
  },
  {
    type: "group",
    name: "AI Compliance",
    icon: Sparkles,
    items: [
      { name: "Violations Center", href: "/ai/violations", icon: AlertTriangle },
      { name: "Recommended Fixes", href: "/ai/fixes", icon: Wrench },
      { name: "Compliance Memory", href: "/ai/memory", icon: Brain },
      { name: "Compliance Heatmaps", href: "/ai/heatmaps", icon: Grid3x3 },
      { name: "Claim Reviews", href: "/ai/claims", icon: Megaphone },
    ],
  },
  {
    type: "group",
    name: "Suppliers",
    icon: Building2,
    items: [
      { name: "Vendor Directory", href: "/suppliers" },
      { name: "Vendor Scorecards", href: "/suppliers/scorecards", icon: Trophy },
      { name: "Supplier Portal", href: "/suppliers/portal" },
    ],
  },
  {
    type: "group",
    name: "Reports",
    icon: FileText,
    items: [
      { name: "Compliance Reports", href: "/reports" },
      { name: "Executive Reports", href: "/reports/executive", icon: Briefcase },
      { name: "Trend Analysis", href: "/reports/trends", icon: LineChart },
    ],
  },
  { type: "link", name: "Audit History", href: "/audit", icon: History },
  { type: "link", name: "Admin", href: "/admin", icon: Settings },
]

function isItemActive(location: string, href: string): boolean {
  if (href === "/") return location === "/"
  if (href === "/reviews") return location === "/reviews" || location.startsWith("/reviews/")
  if (href === "/proofing") return location === "/proofing" || location.startsWith("/proofing/")
  return location === href
}

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation()
  const [manual, setManual] = React.useState<Record<string, boolean>>({})

  const groupHasActive = (g: NavGroup) => g.items.some((i) => isItemActive(location, i.href))
  const isOpen = (g: NavGroup) => manual[g.name] ?? groupHasActive(g)

  return (
    <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
      {NAV.map((entry) => {
        if (entry.type === "link") {
          const active = isItemActive(location, entry.href)
          const Icon = entry.icon
          return (
            <Link
              key={entry.name}
              href={entry.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {Icon && <Icon className="w-5 h-5" />}
              {entry.name}
            </Link>
          )
        }
        const open = isOpen(entry)
        const GroupIcon = entry.icon
        return (
          <div key={entry.name}>
            <button
              onClick={() => setManual((m) => ({ ...m, [entry.name]: !open }))}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                groupHasActive(entry) ? "text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <GroupIcon className="w-5 h-5" />
              <span className="flex-1 text-left">{entry.name}</span>
              <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
            </button>
            {open && (
              <div className="mt-0.5 mb-1 ml-4 pl-3 border-l border-border space-y-0.5">
                {entry.items.map((item) => {
                  const active = isItemActive(location, item.href)
                  const ItemIcon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                        active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {ItemIcon ? <ItemIcon className="w-4 h-4" /> : <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40" />}
                      {item.name}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 font-bold text-lg text-primary tracking-tight">
      <ShieldCheck className="w-6 h-6" />
      <span>Compliance AI</span>
    </Link>
  )
}

function UserBlock() {
  return (
    <div className="p-4 border-t border-border">
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-foreground">
          <User className="w-4 h-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-medium">Eleanor Shellstrop</span>
          <span className="text-xs text-muted-foreground">Compliance Mgr</span>
        </div>
      </div>
    </div>
  )
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useTheme()
  const [, navigate] = useLocation()
  const { data: notifications = [] } = useListNotifications()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [q, setQ] = React.useState("")
  const unreadCount = notifications.filter((n) => !n.read).length

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark")

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    navigate(`/packages${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`)
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border bg-card">
        <div className="h-16 flex items-center px-6 border-b border-border bg-card">
          <Brand />
        </div>
        <NavContent />
        <UserBlock />
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 border-b border-border bg-card flex items-center justify-between px-4 sm:px-6 shrink-0 z-10">
          <div className="flex items-center gap-3 flex-1">
            {/* Mobile menu */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0 flex flex-col">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <div className="h-16 flex items-center px-6 border-b border-border">
                  <Brand />
                </div>
                <NavContent onNavigate={() => setMobileOpen(false)} />
                <UserBlock />
              </SheetContent>
            </Sheet>

            <form onSubmit={submitSearch} className="hidden sm:flex relative w-full max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search packages, SKU, vendor..."
                className="w-full h-9 bg-accent/50 border border-border rounded-md pl-9 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-primary transition-all"
              />
            </form>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/upload">
              <Button size="sm" className="hidden sm:flex gap-2">
                <Upload className="w-4 h-4" />
                New Package
              </Button>
            </Link>
            <Button variant="ghost" size="icon" onClick={toggleTheme} title="Toggle theme">
              {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </Button>
            <Link href="/notifications">
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full" />}
              </Button>
            </Link>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-background p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  )
}
