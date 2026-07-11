import * as React from "react"
import type { LanguageReviewDetail } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Languages,
  Loader2,
  CheckCircle,
  BookOpen,
  History,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"

function scoreColor(score: number | null | undefined): string {
  if (score == null) return "text-muted-foreground"
  if (score >= 90) return "text-success"
  if (score >= 80) return "text-warning"
  return "text-destructive"
}

function scoreBand(score: number | null | undefined): string {
  if (score == null) return "Not reviewed"
  if (score >= 100) return "Excellent"
  if (score >= 90) return "Minor issues"
  if (score >= 80) return "Needs review"
  if (score >= 70) return "Significant issues"
  return "High risk"
}

function issueBadgeVariant(t: string): "secondary" | "destructive" | "warning" {
  if (t === "Regulatory") return "destructive"
  if (t === "Marketing Claim") return "warning"
  return "secondary"
}

const TYPE_KEYS = [
  ["Spelling", "spellingCount"],
  ["Grammar", "grammarCount"],
  ["Context", "contextCount"],
  ["Regulatory", "regulatoryCount"],
  ["Marketing Claim", "marketingCount"],
  ["Brand Language", "brandCount"],
] as const

export function LanguageReviewTab({
  detail,
  onRun,
  isRunning,
}: {
  detail: LanguageReviewDetail | undefined
  onRun: () => void
  isRunning: boolean
}) {
  const review = detail?.review ?? null
  const findings = detail?.findings ?? []
  const [typeFilter, setTypeFilter] = React.useState<string | null>(null)

  // Drop the active filter if the currently selected type no longer has findings
  // (e.g. after a re-run produces a different set of issues).
  React.useEffect(() => {
    if (typeFilter && !findings.some((f) => f.issueType === typeFilter)) {
      setTypeFilter(null)
    }
  }, [typeFilter, findings])

  const shownFindings = typeFilter
    ? findings.filter((f) => f.issueType === typeFilter)
    : findings

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Language Quality</p>
            <div className={`text-4xl font-black mt-1 ${scoreColor(review?.score)}`}>
              {review ? review.score : "-"}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{scoreBand(review?.score)}</p>
          </div>
          {review && (
            <div className="flex gap-2">
              <div className="text-center px-3 py-1 bg-destructive/10 rounded-md border border-destructive/20">
                <div className="text-lg font-bold text-destructive">{review.criticalCount}</div>
                <div className="text-[10px] text-destructive uppercase">Critical</div>
              </div>
              <div className="text-center px-3 py-1 bg-warning/10 rounded-md border border-warning/20">
                <div className="text-lg font-bold text-warning">{review.majorCount}</div>
                <div className="text-[10px] text-warning uppercase">Major</div>
              </div>
              <div className="text-center px-3 py-1 bg-muted rounded-md border border-border">
                <div className="text-lg font-bold">{review.minorCount}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Minor</div>
              </div>
            </div>
          )}
        </div>
        <Button onClick={onRun} disabled={isRunning} className="gap-2">
          {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}
          {review ? "Re-run Language Review" : "Run Language Review"}
        </Button>
      </div>

      {review?.confidence != null && (
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Engine confidence</span>
            <span>{Math.round(review.confidence * 100)}%</span>
          </div>
          <Progress value={review.confidence * 100} className="h-1.5" />
        </div>
      )}

      {review?.summary && (
        <p className="text-sm text-foreground/80 bg-accent/40 border border-border rounded-lg p-3">{review.summary}</p>
      )}

      {review && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {TYPE_KEYS.map(([label, key]) => {
            const count = (review[key] as number) ?? 0
            const active = typeFilter === label
            const disabled = count === 0
            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                title={disabled ? `No ${label} findings` : active ? "Clear filter" : `Show only ${label} findings`}
                onClick={() => setTypeFilter(active ? null : label)}
                className={cn(
                  "flex items-center justify-between px-3 py-2 border rounded-md text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  disabled
                    ? "bg-muted/40 border-border opacity-60 cursor-default"
                    : "bg-card border-border hover:border-primary/50 cursor-pointer",
                  active && "border-primary ring-1 ring-primary bg-primary/5",
                )}
              >
                <span className={cn("text-xs", active ? "text-primary font-medium" : "text-muted-foreground")}>{label}</span>
                <span className={cn("text-sm font-bold", active && "text-primary")}>{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {!review ? (
        <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
          <Languages className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>No language review yet.</p>
          <p className="text-sm mt-1">Run the AI Language Review Engine to analyze this package's copy.</p>
        </div>
      ) : findings.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <CheckCircle className="w-12 h-12 mx-auto mb-3 text-success opacity-50" />
          <p>No language issues detected.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {typeFilter && (
            <div className="flex items-center justify-between gap-2 text-xs bg-primary/5 border border-primary/20 rounded-md px-3 py-1.5">
              <span className="text-primary font-medium">
                Showing {shownFindings.length} {typeFilter} finding{shownFindings.length === 1 ? "" : "s"}
              </span>
              <Button size="sm" variant="ghost" className="h-6 gap-1 text-xs" onClick={() => setTypeFilter(null)}>
                <X className="w-3.5 h-3.5" /> Clear
              </Button>
            </div>
          )}
          {shownFindings.map((f) => {
            const orig = f.originalText?.trim() ?? ""
            const sugg = f.suggestedText?.trim() ?? ""
            const hasDiff = orig !== "" && sugg !== "" && orig !== sugg
            const observed = f.originalText || f.suggestedText
            return (
              <div key={f.id} className="p-4 rounded-lg border border-border bg-card space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Badge variant={issueBadgeVariant(f.issueType)}>{f.issueType}</Badge>
                    <Badge variant="outline" className="text-[10px] uppercase">{f.severity}</Badge>
                  </div>
                  {f.issueType === "Marketing Claim" && f.claimRiskScore != null && (
                    <span className="text-xs text-muted-foreground">Claim risk <span className="font-bold text-warning">{f.claimRiskScore}</span></span>
                  )}
                </div>
                {f.reason && <p className="text-sm text-foreground/80">{f.reason}</p>}
                {hasDiff ? (
                  <div className="text-sm font-mono bg-background rounded border border-border p-2">
                    <span className="text-destructive line-through mr-2">{f.originalText}</span>
                    <span className="text-success">{f.suggestedText}</span>
                  </div>
                ) : observed ? (
                  <div className="text-sm font-mono bg-background rounded border border-border p-2 text-foreground/80">
                    {observed}
                  </div>
                ) : null}
                {f.issueType === "Marketing Claim" && f.reviewFlags && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">Requires review:</span>
                    {(["fda", "epa", "ftc", "legal"] as const)
                      .filter((k) => f.reviewFlags?.[k])
                      .map((k) => (
                        <Badge key={k} variant="outline" className="uppercase">{k}</Badge>
                      ))}
                  </div>
                )}
                {f.historicalUsage > 0 && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" />
                    Applied in {f.historicalUsage.toLocaleString()} approved review{f.historicalUsage === 1 ? "" : "s"}
                  </p>
                )}
                {f.regulationReference && (
                  <div className="text-xs font-mono text-muted-foreground flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5" /> {f.regulationReference}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
