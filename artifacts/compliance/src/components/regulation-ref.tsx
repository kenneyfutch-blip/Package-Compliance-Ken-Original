import { useMemo, useState } from "react"
import { useLocation } from "wouter"
import { useListRegulations } from "@workspace/api-client-react"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { BookOpen, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"

// Slugs used by the /regulatory/:agency library routes (see REG_LIBS in App.tsx).
const AGENCY_SLUG: Record<string, string> = {
  fda: "fda",
  epa: "epa",
  cpsc: "cpsc",
  ftc: "ftc",
  usda: "usda",
  internal: "sop",
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function librarySlug(agency: string): string {
  const a = agency.toLowerCase()
  if (AGENCY_SLUG[a]) return AGENCY_SLUG[a]
  if (/internal|sop|dollar|brand/.test(a)) return "sop"
  return a
}

interface Reg {
  id: number
  ruleCode: string
  title: string
  summary: string
  regulationText?: string | null
  section?: string | null
  source?: string | null
  agency: string
  category?: string
}

interface Props {
  /** The rule reference cited on a finding, e.g. "21 CFR 101.9". */
  refText: string
  /** Show a small book icon before the reference. */
  icon?: boolean
  className?: string
}

/**
 * Renders a finding's cited regulation reference. When the reference resolves to
 * a rule in the regulatory library, it becomes an interactive chip: click to
 * preview the rule inline (summary + text + source) with a button to open the
 * full library page scrolled to that rule. If the AI cited something not in the
 * library, it degrades gracefully to plain text (no broken link).
 */
export function RegulationRef({ refText, icon = false, className }: Props) {
  const { data: regs = [] } = useListRegulations({})
  const [, navigate] = useLocation()
  const [open, setOpen] = useState(false)

  const match = useMemo(() => {
    const target = norm(refText)
    if (target.length < 3) return null
    // Rank candidates by tier (exact > reference-contains-code > code-contains
    // -reference), then by longest code, then lowest id for a stable result.
    // The reverse direction is only allowed for a sufficiently long reference so
    // a short/partial ref like "101" cannot mis-link to an unrelated rule.
    let best: { reg: Reg; tier: number; len: number } | null = null
    for (const r of regs as Reg[]) {
      const code = norm(r.ruleCode)
      if (code.length < 3) continue
      let tier = 0
      if (target === code) tier = 3
      else if (target.includes(code)) tier = 2
      else if (target.length >= 6 && code.includes(target)) tier = 1
      else continue
      if (
        !best ||
        tier > best.tier ||
        (tier === best.tier && code.length > best.len) ||
        (tier === best.tier && code.length === best.len && r.id < best.reg.id)
      ) {
        best = { reg: r, tier, len: code.length }
      }
    }
    return best?.reg ?? null
  }, [regs, refText])

  if (!match) {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        {icon && <BookOpen className="w-3.5 h-3.5 shrink-0" />}
        {refText}
      </span>
    )
  }

  const openLibrary = () => {
    setOpen(false)
    navigate(`/regulatory/${librarySlug(match.agency)}?rule=${match.id}`)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* A span (not a button) so this stays valid HTML when nested inside a
            clickable finding row; stopPropagation prevents selecting the row. */}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              e.stopPropagation()
              setOpen((o) => !o)
            }
          }}
          className={cn(
            "inline-flex items-center gap-1.5 cursor-pointer underline decoration-dotted underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm transition-colors",
            className,
          )}
        >
          {icon && <BookOpen className="w-3.5 h-3.5 shrink-0" />}
          {refText}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 space-y-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="font-mono">
            {match.ruleCode}
          </Badge>
          <Badge variant="secondary">{match.agency}</Badge>
          {match.section && <Badge variant="outline">§ {match.section}</Badge>}
        </div>
        <p className="text-sm font-semibold leading-snug">{match.title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {match.summary}
        </p>
        {match.regulationText && (
          <div className="max-h-40 overflow-auto rounded bg-accent/50 p-2 text-xs leading-relaxed">
            {match.regulationText}
          </div>
        )}
        <Button size="sm" className="w-full gap-1.5" onClick={openLibrary}>
          <ExternalLink className="w-3.5 h-3.5" /> View in library
        </Button>
        {match.source && (
          <a
            href={match.source}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-[11px] text-muted-foreground hover:text-primary"
          >
            Source: {match.source}
          </a>
        )}
      </PopoverContent>
    </Popover>
  )
}
