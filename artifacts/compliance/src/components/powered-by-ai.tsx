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
              "pba-rainbow inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-0.5 text-[11px] font-medium text-neutral-900 cursor-default select-none",
              className,
            )}
          >
            <Sparkles className="w-3 h-3 text-neutral-900 shrink-0" />
            <span className="hidden text-neutral-500 sm:inline">Powered by</span>
            <span className="text-neutral-900">{label} {model}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[15rem] border border-neutral-700 bg-neutral-900 text-white">
          <p className="text-xs font-medium">Powered by {label} · {model}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-neutral-400">
            Compliance analysis, findings, risk score and fix recommendations all run
            on your model across every speed tier.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
