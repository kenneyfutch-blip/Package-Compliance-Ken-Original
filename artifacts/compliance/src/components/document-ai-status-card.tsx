import { useGetDocumentAiStatus, type DocumentAiStatus } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScanText, CheckCircle2, Circle } from "lucide-react"

const ENV_VARS: { key: keyof DocumentAiStatus; label: string }[] = [
  { key: "projectConfigured", label: "GOOGLE_PROJECT_ID" },
  { key: "locationConfigured", label: "GOOGLE_LOCATION" },
  { key: "processorConfigured", label: "DOCUMENT_AI_PROCESSOR_ID" },
  { key: "serviceAccountConfigured", label: "DOCUMENT_AI_SERVICE_ACCOUNT" },
]

export function DocumentAiStatusCard() {
  const { data: status } = useGetDocumentAiStatus()
  const configured = status?.configured ?? false
  const isGoogle = status?.engine === "google-document-ai"
  const engineName = isGoogle ? "Google Document AI" : "OpenAI Vision"

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScanText className="w-5 h-5 text-primary" />
            <CardTitle>Document Extraction Engine</CardTitle>
          </div>
          {configured ? (
            <Badge variant="outline" className="bg-success/10 text-success border-success/20">Connected</Badge>
          ) : (
            <Badge variant="outline" className="bg-muted text-muted-foreground">Not configured</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {isGoogle ? (
            <>Google Document AI ({status?.processorType ?? "Layout Parser"}) performs enterprise OCR,
            captures page coordinates, and detects packaging components.</>
          ) : (
            <>{engineName} ({status?.processorType ?? "Vision Transcription"}) transcribes packaging
            text with the active AI model and detects packaging components.</>
          )} Extraction is cached and only re-runs on new uploads, new versions, or manual reprocess.
        </p>
      </CardHeader>
      <CardContent>
        {isGoogle ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ENV_VARS.map(({ key, label }) => {
              const ok = Boolean(status?.[key])
              return (
                <div key={label} className="flex items-center gap-2 rounded-md border border-border p-2.5">
                  {ok ? (
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                  )}
                  <span className={`font-mono text-xs ${ok ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-border p-2.5">
            <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
            <span className="text-xs text-muted-foreground">
              Powered by the active AI model — no separate credentials required.
            </span>
          </div>
        )}
        {status?.location && (
          <p className="text-xs text-muted-foreground mt-3">Region: <span className="font-mono">{status.location}</span></p>
        )}
      </CardContent>
    </Card>
  )
}
