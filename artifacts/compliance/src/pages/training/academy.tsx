import { GraduationCap, Clock, BookOpen } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { TrainingHeader, ProgressStat, Chip, CompleteButton } from "@/components/training/kit"
import { useTrainingProgress, countComplete } from "@/lib/training/progress"
import { ACADEMY_COURSES } from "@/lib/training/content-learning"

const LEVEL_TONE = {
  Foundational: "emerald",
  Intermediate: "blue",
  Advanced: "violet",
} as const

export default function Academy() {
  const { completed } = useTrainingProgress()
  const keys = ACADEMY_COURSES.map((c) => c.key)
  const done = countComplete(completed, keys)

  return (
    <div className="space-y-8">
      <TrainingHeader
        icon={GraduationCap}
        eyebrow="Training & Help"
        title="Compliance Academy"
        description="Structured courses that build real compliance expertise, from the fundamentals to running a team. Mark a course complete when you've worked through it."
      >
        <ProgressStat done={done} total={keys.length} label="Courses" />
      </TrainingHeader>

      <div className="space-y-5">
        {ACADEMY_COURSES.map((course) => (
          <Card key={course.key}>
            <CardContent className="p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Chip tone={LEVEL_TONE[course.level]}>{course.level}</Chip>
                    <Chip tone="muted">
                      <Clock className="h-3 w-3" />
                      {course.estMinutes} min
                    </Chip>
                    <Chip tone="muted">
                      <BookOpen className="h-3 w-3" />
                      {course.lessons.length} lessons
                    </Chip>
                  </div>
                  <h2 className="text-lg font-semibold text-foreground">{course.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{course.description}</p>
                </div>
                <CompleteButton itemKey={course.key} itemType="course" />
              </div>

              <Accordion type="single" collapsible className="mt-4 border-t pt-2">
                {course.lessons.map((lesson, i) => (
                  <AccordionItem key={i} value={`${course.key}-${i}`} className="border-b last:border-b-0">
                    <AccordionTrigger className="text-left text-sm font-medium hover:no-underline">
                      <span className="flex items-center gap-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {i + 1}
                        </span>
                        {lesson.title}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="ml-9 list-disc space-y-1 text-sm text-muted-foreground">
                        {lesson.points.map((point, j) => (
                          <li key={j}>{point}</li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
