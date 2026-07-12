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
  Menu,
  Zap,
  AlertTriangle,
  ClipboardList,
  Radio,
  ShieldAlert,
  Wrench,
  Brain,
  Grid3x3,
  Megaphone,
  Trophy,
  Briefcase,
  LineChart,
  DollarSign,
  BookOpen,
  Languages,
  Users,
  UsersRound,
  Gauge,
  Activity,
  Plug,
  ScrollText,
  Library,
  Star,
  LogOut,
  UserCog,
  GraduationCap,
  Rocket,
  Compass,
  Video,
  Lightbulb,
  HelpCircle,
  Sparkles,
  LifeBuoy,
  BookMarked,
} from "lucide-react"
import { useUser, useClerk } from "@clerk/react"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useListNotifications } from "@workspace/api-client-react"
import { usePermissions } from "@/lib/access"
import { useFavorites } from "@/lib/favorites"
import { requiredPermFor } from "@/lib/permissions"
import { OnboardingTour } from "@/components/training/onboarding-tour"

type NavItem = { name: string; href: string; icon: React.ComponentType<{ className?: string }> }
/** A labeled, collapsible cluster of items rendered inside a section. */
type NavGroup = { group: string; items: NavItem[] }
/** A section entry is either a direct item or a sub-group of items. */
type NavEntry = NavItem | NavGroup
type NavSection = {
  id: string
  label: string
  /** Sensible default when the user has never toggled this section. Defaults to true. */
  defaultOpen?: boolean
  items: NavEntry[]
}

const isGroup = (entry: NavEntry): entry is NavGroup =>
  (entry as NavGroup).group !== undefined

// Flatten a section's entries (direct items + grouped items) into a flat item
// list — used for favorites lookup, permission counts, and active detection.
const flattenEntries = (entries: NavEntry[]): NavItem[] =>
  entries.flatMap((e) => (isGroup(e) ? e.items : [e]))

