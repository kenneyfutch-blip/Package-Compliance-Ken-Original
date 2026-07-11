import * as React from "react"
import { Link, useLocation } from "wouter"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/theme-provider"
import { 
  Box, 
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
  ChevronRight
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useListNotifications } from "@workspace/api-client-react"

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation()
  const { theme, setTheme } = useTheme()
  const { data: notifications = [] } = useListNotifications()
  const unreadCount = notifications.filter(n => !n.read).length

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark")
  }

  const navItems = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Upload", href: "/upload", icon: Upload },
    { name: "Bulk Process", href: "/bulk", icon: Layers },
    { name: "Reviews", href: "/reviews", icon: ListChecks },
    { name: "Reports", href: "/reports", icon: FileText },
    { name: "Regulations", href: "/regulations", icon: Scale },
    { name: "Suppliers", href: "/suppliers", icon: Building2 },
    { name: "Audit Log", href: "/audit", icon: History },
    { name: "Settings", href: "/admin", icon: Settings },
  ]

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden flex-col md:flex-row">
      {/* Sidebar - hidden on mobile, block on md */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border bg-card">
        <div className="h-16 flex items-center px-6 border-b border-border bg-card">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg text-primary tracking-tight">
            <ShieldCheck className="w-6 h-6" />
            <span>Compliance AI</span>
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href))
            return (
              <Link 
                key={item.name} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-primary/10 text-primary" 
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <item.icon className="w-5 h-5" />
                {item.name}
                {isActive && <ChevronRight className="w-4 h-4 ml-auto opacity-50" />}
              </Link>
            )
          })}
        </div>
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
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="h-16 border-b border-border bg-card flex items-center justify-between px-4 sm:px-6 shrink-0 z-10">
          <div className="flex items-center gap-4 flex-1">
            <div className="md:hidden flex items-center gap-2 font-bold text-lg text-primary">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div className="hidden sm:flex relative w-full max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input 
                type="text" 
                placeholder="Search packages, SKU, vendor..." 
                className="w-full h-9 bg-accent/50 border border-border rounded-md pl-9 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-primary transition-all"
              />
            </div>
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
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full" />
                )}
              </Button>
            </Link>
          </div>
        </header>

        {/* Main Scrollable Area */}
        <main className="flex-1 overflow-y-auto bg-background p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
