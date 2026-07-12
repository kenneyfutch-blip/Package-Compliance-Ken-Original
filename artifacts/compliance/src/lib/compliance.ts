// Shared compliance helpers: severity styling, engine normalization, grading.

export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"

export const SEVERITY_META: Record<
  string,
  { label: string; badge: BadgeVariant; dot: string; text: string; rank: number }
> = {
  critical: { label: "Critical", badge: "destructive", dot: "bg-destructive", text: "text-destructive", rank: 0 },
  major: { label: "Major", badge: "warning", dot: "bg-warning", text: "text-warning", rank: 1 },
  minor: { label: "Minor", badge: "secondary", dot: "bg-muted-foreground", text: "text-muted-foreground", rank: 2 },
  info: { label: "Info", badge: "outline", dot: "bg-primary", text: "text-primary", rank: 3 },
}

export function severityMeta(sev?: string | null) {
  return SEVERITY_META[(sev ?? "").toLowerCase()] ?? SEVERITY_META.info
}

export const CANONICAL_ENGINES = [
  "Spelling & Grammar",
  "Contextual Language",
  "FDA",
  "EPA",
  "FTC",
  "CPSC",
  "USDA",
  "Marketing Claims",
  "Formatting",
  "Country of Origin",
  "Dollar Tree Standards",
  "Other",
] as const

export function normalizeEngine(engine?: string | null): string {
  const e = (engine ?? "").toLowerCase()
  if (!e) return "Other"
  if (/spell|grammar|typo|style/.test(e)) return "Spelling & Grammar"
  if (/context/.test(e)) return "Contextual Language"
  if (/claim|marketing|natural|organic/.test(e)) return "Marketing Claims"
  if (/country|origin|customs/.test(e)) return "Country of Origin"
  if (/format|legib|panel|type size|display|placement/.test(e)) return "Formatting"
  if (/dollar tree|internal|brand|\bsop\b/.test(e)) return "Dollar Tree Standards"
  if (/usda/.test(e)) return "USDA"
  if (/cpsc/.test(e)) return "CPSC"
  if (/ftc/.test(e)) return "FTC"
  if (/epa/.test(e)) return "EPA"
  if (/fda|nutrition|allergen|ingredient|drug|cosmetic|label/.test(e)) return "FDA"
  return "Other"
}

export function isClaimEngine(engine?: string | null): boolean {
  return /claim|marketing|natural|organic|healthy|non.?toxic|eco|germ|proven/i.test(
    engine ?? "",
  )
}

export function gradeColor(grade?: string | null): string {
  if (!grade) return "text-muted-foreground"
  if (grade === "A" || grade === "B") return "text-success"
  if (grade === "F") return "text-destructive"
  return "text-warning"
}

export function gradeBorder(grade?: string | null): string {
  if (!grade) return "hsl(var(--muted))"
  if (grade === "A" || grade === "B") return "hsl(var(--success))"
  if (grade === "F") return "hsl(var(--destructive))"
  return "hsl(var(--warning))"
}

export function gradePoints(grade?: string | null): number | null {
  if (!grade) return null
  const map: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 }
  return map[grade] ?? null
}

// A finding is only a genuine correction when it proposes replacement text that
// actually differs from the original/detected text. Informational or compliant
// notes often echo the original wording back as the "suggestion" — those must
// not be shown as a strikethrough → fix pair, which reads as a no-op edit.
export function hasDistinctFix(
  original?: string | null,
  suggested?: string | null,
): boolean {
  const s = (suggested ?? "").trim()
  if (!s) return false
  return s.toLowerCase() !== (original ?? "").trim().toLowerCase()
}

export function pointsToGrade(pts: number): string {
  if (pts >= 3.5) return "A"
  if (pts >= 2.5) return "B"
  if (pts >= 1.5) return "C"
  if (pts >= 0.5) return "D"
  return "F"
}

export function riskBand(
  score?: number | null,
): { label: string; badge: BadgeVariant; border: string } {
  const s = score ?? 0
  if (s >= 70) return { label: "High", badge: "destructive", border: "hsl(var(--destructive))" }
  if (s >= 40) return { label: "Medium", badge: "warning", border: "hsl(var(--warning))" }
  return { label: "Low", badge: "success", border: "hsl(var(--success))" }
}
