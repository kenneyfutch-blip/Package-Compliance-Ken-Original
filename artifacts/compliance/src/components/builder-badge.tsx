import * as React from "react"
import { Linkedin, BadgeCheck, X } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"

// Small, unobtrusive "about the builder" chip pinned to the bottom-right of
// the app shell. Click-to-open only (never hover) so it can't distract during
// normal work — modeled after Bankrate's author bio cards.
const LINKEDIN_URL = "https://www.linkedin.com/in/kenneth-futch"

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
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
              KF
            </span>
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
                <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
                  KF
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-base font-semibold text-foreground leading-tight">
                  Kenneth Futch
                </p>
                <p className="text-sm text-muted-foreground">
                  Builder, Packaging Compliance AI
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
                  Packaging &amp; labeling compliance
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />
                  Retail product review operations
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />
                  AI-assisted compliance workflows
                </li>
              </ul>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Kenneth built this tool to help compliance teams catch packaging
              and labeling issues before products hit the shelf — pairing AI
              review with real regulatory workflows.
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
