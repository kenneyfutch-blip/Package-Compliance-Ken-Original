import * as React from "react"
import { Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { useTrainingProgress } from "@/lib/training/progress"

// Shared presentational building blocks for the Training Center so every page
// reads as one cohesive hub.

export function TrainingHeader({
  icon: Icon,
  eyebrow,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  eyebrow?: string
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-6 w-6" />
        </div>
        <div>
          {eyebrow && (
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {eyebrow}
            </p>
          )}
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground sm:text-base">
            {description}
          </p>
        </div>
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}

export function ProgressStat({
  done,
  total,
  label,
}: {
  done: number
  total: number
  label?: string
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="min-w-48">
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{label ?? "Progress"}</span>
        <span className="font-medium text-foreground">
          {done}/{total}
        </span>
      </div>
      <Progress value={pct} className="h-2" />
    </div>
  )
}

// A complete/incomplete toggle backed by server-saved progress.
export function CompleteButton({
  itemKey,
  itemType = "guide",
  className,
  size = "sm",
}: {
  itemKey: string
  itemType?: string
  className?: string
  size?: "sm" | "default"
}) {
  const { isComplete, toggle, isSaving } = useTrainingProgress()
  const done = isComplete(itemKey)
  return (
    <Button
      type="button"
      variant={done ? "secondary" : "outline"}
      size={size}
      className={cn(className)}
      disabled={isSaving}
      onClick={() => void toggle(itemKey, itemType)}
    >
      {isSaving ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : done ? (
        <Check className="h-4 w-4 text-emerald-500" />
      ) : null}
      {done ? "Completed" : "Mark complete"}
    </Button>
  )
}

// Small colored chip for levels, audiences, categories, etc.
export function Chip({
  children,
  tone = "muted",
}: {
  children: React.ReactNode
  tone?: "muted" | "primary" | "emerald" | "amber" | "violet" | "blue" | "rose"
}) {
  const tones: Record<string, string> = {
    muted: "bg-muted text-muted-foreground",
    primary: "bg-primary/10 text-primary",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}
