// Shared constants + helpers for the proofing & review suite.

// Trigger a real file download for an exported proof. The server stores objects
// at UUID paths, so opening the URL in a tab just renders the PDF inline with no
// usable filename (you can't drag it into Teams/email). Appending `?download=`
// makes the server send it as a named attachment; the anchor's `download`
// attribute forces a save instead of navigation.
export function downloadProof(url: string, filename: string): void {
  const sep = url.includes("?") ? "&" : "?";
  const href = filename
    ? `${url}${sep}download=${encodeURIComponent(filename)}`
    : url;
  const a = document.createElement("a");
  a.href = href;
  a.download = filename || "";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const CURRENT_USER = {
  name: "Eleanor Shellstrop",
  role: "Compliance Manager",
};

export const REVIEWERS = [
  "Dana Whitfield",
  "Marcus Lee",
  "Priya Nair",
  "Sofia Alvarez",
  "Tom Becker",
  "Rachel Kim",
  "James Okafor",
];

export type FindingClass = "issue" | "warning" | "passed" | "recommendation";

export const FINDING_CLASS_META: Record<
  FindingClass,
  { label: string; color: string; badge: string; dot: string }
> = {
  issue: {
    label: "Issue",
    color: "#ef4444",
    badge: "bg-destructive/10 text-destructive border-destructive/20",
    dot: "bg-destructive",
  },
  warning: {
    label: "Warning",
    color: "#f59e0b",
    badge: "bg-warning/10 text-warning border-warning/20",
    dot: "bg-warning",
  },
  passed: {
    label: "Passed",
    color: "#22c55e",
    badge: "bg-success/10 text-success border-success/20",
    dot: "bg-success",
  },
  recommendation: {
    label: "Recommendation",
    color: "#8b5cf6",
    badge: "bg-[#8b5cf6]/10 text-[#8b5cf6] border-[#8b5cf6]/20",
    dot: "bg-[#8b5cf6]",
  },
};

export function findingClassMeta(cls: string | null | undefined) {
  return FINDING_CLASS_META[(cls as FindingClass) ?? "issue"] ?? FINDING_CLASS_META.issue;
}

export const PRIORITY_META: Record<
  string,
  { label: string; badge: string; rank: number }
> = {
  critical: { label: "Critical", badge: "bg-destructive/10 text-destructive border-destructive/20", rank: 0 },
  high: { label: "High", badge: "bg-warning/10 text-warning border-warning/20", rank: 1 },
  medium: { label: "Medium", badge: "bg-primary/10 text-primary border-primary/20", rank: 2 },
  low: { label: "Low", badge: "bg-muted text-muted-foreground border-border", rank: 3 },
};

export function priorityMeta(priority: string | null | undefined) {
  return PRIORITY_META[priority ?? "medium"] ?? PRIORITY_META.medium;
}

export const HUMAN_MARKUP_COLOR = "#3b82f6";

export type MarkupTool =
  | "hand"
  | "pin"
  | "rectangle"
  | "highlight"
  | "circle"
  | "arrow"
  | "strikethrough"
  | "text";

export const DRAG_TOOLS: MarkupTool[] = [
  "rectangle",
  "highlight",
  "circle",
  "arrow",
  "strikethrough",
];

/** Turn a stored object path into a browser-servable URL. */
export function servingUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http") || url.startsWith("/api/")) return url;
  if (url.startsWith("/objects/")) {
    return `/api/storage/objects/${url.replace(/^\/objects\//, "")}`;
  }
  // Seed artwork served by the web app itself under BASE_URL.
  if (url.startsWith("/artwork/")) {
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    return `${base}${url}`;
  }
  return url;
}

export function fileTypeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";
  if (lower.endsWith(".ai")) return "ai";
  if (lower.endsWith(".indd")) return "indd";
  return "other";
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function extractMentions(text: string): string[] {
  const found = new Set<string>();
  for (const name of REVIEWERS) {
    const handle = `@${name}`;
    if (text.includes(handle)) found.add(name);
    const first = `@${name.split(" ")[0]}`;
    if (text.includes(first)) found.add(name);
  }
  return [...found];
}
