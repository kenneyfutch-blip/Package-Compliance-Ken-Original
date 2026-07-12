import * as React from "react"
import type { ClaimsAnalysisDetail } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  BadgeCheck,
  Loader2,
  CheckCircle,
  BookOpen,
  Landmark,
  Wrench,
  ArrowUpCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"

type RiskLevel = "Low" | "Medium" | "High" | "Critical"

const RISK_ORDER: RiskLevel[] = ["Critical", "High", "Medium", "Low"]

function riskBadgeClasses(risk: string): string {
  switch (risk) {
    case "Critical":
      return "bg-destructive text-destructive-foreground border-transparent"
    case "High":
      return "bg-destructive/15 text-destructive border-destructive/30"
    case "Medium":
      return "bg-warning/15 text-warning border-warning/30"
    default:
      return "bg-muted text-muted-foreground border-border"
  }
}

const COUNT_KEYS: ReadonlyArray<[RiskLevel, "criticalCount" | "highCount" | "mediumCount" | "lowCount"]> = [
  ["Critical", "criticalCount"],
  ["High", "highCount"],
  ["Medium", "mediumCount"],
  ["Low", "lowCount"],
]

export function ClaimsComplianceTab({
  detail,
  onRun,
  isRunning,
}: {
  detail: ClaimsAnalysisDetail | undefined
  onRun: () => void
  isRunning: boolean
}) {
  const analysis = detail?.analysis ?? null
  const findings = detail?.findings ?? []
  const [riskFilter, setRiskFilter] = React.useState<RiskLevel | null>(null)

  React.useEffect(() => {
    if (riskFilter && !findings.some((f) => f.riskLevel === riskFilter)) {
      setRiskFilter(null)
    }
  }, [riskFilter, findings])

  const shownFindings = (
    riskFilter ? findings.filter((f) => f.riskLevel === riskFilter) : findings
  )
    .slice()
    .sort(
      (a, b) =>
        RISK_ORDER.indexOf(a.riskLevel as RiskLevel) -
        RISK_ORDER.indexOf(b.riskLevel as RiskLevel),
    )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
              Claims Audited
            </p>
            <div className="text-4xl font-black mt-1">
              {analysis ? analysis.claimsFound : "-"}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {analysis
                ? analysis.highestRisk
                  ? `Highest risk: ${analysis.highestRisk}`
                  : "No claims detected"
                : "Not analyzed"}
            </p>
          </div>
          {analysis && analysis.claimsFound > 0 && (
            <div className="flex gap-2">
              <div className="text-center px-3 py-1 bg-destructive/10 rounded-md border border-destructive/20">
                <div className="text-lg font-bold text-destructive">
                  {analysis.criticalCount + analysis.highCount}
                </div>
                <div className="text-[10px] text-destructive uppercase">
                  High / Critical
                </div>
              </div>
              <div className="text-center px-3 py-1 bg-warning/10 rounded-md border border-warning/20">
                <div className="text-lg font-bold text-warning">
                  {analysis.mediumCount}
                </div>
                <div className="text-[10px] text-warning uppercase">Medium</div>
              </div>
              <div className="text-center px-3 py-1 bg-muted rounded-md border border-border">
                <div className="text-lg font-bold">{analysis.lowCount}</div>
                <div className="text-[10px] text-muted-foreground uppercase">
                  Low
                </div>
              </div>
            </div>
          )}
        </div>
        <Button onClick={onRun} disabled={isRunning} className="gap-2">
          {isRunning ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <BadgeCheck className="w-4 h-4" />
          )}
          {analysis ? "Re-run Claims Audit" : "Run Claims Audit"}
        </Button>
      </div>

      {analysis?.escalated && (
        <div className="flex items-center gap-2 text-xs bg-primary/5 border border-primary/20 rounded-md px-3 py-2 text-primary">
          <ArrowUpCircle className="h-4 w-4 shrink-0" />
          <span>
            High/Critical claims detected — escalated to the reasoning tier (Sol)
            {analysis.model ? ` · ${analysis.model}` : ""} for a deeper review.
          </span>
        </div>
      )}

      {analysis?.confidence != null && (
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Engine confidence</span>
            <span>{Math.round(analysis.confidence * 100)}%</span>
          </div>
          <Progress value={analysis.confidence * 100} className="h-1.5" />
        </div>
      )}

      {analysis?.summary && (
        <p className="text-sm text-foreground/80 bg-accent/40 border border-border rounded-lg p-3">
          {analysis.summary}
        </p>
      )}

      {analysis && analysis.claimsFound > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {COUNT_KEYS.map(([label, key]) => {
            const count = (analysis[key] as number) ?? 0
            const active = riskFilter === label
            const disabled = count === 0
            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                title={
                  disabled
                    ? `No ${label} claims`
                    : active
                      ? "Clear filter"
                      : `Show only ${label} claims`
                }
                onClick={() => setRiskFilter(active ? null : label)}
                className={cn(
                  "flex items-center justify-between px-3 py-2 border rounded-md text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  disabled
                    ? "bg-muted/40 border-border opacity-60 cursor-default"
                    : "bg-card border-border hover:border-primary/50 cursor-pointer",
                  active && "border-primary ring-1 ring-primary bg-primary/5",
                )}
              >
                <span
                  className={cn(
                    "text-xs",
                    active ? "text-primary font-medium" : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
                <span className={cn("text-sm font-bold", active && "text-primary")}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {!analysis ? (
        <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
          <BadgeCheck className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>No claims audit yet.</p>
          <p className="text-sm mt-1">
            Run the AI Claims Compliance Engine to audit every marketing and
            label claim on this package.
          </p>
        </div>
      ) : findings.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <CheckCircle className="w-12 h-12 mx-auto mb-3 text-success opacity-50" />
          <p>No regulated claims detected on this package.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {shownFindings.map((f) => (
            <div
              key={f.id}
              className="p-4 rounded-lg border border-border bg-card space-y-2"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{f.claimType}</Badge>
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] uppercase", riskBadgeClasses(f.riskLevel))}
                  >
                    {f.riskLevel}
                  </Badge>
                  {f.escalated && (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <ArrowUpCircle className="h-3 w-3" /> Sol
                    </Badge>
                  )}
                </div>
                {f.confidence != null && (
                  <span className="text-xs text-muted-foreground">
                    Confidence{" "}
                    <span className="font-bold text-foreground">{f.confidence}</span>
                  </span>
                )}
              </div>

              {f.claimText && (
                <div className="text-sm font-mono bg-background rounded border border-border p-2 text-foreground/80">
                  "{f.claimText}"
                </div>
              )}

              {f.jurisdiction && (
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Landmark className="w-3.5 h-3.5" /> Jurisdiction:{" "}
                  <span className="font-medium text-foreground/80">
                    {f.jurisdiction}
                  </span>
                </div>
              )}

              {f.remediation && (
                <div className="text-sm text-foreground/80 flex items-start gap-1.5">
                  <Wrench className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                  <span>{f.remediation}</span>
                </div>
              )}

              {f.regulationReference && (
                <div className="text-xs font-mono text-muted-foreground flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5" /> {f.regulationReference}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
