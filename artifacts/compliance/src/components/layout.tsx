import * as React from "react"
import { Link, useLocation } from "wouter"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/theme-provider"
import { PoweredByAi } from "@/components/powered-by-ai"
import { AssistantPanel } from "@/components/assistant-panel"
import {
  LayoutDashboard,
  Upload,
  Layers,
  ListChecks,
  Inbox,
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
  Bot,
} from "lucide-react"
import { UserRound, Network, Workflow as WorkflowIcon, TrendingUp } from "lucide-react"
import { useUser, useClerk } from "@clerk/react"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  useListNotifications,
  useGetReviewPresence,
  getGetReviewPresenceQueryKey,
  useListPackages,
  getListPackagesQueryKey,
} from "@workspace/api-client-react"
import { usePermissions } from "@/lib/access"
import { PresenceStrip } from "@/components/presence-indicators"
import { useFavorites } from "@/lib/favorites"
import { requiredPermFor } from "@/lib/permissions"
import { OnboardingTour } from "@/components/training/onboarding-tour"
import { BuilderBadge } from "@/components/builder-badge"

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
    defaultOpen: true,
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
    defaultOpen: true,
    items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard },
      { name: "New Package", href: "/upload", icon: Upload },
      { name: "AI Workspace", href: "/ai-workspace/home", icon: Sparkles },
      { name: "AI Assistant", href: "/ai-workspace", icon: Bot },
    ],
  },
  {
    id: "products",
    label: "Packages",
    defaultOpen: true,
    items: [
      { name: "All Packages", href: "/packages", icon: Box },
      { name: "Active Reviews", href: "/packages/active", icon: ListChecks },
      { name: "Needs Review", href: "/packages/needs-review", icon: Inbox },
      { name: "Approved", href: "/packages/approved", icon: ShieldCheck },
      { name: "Rejected", href: "/packages/rejected", icon: AlertTriangle },
      { name: "Archived", href: "/packages/archived", icon: History },
    ],
  },
  {
    id: "review-operations",
    label: "Review Operations",
    defaultOpen: true,
    items: [
      { name: "High Risk Queue", href: "/queue/high-risk", icon: AlertTriangle },
      { name: "Assigned Reviews", href: "/queue/assigned", icon: ClipboardList },
      { name: "Bulk Review", href: "/bulk", icon: Layers },
      { name: "Fast Review", href: "/fast-review", icon: Zap },
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
          { name: "Internal SOP", href: "/regulatory/sop", icon: BookOpen },
          { name: "Regulatory Sources", href: "/regulatory/sources", icon: ShieldCheck },
          { name: "Regulatory Updates", href: "/regulatory-updates", icon: Radio },
          { name: "FDA Recalls", href: "/regulatory/recalls", icon: ShieldAlert },
        ],
      },
    ],
  },
  {
    id: "partners",
    label: "Suppliers",
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
      { name: "Team Directory", href: "/operations/specialists", icon: UserRound },
      { name: "Departments", href: "/operations/departments", icon: Building2 },
      { name: "Routing Rules", href: "/operations/routing-rules", icon: Network },
      { name: "Escalation Matrix", href: "/operations/escalation", icon: TrendingUp },
      { name: "Review Stages", href: "/operations/review-stages", icon: WorkflowIcon },
      { name: "Specialist Workload", href: "/operations/specialist-workload", icon: Gauge },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    // System administration; collapsed by default.
    defaultOpen: false,
    items: [
      {
        group: "Monitoring",
        items: [
          { name: "Admin Overview", href: "/admin/dashboard", icon: LayoutDashboard },
          { name: "Activity Monitor", href: "/admin/activity", icon: Activity },
          { name: "Queue & Health", href: "/operations/system", icon: Activity },
        ],
      },
      {
        group: "Analytics",
        items: [
          { name: "Usage Analytics", href: "/admin/usage", icon: LineChart },
          { name: "AI Cost & Usage", href: "/admin/ai-usage", icon: DollarSign },
        ],
      },
      {
        group: "AI & Integrations",
        items: [
          { name: "Integrations", href: "/admin/integrations", icon: Plug },
          { name: "AI Gateway (MCP)", href: "/admin/mcp", icon: Plug },
        ],
      },
      {
        group: "Security & Governance",
        items: [
          { name: "Security Posture", href: "/admin/security", icon: ShieldCheck },
          { name: "Policy Management", href: "/admin/policies", icon: ScrollText },
          { name: "Audit Center", href: "/operations/audit", icon: History },
        ],
      },
      {
        group: "People & Access",
        items: [
          { name: "User Management", href: "/operations/users", icon: Users },
          { name: "Roles & Permissions", href: "/operations/roles", icon: ShieldCheck },
        ],
      },
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
const NAV_STATE_KEY = "compliance-nav-sections-v2"

function loadSectionState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(NAV_STATE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

// Short, plain-language descriptions for each navigation tool, keyed by href.
// Shown as a hover tooltip on the sidebar row so users understand what a tool
// does before clicking. Keep each to one concise sentence.
const NAV_DESC: Record<string, string> = {
  "/my-dashboard": "Your personal overview of reviews, tasks, and recent activity.",
  "/reviews": "Reviews currently assigned to you.",
  "/my-work": "Your open tasks and follow-ups.",
  "/notifications": "Alerts, mentions, and updates for you.",
  "/": "Team-wide compliance dashboard and key metrics.",
  "/upload": "Upload artwork to start a new package review.",
  "/ai-workspace": "AI-native workspace: specialists, memory, and context-aware chat.",
  "/queue/high-risk": "Packages flagged high risk, prioritized for review.",
  "/queue/assigned": "All reviews assigned across the team.",
  "/bulk": "Review many packages at once.",
  "/fast-review": "Streamlined single-pass review for quick approvals.",
  "/packages": "Every package in the system.",
  "/packages/active": "Packages currently under review.",
  "/packages/approved": "Packages that have passed review.",
  "/packages/rejected": "Packages that failed review.",
  "/packages/archived": "Retired packages kept for reference.",
  "/ai/violations": "Compliance violations the AI detected across packages.",
  "/ai/claims": "Marketing claim audits against the regulations that govern them.",
  "/ai/language": "AI copy review — spelling, grammar, and wording.",
  "/ai/fixes": "AI-suggested corrections for open findings.",
  "/ai/heatmaps": "Visual maps of where issues cluster on artwork.",
  "/ai/memory": "Institutional knowledge the AI recalls across reviews.",
  "/regulations": "Searchable library of federal and agency regulations.",
  "/regulatory/sop": "Internal standard operating procedures.",
  "/regulatory/sources": "Trusted regulatory data sources and their status.",
  "/regulatory-updates": "Recent changes to rules and regulations.",
  "/regulatory/recalls": "Latest FDA recalls and enforcement actions.",
  "/suppliers": "Directory of all vendors and suppliers.",
  "/suppliers/scorecards": "Compliance performance scores by vendor.",
  "/suppliers/portal": "The submission portal your suppliers use.",
  "/resources": "Central hub for references, guides, and standards.",
  "/resources/policies": "Internal policies and standards.",
  "/resources/sop": "SOP documents with full version history.",
  "/resources/glossary": "Approved wording and terminology.",
  "/reports": "Compliance reports and summaries.",
  "/reports/executive": "High-level reports for leadership.",
  "/reports/trends": "Trends and patterns over time.",
  "/operations/teams": "Overview of team activity and capacity.",
  "/admin/queue": "Assign and route reviews to the team.",
  "/operations/workload": "Workload balance and SLA tracking.",
  "/admin/dashboard": "System-wide administration overview.",
  "/admin/activity": "Live activity across the platform.",
  "/admin/usage": "Platform usage analytics.",
  "/admin/ai-usage": "AI call volume and cost tracking.",
  "/admin/integrations": "Connected AI providers and services.",
  "/admin/mcp": "Access tokens and audit ledger for external AI agents.",
  "/admin/security": "Security controls, audit history, and live checks.",
  "/admin/policies": "Create and manage internal policies.",
  "/operations/users": "Manage user accounts.",
  "/operations/roles": "Roles and permission settings.",
  "/operations/audit": "Full audit trail of every change.",
  "/operations/system": "Background job queue and system health.",
  "/admin": "Application settings.",
  "/training/getting-started": "Quick-start guide for new users.",
  "/training/user-guide": "The complete product reference.",
  "/training/walkthroughs": "Interactive, guided product tours.",
  "/training/videos": "Video tutorials.",
  "/training/best-practices": "Recommended ways to work.",
  "/training/academy": "Structured compliance courses.",
  "/training/faq": "Answers to common questions.",
  "/training/release-notes": "What's new, improved, and fixed.",
  "/training/glossary": "Platform terms and definitions.",
  "/training/support": "Contact support for help.",
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
        active ? "bg-muted border-muted-foreground/50" : "border-transparent hover:bg-accent",
      )}
    >
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-3 pl-3 pr-1 py-2.5 text-sm",
                active
                  ? "text-foreground font-semibold"
                  : "text-foreground group-hover/navrow:text-foreground",
              )}
            >
              <Icon className={cn("w-4 h-4 shrink-0", active && "text-foreground")} />
              <span className="truncate">{item.name}</span>
            </Link>
          </TooltipTrigger>
          {NAV_DESC[item.href] && (
            <TooltipContent side="right" className="max-w-xs border border-neutral-700 bg-neutral-900 text-neutral-100">
              {NAV_DESC[item.href]}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
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
// Compliance). Defaults open. An explicit user toggle always wins — even when
// the group contains the active page — so a group can never get "stuck open";
// in that collapsed-but-active case a dot marker flags the hidden location.
// Open/closed state is persisted by the parent via the shared overrides map,
// keyed "<sectionId>:<groupLabel>".
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
  const isOpen = open ?? true
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
            groupActive ? "text-foreground" : "text-foreground",
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
    <nav
      // Left-nav font: solid black in light mode (instead of the dark-navy
      // foreground), and white in dark mode. The dark-scoped "My Work" block
      // resets --foreground to white regardless, so it always stays legible.
      className="flex-1 overflow-y-auto py-4 px-3 [--foreground:0_0%_0%] dark:[--foreground:0_0%_98%]"
    >
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
        // Give the "My Work" section a soft Dollar Tree green backing so it
        // visually breaks up the long navigation list.
        const isMyWork = section.id === "my-work"
        return (
          <React.Fragment key={section.id}>
            {section.id === "home" && (
              <div className="mt-2 mb-1">
                <PoweredByAi className="w-full justify-center" />
              </div>
            )}
          <div
            data-tour={`nav-${section.id}`}
            className={cn(
              idx > 0 && !isMyWork && section.id !== "home" && "mt-3 border-t border-border/60 pt-3",
              section.id === "home" && "mt-2",
              // Black backing with white text for the "My Work" section: scope
              // this block to the app's dark palette so all descendant text,
              // icons, hover and active states flip to light-on-dark coherently,
              // then force a true-black background.
              isMyWork && "dark mt-0 rounded-lg bg-black border border-white/15 px-1 py-1.5",
            )}
            // Recolor the hover/active fills in this block to Dollar Tree green
            // (the dark palette's --accent/--muted are blue-slate). --accent is
            // the hover fill, --muted the active/selected fill; both keep white
            // text legible. Covers the section header and each nav row.
            style={
              isMyWork
                ? ({
                    "--accent": "142 70% 27%",
                    "--muted": "142 72% 33%",
                  } as React.CSSProperties)
                : undefined
            }
          >
            <button
              type="button"
              onClick={() => toggle(section)}
              aria-expanded={open}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 rounded-md text-left group transition-colors",
                // "My Work" header stays permanently in its green hover state.
                isMyWork ? "bg-accent/50" : "hover:bg-accent/50",
              )}
            >
              <span
                className={cn(
                  "flex-1 text-[11px] font-semibold uppercase tracking-wider",
                  sectionActive ? "text-foreground" : "text-foreground",
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
          {/* Favorites populate directly under Home, ahead of the Packages
              section — not hoisted to the very top of the navigation. */}
          {section.id === "home" && favoriteItems.length > 0 && (
            <div className="mt-3 border-t border-border/60 pt-3">
              <div className="flex items-center gap-2 px-3 py-2">
                <Star className="w-3.5 h-3.5 shrink-0 text-amber-500 fill-amber-500" aria-hidden />
                <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-foreground">
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
          </React.Fragment>
        )
      })}
    </nav>
  )
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 tracking-tight min-w-0 pr-5">
      <span className="flex items-center justify-center rounded-md bg-white p-1 ring-1 ring-black/5 shrink-0">
        <img
          src={`${import.meta.env.BASE_URL}dollar-tree-logo.png`}
          alt="Dollar Tree"
          className="h-8 w-auto object-contain"
        />
      </span>
      <span className="flex flex-col justify-center gap-0.5 leading-none border-l border-border pl-3 shrink-0">
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="text-base font-bold text-foreground">Compliance AI</span>
          <span className="inline-flex shrink-0 items-center rounded-sm bg-green-600 px-1 py-[1.5px] text-[7px] font-semibold uppercase leading-none tracking-normal text-white ring-1 ring-inset ring-green-700/40">
            Beta
          </span>
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap">
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
        // Preserve sub-groups so large menus render as scannable categories
        // with dividers instead of one long flat list.
        entries: s.items
          .map((e) =>
            isGroup(e) ? { ...e, items: e.items.filter((i) => canSee(i.href)) } : e,
          )
          .filter((e) => (isGroup(e) ? e.items.length > 0 : canSee(e.href))),
      }))
      .filter((s) => flattenEntries(s.entries).length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [has])

  if (sections.length === 0) return null

  return (
    <nav className="hidden md:flex items-center gap-1" aria-label="Sections">
      {sections.map((section) => {
        const active = flattenEntries(section.entries).some((i) =>
          isItemActive(location, i.href),
        )
        const renderItem = (item: NavItem) => {
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
        }
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
              {section.entries.map((entry, i) =>
                isGroup(entry) ? (
                  <React.Fragment key={entry.group}>
                    {i > 0 && <DropdownMenuSeparator className="opacity-60" />}
                    <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                      {entry.group}
                    </div>
                    {entry.items.map(renderItem)}
                  </React.Fragment>
                ) : (
                  <React.Fragment key={entry.href}>
                    {i > 0 && <DropdownMenuSeparator className="opacity-60" />}
                    {renderItem(entry)}
                  </React.Fragment>
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      })}
    </nav>
  )
}

// Suggested "quick finds" surfaced under the global search when it is focused.
// Each navigates straight to the real destination page (never a filtered
// package search that might come back empty).
const QUICK_FINDS = [
  { label: "Critical violations", href: "/ai/violations", icon: Activity },
  { label: "Pending review", href: "/packages/needs-review", icon: Compass },
  { label: "Approved packages", href: "/packages/approved", icon: Star },
  { label: "High risk queue", href: "/queue/high-risk", icon: TrendingUp },
  { label: "All packages", href: "/packages", icon: ScrollText },
] as const

// Extra search keywords per destination, so natural terms ("critical",
// "chart", "graph", "sla", ...) surface the right tool even when the word
// isn't in its name or description. Lowercase, space-separated.
const NAV_KEYWORDS: Record<string, string> = {
  "/ai/violations": "critical severity findings issues errors",
  "/ai/claims": "claims audit marketing",
  "/ai/language": "copy text wording labels",
  "/ai/fixes": "corrections remediation suggestions",
  "/ai/heatmaps": "chart graph visual clusters",
  "/ai/memory": "history past learnings",
  "/queue/high-risk": "critical risky urgent priority",
  "/reports": "compliance documents exports pdf",
  "/reports/executive": "summary leadership chart graph",
  "/reports/trends": "chart graph analytics trends over time",
  "/suppliers/scorecards": "vendor ratings chart graph performance",
  "/operations/workload": "sla capacity chart graph",
  "/operations/specialist-workload": "sla capacity balance",
  "/admin/usage": "analytics metrics chart graph",
  "/admin/ai-usage": "cost spend tokens billing chart",
  "/admin/activity": "logs monitor live events",
  "/operations/audit": "audit trail history log",
  "/packages/needs-review": "pending waiting queue",
  "/packages/approved": "passed compliant done",
  "/packages/rejected": "failed non-compliant",
  "/regulations": "cfr fda usda ftc law rules",
  "/regulatory/recalls": "fda recall alerts safety",
  "/resources/glossary": "approved language terms wording",
  "/training/glossary": "definitions terms platform",
}

// Global tool search: match every nav destination the user can access by name,
// section label, and plain-language description, so typing "critical",
// "chart", "trend", a tool name, etc. surfaces the right page directly.
function useToolMatches(query: string) {
  const { has } = usePermissions()
  return React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const terms = q.split(/\s+/).filter(Boolean)
    const results: { item: NavItem; section: string; score: number }[] = []
    const seen = new Set<string>()
    for (const section of SECTIONS) {
      for (const item of flattenEntries(section.items)) {
        if (seen.has(item.href)) continue
        const perm = requiredPermFor(item.href)
        if (perm !== null && !has(perm)) continue
        const name = item.name.toLowerCase()
        const desc = (NAV_DESC[item.href] ?? "").toLowerCase()
        const sectionLabel = section.label.toLowerCase()
        const haystack = `${name} ${desc} ${sectionLabel} ${NAV_KEYWORDS[item.href] ?? ""}`
        if (!terms.every((t) => haystack.includes(t))) continue
        seen.add(item.href)
        // Rank: name prefix > name substring > description/section match.
        const score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2
        results.push({ item, section: section.label, score })
      }
    }
    results.sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
    return results.slice(0, 7)
  }, [query, has])
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useTheme()
  const [, navigate] = useLocation()
  const { data: notifications = [] } = useListNotifications()
  const { me } = usePermissions()
  const canSeePresence = !!me && me.roleKey !== "supplier_user"
  const { data: presence } = useGetReviewPresence({
    query: {
      enabled: canSeePresence,
      refetchInterval: canSeePresence ? 10_000 : false,
      queryKey: getGetReviewPresenceQueryKey(),
    },
  })
  const onlineCount = presence?.length ?? 0
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [assistantOpen, setAssistantOpen] = React.useState(false)
  const [q, setQ] = React.useState("")
  const [searchOpen, setSearchOpen] = React.useState(false)
  const searchRef = React.useRef<HTMLDivElement>(null)
  const unreadCount = notifications.filter((n) => !n.read && !n.archived).length

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark")

  // Close the quick-finds dropdown when clicking outside the search box.
  React.useEffect(() => {
    if (!searchOpen) return
    const onDown = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [searchOpen])

  // Debounce the query so autocomplete only fires after the user pauses typing.
  const [debouncedQ, setDebouncedQ] = React.useState("")
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 200)
    return () => clearTimeout(t)
  }, [q])
  const { data: searchMatches = [], isFetching: searchFetching } = useListPackages(
    { search: debouncedQ },
    {
      query: {
        enabled: searchOpen && debouncedQ.length >= 2,
        queryKey: getListPackagesQueryKey({ search: debouncedQ }),
      },
    },
  )
  const suggestions = searchMatches.slice(0, 6)
  const toolMatches = useToolMatches(debouncedQ)

  const runSearch = (term: string) => {
    setQ(term)
    setSearchOpen(false)
    navigate(`/packages${term.trim() ? `?q=${encodeURIComponent(term.trim())}` : ""}`)
  }

  const openPackage = (id: number | string) => {
    setSearchOpen(false)
    navigate(`/reviews/${id}`)
  }

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    runSearch(q)
  }

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Main app column — shrinks as the AI assistant panel slides in from the
          right, producing a split-screen rather than an overlay. */}
      <div className="flex flex-1 min-w-0 bg-background overflow-hidden flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside data-tour="sidebar" className="hidden md:flex flex-col w-64 border-r border-border bg-card">
        <div className="h-16 flex items-center px-4 border-b border-border bg-card">
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

            <div ref={searchRef} className="hidden sm:block relative w-full max-w-md">
              <form onSubmit={submitSearch} className="relative">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none z-10" />
                <input
                  type="text"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onFocus={() => setSearchOpen(true)}
                  placeholder="Search packages, SKU, vendor..."
                  className="w-full h-9 rounded-md bg-black border border-neutral-700 pl-9 pr-4 text-sm text-white placeholder:text-white focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-neutral-500 transition-all"
                  // Chamfer the bottom-right corner for a "folded page" look.
                  style={{
                    clipPath:
                      "polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)",
                  }}
                />
              </form>
              {searchOpen && (
                <div className="absolute left-0 right-0 top-full mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-popover shadow-lg z-50">
                  {q.trim() && (
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        runSearch(q.trim())
                      }}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-left hover:bg-accent border-b border-border"
                    >
                      <Search className="w-4 h-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">
                        Search for <span className="font-semibold">"{q.trim()}"</span>
                      </span>
                    </button>
                  )}
                  {q.trim() && toolMatches.length > 0 && (
                    // Tools, charts, and pages whose name or description match.
                    <div className="py-1 border-b border-border">
                      <p className="px-3.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Tools & Pages
                      </p>
                      {toolMatches.map(({ item, section }) => {
                        const Icon = item.icon
                        return (
                          <button
                            key={item.href}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              setSearchOpen(false)
                              navigate(item.href)
                            }}
                            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left hover:bg-accent"
                          >
                            <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                            <span className="flex min-w-0 flex-col leading-tight">
                              <span className="truncate font-medium">{item.name}</span>
                              <span className="truncate text-xs text-muted-foreground">
                                {NAV_DESC[item.href] ?? section}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {q.trim() ? (
                    // Live autocomplete: matching packages as you type.
                    suggestions.length > 0 ? (
                      <div className="py-1">
                        <p className="px-3.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Packages
                        </p>
                        {suggestions.map((pkg) => (
                          <button
                            key={pkg.id}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              openPackage(pkg.id)
                            }}
                            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left hover:bg-accent"
                          >
                            <Box className="w-4 h-4 shrink-0 text-muted-foreground" />
                            <span className="flex min-w-0 flex-col leading-tight">
                              <span className="truncate font-medium">{pkg.name}</span>
                              <span className="truncate text-xs text-muted-foreground">
                                {[pkg.sku, pkg.vendor].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : debouncedQ.length >= 2 && !searchFetching ? (
                      toolMatches.length === 0 ? (
                        <p className="px-3.5 py-3 text-sm text-muted-foreground">
                          No tools or packages match "{q.trim()}"
                        </p>
                      ) : null
                    ) : (
                      <p className="px-3.5 py-3 text-sm text-muted-foreground">Searching…</p>
                    )
                  ) : (
                    <>
                      <p className="px-3.5 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Suggested quick finds
                      </p>
                      <div className="pb-1.5">
                        {QUICK_FINDS.map((f) => {
                          const Icon = f.icon
                          return (
                            <button
                              key={f.label}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault()
                                setSearchOpen(false)
                                navigate(f.href)
                              }}
                              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left hover:bg-accent"
                            >
                              <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                              {f.label}
                            </button>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <TopNavMenus />
          </div>
          <div className="flex items-center gap-2">
            {canSeePresence && onlineCount > 0 && (
              <div
                className="hidden lg:flex items-center mr-1"
                title={`${onlineCount} reviewer${onlineCount === 1 ? "" : "s"} online`}
              >
                <PresenceStrip presence={presence} max={5} />
              </div>
            )}
            <Link href="/upload">
              <Button size="sm" className="hidden sm:flex gap-2">
                <Upload className="w-4 h-4" />
                New Package
              </Button>
            </Link>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAssistantOpen((v) => !v)}
              aria-pressed={assistantOpen}
              data-tour="ai-assistant"
              className="pba-rainbow-dark hidden sm:flex gap-2 px-3 text-white hover:text-white"
            >
              <Sparkles className="w-4 h-4" />
              Ask AI
            </Button>
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
      {/* Hidden while the assistant panel is open — the badge sits over the
          panel's send button otherwise. */}
      {!assistantOpen && <BuilderBadge />}
      </div>
      <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
    </div>
  )
}
