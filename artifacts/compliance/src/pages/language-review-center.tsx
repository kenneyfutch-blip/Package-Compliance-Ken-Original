import { useState, useMemo } from "react"
import { Link } from "wouter"
import {
  useListLanguageFindings,
  useUpdateLanguageFinding,
} from "@workspace/api-client-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Search,
  Loader2,
  ArrowRight,
  Copy,
  Check,
  BookOpen,
  Languages,
  CheckCircle,
  XCircle,
  History,
} from "lucide-react"
import { severityMeta, hasDistinctFix } from "@/lib/compliance"

const ISSUE_TYPES = [
  "Spelling",
  "Grammar",
  "Context",
  "Regulatory",
  "Marketing Claim",
  "Brand Language",
] as const

function issueBadgeVariant(t: string): "default" | "secondary" | "outline" | "destructive" | "warning" {
  if (t === "Regulatory") return "destructive"
  if (t === "Marketing Claim") return "warning"
  return "secondary"
}

function scoreColor(score: number | null | undefined): string {
  if (score == null) return "text-muted-foreground"
  if (score >= 90) return "text-success"
  if (score >= 80) return "text-warning"
  return "text-destructive"
}

export default function LanguageReviewCenter() {
  const [search, setSearch] = useState("")
  const [issueType, setIssueType] = useState("all")
  const [severity, setSeverity] = useState("all")
  const [status, setStatus] = useState("all")
  const [copied, setCopied] = useState<number | null>(null)

  const { data: findings = [], isLoading, refetch } = useListLanguageFindings({
    search,
    ...(issueType !== "all" ? { issueType } : {}),
    ...(severity !== "all" ? { severity } : {}),
    ...(status !== "all" ? { status } : {}),
  })

  const update = useUpdateLanguageFinding()

  const setStatusFor = (id: number, next: string, approvedFix?: string) => {
    update.mutate(
      { id, data: { status: next, ...(approvedFix ? { approvedFix } : {}) } },
      { onSuccess: () => refetch() },
    )
  }

  const copy = (id: number, text: string) => {
    navigator.clipboard?.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500)
  }

  const stats = useMemo(() => {
    const total = findings.length
    const critical = findings.filter((f) => f.severity === "critical").length
    const claims = findings.filter((f) => f.issueType === "Marketing Claim").length
    return { total, critical, claims }
  }, [findings])

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Languages className="w-7 h-7 text-primary" /> Language Review
        </h1>
        <p className="text-muted-foreground mt-1">
          AI-detected language issues across all packaging — spelling, grammar,
          context, regulatory language, marketing claims, and brand standards.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold">{stats.total}</div>
            <p className="text-sm text-muted-foreground mt-1">Open findings</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold text-destructive">{stats.critical}</div>
            <p className="text-sm text-muted-foreground mt-1">Critical language issues</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold text-warning">{stats.claims}</div>
            <p className="text-sm text-muted-foreground mt-1">Marketing claims flagged</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search findings..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={issueType} onValueChange={setIssueType}>
          <SelectTrigger className="w-full sm:w-52"><SelectValue placeholder="Issue type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All issue types</SelectItem>
            {ISSUE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="major">Major</SelectItem>
            <SelectItem value="minor">Minor</SelectItem>
            <SelectItem value="informational">Informational</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="Open">Open</SelectItem>
            <SelectItem value="Approved">Approved</SelectItem>
            <SelectItem value="Dismissed">Dismissed</SelectItem>
            <SelectItem value="Resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : findings.length === 0 ? (
        <div className="text-center py-24 border border-dashed rounded-xl bg-card">
          <p className="text-lg font-medium">No language findings</p>
          <p className="text-muted-foreground mt-1">
            Run a language review on a package to populate this view.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {findings.map((f) => {
            const sev = severityMeta(f.severity)
            return (
              <Card key={f.id} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${sev.dot}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={issueBadgeVariant(f.issueType)}>{f.issueType}</Badge>
                          <Badge variant={sev.badge}>{sev.label}</Badge>
                          {f.status !== "Open" && <Badge variant="outline">{f.status}</Badge>}
                        </div>
                        <p className="text-sm text-foreground mt-2">{f.reason}</p>
                      </div>
                    </div>
                    {f.issueType === "Marketing Claim" && f.claimRiskScore != null && (
                      <div className="text-right shrink-0">
                        <div className={`text-2xl font-bold ${scoreColor(100 - f.claimRiskScore)}`}>
                          {f.claimRiskScore}
                        </div>
                        <div className="text-[10px] text-muted-foreground uppercase">Claim Risk</div>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <Link href={`/reviews/${f.packageId}`} className="font-mono hover:text-primary">{f.packageSku}</Link>
                    <span className="truncate max-w-[240px]">{f.packageName}</span>
                    {f.packageVendor && <span>· {f.packageVendor}</span>}
                    {f.languageScore != null && (
                      <span>· Score <span className={scoreColor(f.languageScore)}>{f.languageScore}</span></span>
                    )}
                  </div>

                  {f.originalText && hasDistinctFix(f.originalText, f.suggestedText) && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Original: </span>
                      <span className="font-medium text-destructive line-through">{f.originalText}</span>
                    </div>
                  )}

                  {f.originalText && !hasDistinctFix(f.originalText, f.suggestedText) && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Reviewed copy: </span>
                      <span className="font-medium">"{f.originalText}"</span>
                    </div>
                  )}

                  {hasDistinctFix(f.originalText, f.suggestedText) && (
                    <div className="rounded-lg border border-success/30 bg-success/5 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-success uppercase tracking-wide">Suggested Fix</span>
                        <Button size="sm" variant="ghost" className="h-7 gap-1.5" onClick={() => copy(f.id, f.suggestedText!)}>
                          {copied === f.id ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                          {copied === f.id ? "Copied" : "Copy"}
                        </Button>
                      </div>
                      <p className="text-sm font-medium mt-1.5">{f.suggestedText}</p>
                      {f.historicalUsage > 0 && (
                        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                          <History className="w-3.5 h-3.5" />
                          Applied successfully in {f.historicalUsage.toLocaleString()} approved review{f.historicalUsage === 1 ? "" : "s"}
                        </p>
                      )}
                    </div>
                  )}

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

                  {f.regulationReference && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <BookOpen className="w-3.5 h-3.5" /> {f.regulationReference}
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    {f.status === "Open" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 text-success border-success/30 hover:bg-success/10"
                          disabled={update.isPending}
                          onClick={() => setStatusFor(f.id, "Approved", hasDistinctFix(f.originalText, f.suggestedText) ? f.suggestedText ?? undefined : undefined)}
                        >
                          <CheckCircle className="w-3.5 h-3.5" /> {hasDistinctFix(f.originalText, f.suggestedText) ? "Approve fix" : "Acknowledge"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 gap-1.5 text-muted-foreground"
                          disabled={update.isPending}
                          onClick={() => setStatusFor(f.id, "Dismissed")}
                        >
                          <XCircle className="w-3.5 h-3.5" /> Dismiss
                        </Button>
                      </>
                    )}
                    <Link href={`/reviews/${f.packageId}`}>
                      <Button variant="ghost" size="sm" className="gap-1 h-8">
                        Open review <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
