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
 * "Powered by OpenAI gpt-5.5" indicator. Renders for every user (not gated on
 * the admin-only AI-provider list), so it shows reliably in the sidebar nav.
 * When the org's active provider is readable it reflects that exact model;
 * otherwise it falls back to the product's headline model label.
 */
export function PoweredByAi({ className }: { className?: string }) {
  const { data: providers = [] } = useListAiProviders()
  const active = providers.find((p) => p.active)
  const label = active ? (TYPE_LABEL[active.providerType] ?? "OpenAI") : "OpenAI"
  const model = active?.model ?? "gpt-5.5"

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-foreground cursor-default select-none",
              className,
            )}
          >
            <Sparkles className="w-2.5 h-2.5 shrink-0" />
            <span className="hidden text-muted-foreground sm:inline">Powered by</span>
            <span>{label} {model}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[16rem] border border-border bg-foreground text-background">
          <p className="text-xs font-medium">Powered by {label} · {model}</p>
          <p className="mt-0.5 text-[11px] text-background/70">
            Compliance analysis, findings, risk score and fix recommendations all run
            on your model across every speed tier.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
