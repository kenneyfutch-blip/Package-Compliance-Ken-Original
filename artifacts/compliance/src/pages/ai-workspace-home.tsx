import { Link } from "wouter"
import { useGetWorkspaceHome } from "@workspace/api-client-react"
import type { WorkspaceHomeItem, WorkspaceHomeSection } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Sparkles,
  Loader2,
  MessageSquare,
  Star,
  ClipboardList,
  ClipboardCheck,
  FileText,
  Wand2,
  Bot,
  Users,
  ArrowRight,
  ChevronRight,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

// Icon per dashboard section, keyed by the server-provided section key. Falls
// back to a neutral icon for any future section the server adds.
const SECTION_ICON: Record<string, LucideIcon> = {
  recentConversations: MessageSquare,
  savedInvestigations: Star,
  assignedReviews: ClipboardList,
  recentReviews: ClipboardCheck,
  recentReports: FileText,
  suggestedActions: Wand2,
  agentActivity: Bot,
  specialistActivity: Users,
}

// Compact relative timestamp ("3h", "2d"), or a short date for older items.
function shortWhen(iso: string | null | undefined): string {
  if (!iso) return ""
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const diff = Date.now() - then
  const mins = Math.round(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

// Map a status/label badge to a color variant so reviewers can scan outcomes at
// a glance. Positive outcomes are green, terminal failures red, "needs a human"
// amber, and in-flight work blue; anything else (formats, versions, "Saved")
// stays neutral gray.
type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "success"
  | "warning"
function badgeVariantFor(badge: string): BadgeVariant {
  const b = badge.toLowerCase()
  // Check terminal failures before positive outcomes so "non-compliant" isn't
  // captured by the "compliant" success match.
  if (/failed|rejected|non-?compliant|critical|error|blocked/.test(b))
    return "destructive"
  if (/approved|passed|compliant|resolved|complete|done/.test(b)) return "success"
  if (/needs review|escalat|overdue|attention|action|warning/.test(b))
    return "warning"
  if (/ai review|analy|in review|under review|processing/.test(b)) return "default"
  return "secondary"
}

function ItemRow({ item }: { item: WorkspaceHomeItem }) {
  const inner = (
    <div className="flex items-center gap-3 rounded-md px-2 py-2 -mx-2 transition-colors hover:bg-muted/60">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
          {item.badge && (
            <Badge
              variant={badgeVariantFor(item.badge)}
              className="shrink-0 text-[10px]"
            >
              {item.badge}
            </Badge>
          )}
        </div>
        {item.subtitle && (
          <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>
        )}
      </div>
      {item.timestamp && (
        <span className="shrink-0 text-xs text-muted-foreground">{shortWhen(item.timestamp)}</span>
      )}
      {item.href && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </div>
  )
  if (item.href) {
    return (
      <Link href={item.href} className="block">
        {inner}
      </Link>
    )
  }
  return inner
}

function SectionCard({ section, loading }: { section: WorkspaceHomeSection; loading: boolean }) {
  const Icon = SECTION_ICON[section.key] ?? Sparkles
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-primary" />
          {section.title}
        </CardTitle>
        <CardDescription>{section.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : section.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing here yet.</p>
        ) : (
          <div className="space-y-0.5">
            {section.items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Placeholder section list shown while the dashboard loads, so the layout does
// not jump when data arrives.
const LOADING_SECTIONS: WorkspaceHomeSection[] = [
  "recentConversations",
  "savedInvestigations",
  "assignedReviews",
  "recentReviews",
  "recentReports",
  "suggestedActions",
].map((key) => ({ key, title: "", description: "", visible: true, items: [] }))

export default function AiWorkspaceHome() {
  const { data, isLoading } = useGetWorkspaceHome()

  const sections = (data?.sections ?? LOADING_SECTIONS).filter((s) => s.visible)

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Sparkles className="h-7 w-7 text-primary" /> AI Workspace
          </h1>
          <p className="mt-1 text-muted-foreground">
            Your assistant home: pick up recent work, review what needs attention, and start a new conversation.
          </p>
          {data?.provider && (
            <p className="mt-2 text-xs text-muted-foreground">
              Assistant powered by {data.provider.label}
              {data.provider.model && data.provider.model !== "unavailable"
                ? ` (${data.provider.model})`
                : ""}
            </p>
          )}
        </div>
        <Link href="/ai-workspace">
          <Button className="gap-2">
            <MessageSquare className="h-4 w-4" /> Open Assistant <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((section, i) => (
          <SectionCard
            key={section.key || i}
            section={section}
            loading={isLoading && !data}
          />
        ))}
      </div>
    </div>
  )
}
