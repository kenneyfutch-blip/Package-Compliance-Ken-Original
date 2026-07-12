import { Link } from "wouter"
import {
  Rocket,
  ArrowRight,
  PlayCircle,
  Upload,
  Brain,
  ClipboardList,
  BookOpen,
  GraduationCap,
  LifeBuoy,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { TrainingHeader, ProgressStat, CompleteButton } from "@/components/training/kit"
import { useTrainingProgress, countComplete } from "@/lib/training/progress"
import { GETTING_STARTED_CHECKLIST } from "@/lib/training/content-learning"
import { startTour } from "@/lib/training/tours"

const QUICK_LINKS = [
  { title: "User Guide", description: "The full reference, by area.", href: "/training/user-guide", icon: BookOpen },
  { title: "Walkthroughs", description: "Step-by-step and live tours.", href: "/training/walkthroughs", icon: PlayCircle },
  { title: "Compliance Academy", description: "Structured courses.", href: "/training/academy", icon: GraduationCap },
  { title: "Contact Support", description: "Reach the team.", href: "/training/support", icon: LifeBuoy },
]

export default function GettingStarted() {
  const { completed } = useTrainingProgress()
  const keys = GETTING_STARTED_CHECKLIST.map((s) => s.key)
  const done = countComplete(completed, keys)

  return (
    <div className="space-y-8">
      <TrainingHeader
        icon={Rocket}
        eyebrow="Training & Help"
        title="Getting Started"
        description="Everything you need to go from your first login to your first completed review. Work the checklist at your own pace — your progress is saved automatically."
      >
        <Button onClick={() => startTour("platform-orientation")} className="gap-2">
          <PlayCircle className="h-4 w-4" />
          Take the tour
        </Button>
      </TrainingHeader>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Your onboarding checklist</h2>
            <p className="text-sm text-muted-foreground">
              {done === keys.length
                ? "All done — you're ready to go."
                : `${keys.length - done} step${keys.length - done === 1 ? "" : "s"} left to feel at home in the platform.`}
            </p>
          </div>
          <ProgressStat done={done} total={keys.length} label="Onboarding" />
        </CardContent>
      </Card>

      <div className="space-y-3">
        {GETTING_STARTED_CHECKLIST.map((step, i) => (
          <Card key={step.key} className="hover-elevate transition-all">
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {i + 1}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {step.key === "checklist:tour" ? (
                  <Button variant="outline" size="sm" onClick={() => startTour("platform-orientation")}>
                    {step.cta}
                  </Button>
                ) : step.href ? (
                  <Link href={step.href}>
                    <Button variant="outline" size="sm" className="gap-1">
                      {step.cta ?? "Open"}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                ) : null}
                <CompleteButton itemKey={step.key} itemType="checklist" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-foreground">Where to go next</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon
            return (
              <Link key={link.href} href={link.href}>
                <Card className="h-full hover-elevate transition-all cursor-pointer">
                  <CardContent className="p-5">
                    <Icon className="mb-3 h-6 w-6 text-primary" />
                    <h3 className="font-semibold text-foreground">{link.title}</h3>
                    <p className="text-sm text-muted-foreground">{link.description}</p>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
