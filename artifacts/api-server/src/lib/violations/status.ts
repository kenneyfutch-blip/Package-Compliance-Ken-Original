// Finding (violation) status helpers.
//
// A reviewer can dismiss a finding the AI raised as NOT APPLICABLE — e.g. text
// the AI OCR'd from the artwork's prepress/production layer (PANTONE/CMYK color
// callouts, file names, dimensions, dieline/cut codes) which is stripped before
// the consumer-facing run and is not a real compliance issue. A dismissed
// finding is kept for the audit trail but must NOT count against the package's
// compliance score, and it is fed into compliance memory so future AI reviews
// learn the team treats such content as non-applicable.

export const NOT_APPLICABLE_STATUS = "Not Applicable";
export const OPEN_STATUS = "Open";

// Structured dismissal reasons offered to reviewers. The value is the durable,
// human-readable label stored on the finding and embedded into memory.
export const DISMISS_REASONS: Record<string, string> = {
  prepress:
    "Prepress / production-layer content — not consumer-facing packaging copy",
  not_applicable: "Not applicable to this product",
  false_positive: "False positive — no actual issue",
  duplicate: "Duplicate of another finding",
  other: "Other",
};

// Resolve a client-supplied reason key to its durable label. Unknown keys fall
// back to "Other" so the stored value is always meaningful.
export function dismissReasonLabel(reasonKey: string | null | undefined): string {
  if (reasonKey && reasonKey in DISMISS_REASONS) return DISMISS_REASONS[reasonKey];
  return DISMISS_REASONS.other;
}

// A finding counts against the compliance score only when it is an active
// issue/warning that has NOT been dismissed as not-applicable.
export function isFindingCounted(v: {
  findingClass: string;
  status: string;
}): boolean {
  if (v.findingClass !== "issue" && v.findingClass !== "warning") return false;
  return v.status !== NOT_APPLICABLE_STATUS;
}

// The institutional-knowledge text captured into compliance memory when a
// finding is dismissed, so future AI reviews recall how the team handled it.
export function dismissalResolutionText(
  reasonLabel: string | null | undefined,
  note: string | null | undefined,
): string {
  const base = `Reviewer marked this finding NOT APPLICABLE — ${
    reasonLabel || DISMISS_REASONS.other
  }.`;
  const detail = note && note.trim() ? ` ${note.trim()}` : "";
  return `${base}${detail} Treat similar detected content as non-applicable rather than a violation.`;
}
