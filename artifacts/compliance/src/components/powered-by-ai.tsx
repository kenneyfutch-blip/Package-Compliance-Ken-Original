import { useListAiProviders } from "@workspace/api-client-react"
import { Sparkles } from "lucide-react"
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const TYPE_LABEL: Record<string, string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
  custom: "Custom",
}

/**
 * Subtle, dynamic "Powered by <active model>" indicator. Reads the org's active
 * AI provider so it never hardcodes a model name — it always reflects whatever
 * model currently runs analysis (e.g. OpenAI gpt-5.5). Renders nothing until an
 * active provider is known.
 */
export function PoweredByAi({ className }: { className?: string }) {
  const { data: providers = [] } = useListAiProviders()
  const active = providers.find((p) => p.active)
  if (!active) return null
  const label = TYPE_LABEL[active.providerType] ?? "AI"

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "pba-rainbow inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium text-muted-foreground cursor-default select-none",
              className,
            )}
          >
            <Sparkles className="w-3 h-3 text-primary shrink-0" />
            <span className="hidden sm:inline">Powered by</span>
            <span className="text-foreground">{label} {active.model}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="font-medium">Powered by {label} · {active.model}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Compliance analysis, findings, risk score and fix recommendations all run
            on your active AI model across every speed tier.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
