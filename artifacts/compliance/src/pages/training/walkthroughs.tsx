import { Link } from "wouter"
import { Compass, PlayCircle, Clock, ArrowRight, MousePointerClick } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { TrainingHeader, Chip, CompleteButton } from "@/components/training/kit"
import { WALKTHROUGHS } from "@/lib/training/content-learning"
import { TOURS, startTour } from "@/lib/training/tours"

export default function Walkthroughs() {
  return (
    <div className="space-y-8">
      <TrainingHeader
        icon={Compass}
        eyebrow="Training & Help"
        title="Interactive Walkthroughs"
        description="Learn by doing. Launch a live tour that highlights the real interface, or follow an illustrated step-by-step guide at your own pace."
      />

      <section>
        <div className="mb-3 flex items-center gap-2">
          <MousePointerClick className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Live guided tours</h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          These tours spotlight parts of the actual workspace around you. Start one from anywhere.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {TOURS.map((tour) => (
            <Card key={tour.id} className="flex flex-col hover-elevate transition-all">
              <CardContent className="flex flex-1 flex-col p-5">
                <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {tour.estMinutes} min
                </div>
                <h3 className="font-semibold text-foreground">{tour.title}</h3>
                <p className="mt-1 flex-1 text-sm text-muted-foreground">{tour.description}</p>
                <Button
                  className="mt-4 w-full gap-2"
                  onClick={() => startTour(tour.id)}
                >
                  <PlayCircle className="h-4 w-4" />
                  Start tour
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <Compass className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Step-by-step guides</h2>
        </div>
        <Accordion type="single" collapsible className="space-y-3">
          {WALKTHROUGHS.map((wt) => (
            <AccordionItem
              key={wt.key}
              value={wt.key}
              className="rounded-lg border bg-card px-4"
            >
              <AccordionTrigger className="hover:no-underline">
                <div className="flex flex-1 flex-col items-start gap-1 pr-4 text-left">
                  <span className="font-semibold text-foreground">{wt.title}</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {wt.description}
                  </span>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Chip tone="blue">{wt.audience}</Chip>
                    <Chip tone="muted">
                      <Clock className="h-3 w-3" />
                      {wt.estMinutes} min
                    </Chip>
                    <Chip tone="muted">{wt.steps.length} steps</Chip>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <ol className="space-y-4 border-l border-border pl-6">
                  {wt.steps.map((step, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {i + 1}
                      </span>
                      <h4 className="font-medium text-foreground">{step.title}</h4>
                      <p className="text-sm text-muted-foreground">{step.detail}</p>
                    </li>
                  ))}
                </ol>
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  {wt.liveTourId && (
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => startTour(wt.liveTourId!)}>
                      <PlayCircle className="h-4 w-4" />
                      Launch live tour
                    </Button>
                  )}
                  {wt.relatedHref && (
                    <Link href={wt.relatedHref}>
                      <Button variant="outline" size="sm" className="gap-1">
                        Go there
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  )}
                  <CompleteButton itemKey={wt.key} itemType="walkthrough" />
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>
    </div>
  )
}
