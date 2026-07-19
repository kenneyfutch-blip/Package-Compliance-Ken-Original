// Security Posture — real-time reference page for the cyber-security team.
// Renders the server's security control catalog, audit history, and live
// system checks, plus a download link for the PDF audit report.
import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Download,
  Loader2,
  CircleCheck,
  CircleAlert,
  CircleHelp,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type SecurityControl = {
  id: string
  category: string
  name: string
  status: "enforced" | "accepted-risk"
  description: string
}

type AuditRecord = {
  date: string
  scope: string
  outcome: string
  criticalFindings: number
  highFindings: number
  notes: string[]
}

type PostureResponse = {
  generatedAt: string
  meta: { productName: string; owner: string; classification: string; stack: string }
  controls: SecurityControl[]
  audits: AuditRecord[]
  live: {
    database: string
    backgroundWorker: string
    environment: string
    authGuard: string
  }
}

async function fetchPosture(): Promise<PostureResponse> {
  const res = await fetch("/api/security/posture", { credentials: "include" })
  if (!res.ok) throw new Error(`Failed to load security posture (${res.status})`)
  return (await res.json()) as PostureResponse
}

function LiveCheck({
  label,
  value,
  good,
  warn,
}: {
  label: string
  value: string
  good: boolean
  warn?: boolean
}) {
  const Icon = good ? CircleCheck : warn ? CircleHelp : CircleAlert
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <Icon
        className={cn(
          "h-5 w-5 shrink-0",
          good ? "text-green-600" : warn ? "text-amber-600" : "text-red-600",
        )}
      />
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div
          className={cn(
            "text-xs capitalize",
            good ? "text-green-600" : warn ? "text-amber-600" : "text-red-600",
          )}
        >
          {value}
        </div>
      </div>
    </div>
  )
}

export default function SecurityPosturePage() {
  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ["security-posture"],
    queryFn: fetchPosture,
    refetchInterval: 60_000, // real-time reference: refresh live checks every minute
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading security posture…
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="py-24 text-center text-sm text-muted-foreground">
        Could not load the security posture. You may not have permission to view this page.
      </div>
    )
  }

  const categories = [...new Set(data.controls.map((c) => c.category))]
  const enforced = data.controls.filter((c) => c.status === "enforced").length
  const accepted = data.controls.length - enforced
  const latest = data.audits[0]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Shield className="h-6 w-6 text-primary" /> Security Posture
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live reference of the platform&apos;s security controls, audit history, and system
            checks. Auto-refreshes every minute · last checked{" "}
            {new Date(dataUpdatedAt).toLocaleTimeString()}.
          </p>
        </div>
        <Button asChild variant="outline" className="gap-2">
          <a href="/api/security/report.pdf">
            <Download className="h-4 w-4" /> Download PDF report
          </a>
        </Button>
      </div>

      {/* Live checks */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Real-time checks</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <LiveCheck
            label="Backend auth guard"
            value={data.live.authGuard}
            good={data.live.authGuard === "active"}
          />
          <LiveCheck
            label="Database"
            value={data.live.database}
            good={data.live.database === "connected"}
          />
          <LiveCheck
            label="Background worker"
            value={data.live.backgroundWorker}
            good={data.live.backgroundWorker === "active"}
            warn={data.live.backgroundWorker !== "active"}
          />
          <LiveCheck label="Environment" value={data.live.environment} good warn={false} />
        </CardContent>
      </Card>

      {/* Latest audit */}
      {latest && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Latest security audit
              <Badge
                variant="outline"
                className={cn(
                  latest.criticalFindings + latest.highFindings === 0
                    ? "border-green-200 bg-green-50 text-green-700"
                    : "border-red-200 bg-red-50 text-red-700",
                )}
              >
                {latest.criticalFindings} critical · {latest.highFindings} high
              </Badge>
              <span className="text-sm font-normal text-muted-foreground">{latest.date}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="font-medium">{latest.outcome}</p>
            <p className="text-muted-foreground">{latest.scope}</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {latest.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 pt-2">
        <h2 className="text-lg font-semibold">Security controls</h2>
        <Badge variant="secondary">{enforced} enforced</Badge>
        {accepted > 0 && <Badge variant="outline">{accepted} accepted risk</Badge>}
      </div>
      {categories.map((category) => (
        <Card key={category}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{category}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {data.controls
              .filter((c) => c.category === category)
              .map((control) => (
                <div key={control.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  {control.status === "enforced" ? (
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                  ) : (
                    <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{control.name}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          control.status === "enforced"
                            ? "border-green-200 bg-green-50 text-green-700"
                            : "border-amber-200 bg-amber-50 text-amber-700",
                        )}
                      >
                        {control.status === "enforced" ? "Enforced" : "Accepted risk"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{control.description}</p>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
