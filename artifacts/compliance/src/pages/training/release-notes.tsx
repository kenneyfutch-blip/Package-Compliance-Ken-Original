import { Sparkles, Plus, ArrowUp, Wrench } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { TrainingHeader, Chip } from "@/components/training/kit"
import { RELEASE_NOTES } from "@/lib/training/content-reference"

const CHANGE_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }>; tone: "emerald" | "blue" | "amber" }
> = {
  feature: { label: "New", icon: Plus, tone: "emerald" },
  improvement: { label: "Improved", icon: ArrowUp, tone: "blue" },
  fix: { label: "Fixed", icon: Wrench, tone: "amber" },
}

export default function ReleaseNotes() {
  return (
    <div className="space-y-8">
      <TrainingHeader
        icon={Sparkles}
        eyebrow="Training & Help"
        title="Release Notes"
        description="What's new, improved, and fixed in Packaging Compliance AI, newest first."
      />

      <div className="space-y-6">
        {RELEASE_NOTES.map((release) => (
          <Card key={release.version}>
            <CardContent className="p-6">
              <div className="flex flex-col gap-1 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Chip tone="primary">v{release.version}</Chip>
                  <h2 className="text-lg font-semibold text-foreground">{release.title}</h2>
                </div>
                <span className="text-sm text-muted-foreground">{release.date}</span>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">{release.summary}</p>
              <ul className="mt-4 space-y-3">
                {release.changes.map((change, i) => {
                  const meta = CHANGE_META[change.type]
                  const Icon = meta.icon
                  return (
                    <li key={i} className="flex items-start gap-3">
                      <span className="mt-0.5">
                        <Chip tone={meta.tone}>
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </Chip>
                      </span>
                      <span className="text-sm text-foreground">{change.text}</span>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
