import * as React from "react"
import { Linkedin, BadgeCheck, X } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"

// Small, unobtrusive "about the builder" chip pinned to the bottom-right of
// the app shell. Click-to-open only (never hover) so it can't distract during
// normal work — modeled after Bankrate's author bio cards.
const LINKEDIN_URL = "https://www.linkedin.com/in/kenneth-futch"
// Static copy of Kenneth's profile photo, served from public/ so every viewer
// sees the builder's photo (not their own account image).
const PHOTO_URL = `${import.meta.env.BASE_URL}builder-kf.jpg`

export function BuilderBadge() {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="fixed bottom-4 right-4 z-40 print:hidden">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="About the builder"
            className="flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-2.5 py-1.5 text-xs text-muted-foreground shadow-md backdrop-blur hover:text-foreground hover:shadow-lg transition-all"
          >
            <Avatar className="h-5 w-5">
              <AvatarImage src={PHOTO_URL} alt="Kenneth Futch" className="object-cover" />
              <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                KF
              </AvatarFallback>
            </Avatar>
            Built by Kenneth Futch
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={10}
          className="w-80 p-0 overflow-hidden"
        >
          <div className="relative p-5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 border border-border">
                <AvatarImage src={PHOTO_URL} alt="Kenneth Futch" className="object-cover" />
                <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
                  KF
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-base font-semibold text-foreground leading-tight">
                  Kenneth Futch
                </p>
                <p className="text-sm text-muted-foreground">
                  AI &amp; Organic Growth Leader · Head of SEO, Dollar Tree
                </p>
              </div>
            </div>

            <div className="mt-4 border-t border-border pt-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <BadgeCheck className="w-4 h-4 text-primary" /> Expertise
              </p>
              <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />
                  Enterprise SEO &amp; Generative Engine Optimization (GEO)
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />
                  AI product development &amp; agentic workflows
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />
                  Compliance technology &amp; operational intelligence
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />
                  Data analytics &amp; business intelligence
                </li>
              </ul>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Kenneth is an enterprise growth leader with 15+ years driving
              organic growth for brands like Johnson &amp; Johnson, Grammarly,
              Chick-fil-A, and NAPA Auto Parts. He pairs executive SEO
              leadership with hands-on AI product development — building this
              Packaging Compliance platform to automate regulatory analysis,
              supplier collaboration, and executive reporting. Recognized as a
              Top 10% Replit Builder.
            </p>

            <div className="mt-4 flex items-center justify-between">
              <Button asChild size="sm" className="gap-2">
                <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer">
                  <Linkedin className="w-4 h-4" /> Connect on LinkedIn
                </a>
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