// Declarative navigation model. Sections are labeled, scannable groupings; new
// modules are added by editing this data, never the layout below. Every href
// must map to a route registered in App.tsx — no dead links. Reserved sections
// (My Work, Team Management, Compliance, Knowledge, …) already have slots so
// modules from other in-flight work drop in by adding a line here.
const SECTIONS: NavSection[] = [
  {
    id: "my-work",
    label: "My Work",
    items: [
      { name: "My Dashboard", href: "/my-dashboard", icon: Gauge },
      { name: "My Reviews", href: "/reviews", icon: ClipboardList },
      { name: "My Tasks", href: "/my-work", icon: Briefcase },
      { name: "My Notifications", href: "/notifications", icon: Bell },
    ],
  },
  {
    id: "home",
    label: "Home",
    items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard },
      { name: "New Package", href: "/upload", icon: Upload },
    ],
  },
  {
    id: "review-operations",
    label: "Review Operations",
    items: [
      { name: "High Risk Queue", href: "/queue/high-risk", icon: AlertTriangle },
      { name: "Assigned Reviews", href: "/queue/assigned", icon: ClipboardList },
      { name: "Bulk Review", href: "/bulk", icon: Layers },
      { name: "Fast Review", href: "/fast-review", icon: Zap },
    ],
  },
  {
    id: "products",
    label: "Products",
    items: [
      { name: "All Packages", href: "/packages", icon: Box },
      { name: "Active Reviews", href: "/packages/active", icon: ListChecks },
      { name: "Approved", href: "/packages/approved", icon: ShieldCheck },
      { name: "Rejected", href: "/packages/rejected", icon: AlertTriangle },
      { name: "Archived", href: "/packages/archived", icon: History },
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    defaultOpen: false,
    // Grouped into scannable sub-clusters so the section stays compact. The five
    // per-agency libraries collapse into one "Regulatory Library" (the combined
    // knowledge base at /regulations, which already filters by agency).
    items: [
      { name: "Compliance Dashboard", href: "/", icon: LayoutDashboard },
      {
        group: "Reviews & Findings",
        items: [
          { name: "Violations Center", href: "/ai/violations", icon: AlertTriangle },
          { name: "Claim Reviews", href: "/ai/claims", icon: Megaphone },
          { name: "Language Review", href: "/ai/language", icon: Languages },
          { name: "Recommended Fixes", href: "/ai/fixes", icon: Wrench },
        ],
      },
      {
        group: "Intelligence",
        items: [
          { name: "Compliance Heatmaps", href: "/ai/heatmaps", icon: Grid3x3 },
          { name: "Compliance Memory", href: "/ai/memory", icon: Brain },
        ],
      },
      {
        group: "Regulatory Hub",
        items: [
          { name: "Regulatory Library", href: "/regulations", icon: Scale },
          { name: "Regulatory Sources", href: "/regulatory/sources", icon: ShieldCheck },
          { name: "Regulatory Updates", href: "/regulatory-updates", icon: Radio },
          { name: "FDA Recalls", href: "/regulatory/recalls", icon: ShieldAlert },
        ],
      },
      { name: "Internal SOP", href: "/regulatory/sop", icon: BookOpen },
    ],
  },
  {
    id: "partners",
    label: "Partners",
    defaultOpen: false,
    items: [
      { name: "Vendor Directory", href: "/suppliers", icon: Building2 },
      { name: "Vendor Scorecards", href: "/suppliers/scorecards", icon: Trophy },
      { name: "Supplier Portal", href: "/suppliers/portal", icon: Building2 },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    defaultOpen: false,
    items: [
      { name: "Resource Center", href: "/resources", icon: Library },
      { name: "Policy Repository", href: "/resources/policies", icon: ScrollText },
      { name: "SOP Documents", href: "/resources/sop", icon: FileText },
      { name: "Approved Language", href: "/resources/glossary", icon: Languages },
    ],
  },
  {
    id: "analytics",
    label: "Analytics",
    defaultOpen: false,
    items: [
      { name: "Compliance Reports", href: "/reports", icon: FileText },
      { name: "Executive Reports", href: "/reports/executive", icon: Briefcase },
      { name: "Trend Analysis", href: "/reports/trends", icon: LineChart },
    ],
  },
  {
    id: "team-management",
    label: "Team Management",
    // Manager-facing; collapsed by default for day-to-day specialists.
    defaultOpen: false,
    items: [
      { name: "Team Dashboard", href: "/operations/teams", icon: UsersRound },
      { name: "Assignments", href: "/admin/queue", icon: ClipboardList },
      { name: "Workload & SLA", href: "/operations/workload", icon: Gauge },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    // System administration; collapsed by default.
    defaultOpen: false,
    items: [
      { name: "Admin Overview", href: "/admin/dashboard", icon: LayoutDashboard },
      { name: "Activity Monitor", href: "/admin/activity", icon: Activity },
      { name: "Usage Analytics", href: "/admin/usage", icon: LineChart },
      { name: "AI Cost & Usage", href: "/admin/ai-usage", icon: DollarSign },
      { name: "Integrations", href: "/admin/integrations", icon: Plug },
      { name: "Policy Management", href: "/admin/policies", icon: ScrollText },
      { name: "User Management", href: "/operations/users", icon: Users },
      { name: "Roles & Permissions", href: "/operations/roles", icon: ShieldCheck },
      { name: "Audit Center", href: "/operations/audit", icon: History },
      { name: "Queue & Health", href: "/operations/system", icon: Activity },
      { name: "Settings", href: "/admin", icon: Settings },
    ],
  },
  {
    id: "training",
    label: "Training & Help",
    // Available to everyone (including suppliers); collapsed by default.
    defaultOpen: false,
    items: [
      { name: "Getting Started", href: "/training/getting-started", icon: Rocket },
      { name: "User Guide", href: "/training/user-guide", icon: BookOpen },
      { name: "Interactive Walkthroughs", href: "/training/walkthroughs", icon: Compass },
      { name: "Video Tutorials", href: "/training/videos", icon: Video },
      { name: "Best Practices", href: "/training/best-practices", icon: Lightbulb },
      { name: "Compliance Academy", href: "/training/academy", icon: GraduationCap },
      { name: "FAQ", href: "/training/faq", icon: HelpCircle },
      { name: "Release Notes", href: "/training/release-notes", icon: Sparkles },
      { name: "Platform Glossary", href: "/training/glossary", icon: BookMarked },
      { name: "Contact Support", href: "/training/support", icon: LifeBuoy },
    ],
  },
]

// Sections that live in the TOP navigation bar (as click-to-open dropdowns)
// instead of the left sidebar. The left sidebar renders every OTHER section.
// The mobile sheet still renders all sections so nothing is unreachable there.
const TOP_SECTION_IDS = new Set(["analytics", "team-management", "administration"])

// Flat lookup of every nav item by href, so starred favorites (stored as bare
// hrefs) can be rendered with their proper label and icon anywhere. First
// occurrence wins: an href reused as a shortcut in a later section (e.g. "/"
// surfaced as "Compliance Dashboard") still resolves to its canonical label
// and icon from the earliest section ("Dashboard" under Home).
const ALL_ITEMS: Record<string, NavItem> = SECTIONS.reduce<Record<string, NavItem>>(
  (acc, s) => {
    for (const i of flattenEntries(s.items)) if (!(i.href in acc)) acc[i.href] = i
    return acc
  },
  {},
)

// Resolve the user's starred hrefs to nav items — preserving star order and
// dropping any the user can't access (permission) or that no longer exist.
function useFavoriteItems(): NavItem[] {
  const { favorites } = useFavorites()
  const { has } = usePermissions()
  return React.useMemo(
    () =>
      favorites
        .map((href) => ALL_ITEMS[href])
        .filter((it): it is NavItem => Boolean(it))
        .filter((it) => {
          const perm = requiredPermFor(it.href)
          return perm === null || has(perm)
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [favorites, has],
  )
}

function isItemActive(location: string, href: string): boolean {
  if (href === "/") return location === "/"
  if (href === "/reviews") return location === "/reviews" || location.startsWith("/reviews/")
  return location === href
}

// Persist which sections the user has explicitly opened/closed, so the layout
// survives navigation and reloads. Stores only user overrides; untouched
// sections fall back to their declared defaultOpen.
const NAV_STATE_KEY = "compliance-nav-sections-v1"

function loadSectionState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(NAV_STATE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

// A single sidebar row: the tool link plus a star toggle (revealed on hover,
// always shown once starred). The star is a sibling of the Link — never nested
// inside the anchor — so it stays valid, clickable markup.
function NavRow({
  item,
  active,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  onNavigate?: () => void
}) {
  const { isFavorite, toggle } = useFavorites()
  const fav = isFavorite(item.href)
  const Icon = item.icon
  return (
    <div
      className={cn(
        "group/navrow flex items-center rounded-md border-l-2 transition-colors",
        active ? "bg-primary/10 border-primary" : "border-transparent hover:bg-accent",
      )}
    >
      <Link
        href={item.href}
        onClick={onNavigate}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 pl-3 pr-1 py-2.5 text-sm",
          active
            ? "text-primary font-medium"
            : "text-foreground group-hover/navrow:text-foreground",
        )}
      >
        <Icon className={cn("w-4 h-4 shrink-0", active && "text-primary")} />
        <span className="truncate">{item.name}</span>
      </Link>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          toggle(item.href)
        }}
        aria-pressed={fav}
        aria-label={
          fav ? `Remove ${item.name} from favorites` : `Add ${item.name} to favorites`
        }
        title={fav ? "Remove from favorites" : "Add to favorites"}
        className={cn(
          "mr-1.5 shrink-0 rounded p-1 transition-opacity",
          fav
            ? "text-amber-500 opacity-100"
            : "text-muted-foreground opacity-0 hover:text-amber-500 focus-visible:opacity-100 group-hover/navrow:opacity-100",
        )}
      >
        <Star className={cn("w-3.5 h-3.5", fav && "fill-amber-500")} />
      </button>
    </div>
  )
}

// A collapsible sub-group inside a section (e.g. "Reviews & Findings" under
// Compliance). Defaults open; force-opens when it contains the active page so
// the current location is never hidden. Open/closed state is persisted by the
// parent via the shared overrides map, keyed "<sectionId>:<groupLabel>".
function NavGroupBlock({
  group,
  location,
  open,
  onToggle,
  onNavigate,
}: {
  group: NavGroup
  location: string
  open: boolean | undefined
  onToggle: () => void
  onNavigate?: () => void
}) {
  const groupActive = group.items.some((i) => isItemActive(location, i.href))
  const isOpen = groupActive || (open ?? true)
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-md text-left hover:bg-accent/40 transition-colors"
      >
        <span
          className={cn(
            "flex-1 text-[10px] font-semibold uppercase tracking-wider",
            groupActive ? "text-foreground/90" : "text-muted-foreground",
          )}
        >
          {group.group}
        </span>
        {groupActive && !isOpen && (
          <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden />
        )}
        <ChevronDown
          className={cn(
            "w-3 h-3 text-muted-foreground/60 transition-transform",
            !isOpen && "-rotate-90",
          )}
          aria-hidden
        />
      </button>
      {isOpen && (
        <div className="mt-0.5 ml-3 space-y-1 border-l border-border/50 pl-1">
          {group.items.map((item) => (
            <NavRow
              key={item.href}
              item={item}
              active={isItemActive(location, item.href)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function NavContent({
  onNavigate,
  excludeSectionIds,
}: {
  onNavigate?: () => void
  excludeSectionIds?: Set<string>
}) {
  const [location] = useLocation()
  const { has } = usePermissions()
  const favoriteItems = useFavoriteItems()
  const [overrides, setOverrides] = React.useState<Record<string, boolean>>(() => loadSectionState())

  React.useEffect(() => {
    try {
      localStorage.setItem(NAV_STATE_KEY, JSON.stringify(overrides))
    } catch {
      /* storage unavailable — non-fatal, state just won't persist */
    }
  }, [overrides])

  const canSee = (href: string) => {
    const perm = requiredPermFor(href)
    return perm === null || has(perm)
  }

  // Hide items the caller lacks permission for; drop sections left empty.
  const visibleSections = React.useMemo(() => {
    return SECTIONS.map((section) => ({
      ...section,
      items: section.items
        // Filter items within sub-groups, dropping any group left empty.
        .map((e) =>
          isGroup(e) ? { ...e, items: e.items.filter((i) => canSee(i.href)) } : e,
        )
        .filter((e) => (isGroup(e) ? e.items.length > 0 : canSee(e.href))),
    }))
      .filter((section) => !excludeSectionIds?.has(section.id))
      .filter((section) => flattenEntries(section.items).length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [has, excludeSectionIds])

  const toggle = (section: NavSection) =>
    setOverrides((prev) => ({
      ...prev,
      [section.id]: !(prev[section.id] ?? section.defaultOpen ?? true),
    }))

  return (
    <nav className="flex-1 overflow-y-auto py-4 px-3">
      {favoriteItems.length > 0 && (
        <div className="mb-3 border-b border-border/60 pb-3">
          <div className="flex items-center gap-2 px-3 py-2">
            <Star className="w-3.5 h-3.5 shrink-0 text-amber-500 fill-amber-500" aria-hidden />
            <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
              Favorites
            </span>
          </div>
          <div className="mt-1 mb-1 space-y-1">
            {favoriteItems.map((item) => (
              <NavRow
                key={`fav-${item.href}`}
                item={item}
                active={isItemActive(location, item.href)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      )}
      {visibleSections.map((section, idx) => {
        // "/" is canonically owned by the Home section. The Compliance section
        // carries a convenience shortcut ("Compliance Dashboard") to the same
        // route, but that duplicate must not force Compliance open on the home
        // page — so ignore "/" for active/open detection outside Home.
        const sectionActive = flattenEntries(section.items).some(
          (i) =>
            isItemActive(location, i.href) &&
            !(i.href === "/" && section.id !== "home"),
        )
        // The section holding the active page is always open; otherwise honor the
        // user's explicit choice, falling back to the section's sensible default.
        const open = sectionActive || (overrides[section.id] ?? section.defaultOpen ?? true)
        // Give the "My Work" section a light grey backing so it visually breaks
        // up the long navigation list.
        const isMyWork = section.id === "my-work"
        return (
          <div
            key={section.id}
            data-tour={`nav-${section.id}`}
            className={cn(
              idx > 0 && !isMyWork && "mt-3 border-t border-border/60 pt-3",
              isMyWork && "mt-3 rounded-lg bg-muted/60 px-1 py-1.5",
            )}
          >
            <button
              type="button"
              onClick={() => toggle(section)}
              aria-expanded={open}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left group hover:bg-accent/50 transition-colors"
            >
              <span
                className={cn(
                  "flex-1 text-[11px] font-semibold uppercase tracking-wider",
                  sectionActive ? "text-foreground" : "text-foreground/80",
                )}
              >
                {section.label}
              </span>
              {sectionActive && !open && <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden />}
              <ChevronDown
                className={cn(
                  "w-3.5 h-3.5 text-muted-foreground/70 transition-transform",
                  !open && "-rotate-90",
                )}
                aria-hidden
              />
            </button>
            {open && (
              <div className="mt-1 mb-1 space-y-1">
                {section.items.map((entry) =>
                  isGroup(entry) ? (
                    <NavGroupBlock
                      key={`${section.id}:${entry.group}`}
                      group={entry}
                      location={location}
                      open={overrides[`${section.id}:${entry.group}`]}
                      onToggle={() =>
                        setOverrides((prev) => {
                          const key = `${section.id}:${entry.group}`
                          return { ...prev, [key]: !(prev[key] ?? true) }
                        })
                      }
                      onNavigate={onNavigate}
                    />
                  ) : (
                    <NavRow
                      key={entry.href}
                      item={entry}
                      active={isItemActive(location, entry.href)}
                      onNavigate={onNavigate}
                    />
                  ),
                )}
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
    <Link href="/" className="flex items-center gap-2.5 tracking-tight min-w-0">
      <span className="flex items-center justify-center rounded-md bg-white p-1 ring-1 ring-black/5 shrink-0">
        <img
          src={`${import.meta.env.BASE_URL}dollar-tree-logo.png`}
          alt="Dollar Tree"
          className="h-12 w-auto object-contain"
        />
      </span>
      <span className="flex flex-col leading-none border-l border-border pl-2.5 min-w-0">
        <span className="text-base font-bold text-foreground truncate">Compliance AI</span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground truncate">
          Packaging Review
        </span>
      </span>
    </Link>
  )
}

// Base path prefix for this artifact (e.g. "/compliance"); used as the safe
// post-logout redirect target so sign-out returns to the app's landing page.
const APP_BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "")

function initialsFrom(value: string): string {
  return value
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

function UserBlock() {
  const { me } = usePermissions()
  const { user } = useUser()
  const { signOut } = useClerk()
  const [, navigate] = useLocation()
  const displayName = me?.name || me?.email || "Signed in"
  const roleName = me?.role || "Member"
  const email = me?.email ?? user?.primaryEmailAddress?.emailAddress ?? null
  const initials = initialsFrom(me?.name || me?.email || "")

  return (
    <div className="p-3 border-t border-border">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Open profile menu"
            className="w-full flex items-center gap-3 px-2 py-2 rounded-md text-left hover:bg-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Avatar className="w-9 h-9">
              {user?.imageUrl && <AvatarImage src={user.imageUrl} alt={displayName} />}
              <AvatarFallback className="text-xs font-semibold text-foreground">
                {initials || <User className="w-4 h-4" />}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-medium truncate text-foreground">{displayName}</span>
              <span className="text-xs text-muted-foreground truncate">{roleName}</span>
            </div>
            <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-60">
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="truncate">{displayName}</span>
            {email && (
              <span className="text-xs font-normal text-muted-foreground truncate">{email}</span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 cursor-pointer"
            onSelect={() => navigate("/account")}
          >
            <UserCog className="w-4 h-4 shrink-0 text-muted-foreground" />
            <span>Account &amp; settings</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 cursor-pointer text-destructive focus:text-destructive"
            onSelect={() => signOut({ redirectUrl: APP_BASE_PATH || "/" })}
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Log out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// Quick-access favorites menu for the top navigation — jump to any starred tool
// from anywhere in the app.
function FavoritesMenu() {
  const [, navigate] = useLocation()
  const favoriteItems = useFavoriteItems()
  const hasFavorites = favoriteItems.length > 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-tour="favorites" variant="ghost" size="icon" title="Favorite tools" aria-label="Favorite tools">
          <Star className={cn("w-5 h-5", hasFavorites && "text-amber-500 fill-amber-500")} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Favorite tools</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hasFavorites ? (
          favoriteItems.map((item) => {
            const Icon = item.icon
            return (
              <DropdownMenuItem
                key={item.href}
                onSelect={() => navigate(item.href)}
                className="gap-2 cursor-pointer"
              >
                <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{item.name}</span>
              </DropdownMenuItem>
            )
          })
        ) : (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Hover any tool in the sidebar and tap its star to pin it here for quick access.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Top-level section navigation (desktop only). The manager/admin-facing
// sections (Analytics, Team Management, Administration) render here as
// click-to-open dropdowns of their items, rather than in the left sidebar.
// Permission-filtered per item; a section with no visible items is hidden.
function TopNavMenus() {
  const [location, navigate] = useLocation()
  const { has } = usePermissions()

  const sections = React.useMemo(() => {
    const canSee = (href: string) => {
      const perm = requiredPermFor(href)
      return perm === null || has(perm)
    }
    return SECTIONS.filter((s) => TOP_SECTION_IDS.has(s.id))
      .map((s) => ({
        id: s.id,
        label: s.label,
        items: flattenEntries(s.items).filter((i) => canSee(i.href)),
      }))
      .filter((s) => s.items.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [has])

  if (sections.length === 0) return null

  return (
    <nav className="hidden md:flex items-center gap-1" aria-label="Sections">
      {sections.map((section) => {
        const active = section.items.some((i) => isItemActive(location, i.href))
        return (
          <DropdownMenu key={section.id}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn("gap-1.5", active && "text-primary font-medium")}
              >
                {section.label}
                <ChevronDown className="w-3.5 h-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {section.items.map((item) => {
                const Icon = item.icon
                return (
                  <DropdownMenuItem
                    key={item.href}
                    onSelect={() => navigate(item.href)}
                    className={cn(
                      "gap-2 cursor-pointer",
                      isItemActive(location, item.href) && "text-primary font-medium",
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{item.name}</span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      })}
    </nav>
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
      <aside data-tour="sidebar" className="hidden md:flex flex-col w-64 border-r border-border bg-card">
        <div className="h-16 flex items-center px-6 border-b border-border bg-card">
          <Brand />
        </div>
        <NavContent excludeSectionIds={TOP_SECTION_IDS} />
        <UserBlock />
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 border-b border-border bg-card flex items-center justify-between px-4 sm:px-6 shrink-0 z-10">
          <div data-tour="global-search" className="flex items-center gap-3 flex-1">
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
            <TopNavMenus />
          </div>
          <div className="flex items-center gap-2">
            <Link href="/upload">
              <Button size="sm" className="hidden sm:flex gap-2">
                <Upload className="w-4 h-4" />
                New Package
              </Button>
            </Link>
            <FavoritesMenu />
            <Button variant="ghost" size="icon" onClick={toggleTheme} title="Toggle theme">
              {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </Button>
            <Link href="/notifications">
              <Button data-tour="notifications" variant="ghost" size="icon" className="relative">
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
      <OnboardingTour />
    </div>
  )
}
