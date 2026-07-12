import { useMemo, useState } from "react"
import { Video, PlayCircle, Clock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { TrainingHeader, Chip, CompleteButton } from "@/components/training/kit"
import { cn } from "@/lib/utils"
import { VIDEO_TUTORIALS } from "@/lib/training/content-learning"

const LEVEL_TONE = {
  Beginner: "emerald",
  Intermediate: "blue",
  Advanced: "violet",
} as const

export default function VideoTutorials() {
  const [category, setCategory] = useState("All")

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(VIDEO_TUTORIALS.map((v) => v.category)))],
    [],
  )
  const filtered = useMemo(
    () =>
      category === "All"
        ? VIDEO_TUTORIALS
        : VIDEO_TUTORIALS.filter((v) => v.category === category),
    [category],
  )

  return (
    <div className="space-y-8">
      <TrainingHeader
        icon={Video}
        eyebrow="Training & Help"
        title="Video Tutorials"
        description="Short, focused videos for every part of the platform. Recordings are on the way — each tutorial below already lists exactly what it will cover."
      />

      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              category === cat
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent",
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {filtered.map((video) => (
          <Card key={video.key} className="overflow-hidden">
            <div className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-primary/10 via-muted to-background">
              <PlayCircle className="h-14 w-14 text-primary/60" />
              <span className="absolute right-3 top-3">
                <Chip tone="muted">Coming soon</Chip>
              </span>
              <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded bg-background/80 px-2 py-0.5 text-xs font-medium text-foreground backdrop-blur">
                <Clock className="h-3 w-3" />
                {video.duration}
              </span>
            </div>
            <CardContent className="p-5">
              <div className="mb-2 flex items-center gap-2">
                <Chip tone={LEVEL_TONE[video.level]}>{video.level}</Chip>
                <Chip tone="muted">{video.category}</Chip>
              </div>
              <h3 className="font-semibold text-foreground">{video.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{video.description}</p>
              <Accordion type="single" collapsible className="mt-3">
                <AccordionItem value="outline" className="border-b-0">
                  <AccordionTrigger className="py-2 text-sm hover:no-underline">
                    What you'll learn
                  </AccordionTrigger>
                  <AccordionContent>
                    <ul className="ml-4 list-disc space-y-1 text-sm text-muted-foreground">
                      {video.outline.map((point, i) => (
                        <li key={i}>{point}</li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
              <div className="mt-3">
                <CompleteButton itemKey={video.key} itemType="video" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
