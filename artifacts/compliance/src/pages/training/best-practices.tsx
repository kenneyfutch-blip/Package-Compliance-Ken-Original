import { Lightbulb, Check } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { TrainingHeader, Chip, CompleteButton } from "@/components/training/kit"
import { BEST_PRACTICES } from "@/lib/training/content-learning"

export default function BestPractices() {
  return (
    <div className="space-y-8">
      <TrainingHeader
        icon={Lightbulb}
        eyebrow="Training & Help"
        title="Best Practices"
        description="Field-tested habits that make compliance work faster, more consistent, and easier to defend."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {BEST_PRACTICES.map((bp) => (
          <Card key={bp.key} className="flex flex-col">
            <CardContent className="flex flex-1 flex-col p-6">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Chip tone="amber">{bp.category}</Chip>
              </div>
              <h3 className="text-lg font-semibold text-foreground">{bp.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{bp.summary}</p>
              <ul className="mt-4 flex-1 space-y-2.5">
                {bp.tips.map((tip, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                <CompleteButton itemKey={bp.key} itemType="best-practice" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
