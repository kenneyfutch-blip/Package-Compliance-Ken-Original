// Identity registry for the AI Workspace specialists. These personas act as
// "AI employees" in the chat, so each one gets a human name and a headshot.
// Photos live in `public/specialists/` and are served under the app base path.
// Personas without a headshot (e.g. the meta "router") fall back to initials.

const BASE = import.meta.env.BASE_URL // always ends with "/"

export interface SpecialistProfile {
  /** Human name shown as the AI employee's identity. */
  name: string
  /** Short role/title (mirrors the specialist label). */
  title: string
  /** Resolved headshot URL, or undefined to use the initials fallback. */
  photo?: string
  /** Tailwind classes for the initials-fallback ring/background. */
  fallbackClass: string
}

function photo(file: string): string {
  return `${BASE}specialists/${file}`
}

export const SPECIALIST_PROFILES: Record<string, SpecialistProfile> = {
  general: {
    name: "Ethan Cole",
    title: "General Assistant",
    photo: photo("general.jpg"),
    fallbackClass: "bg-primary/10 text-primary ring-primary/15",
  },
  compliance: {
    name: "Maya Chen",
    title: "Compliance Analyst",
    photo: photo("compliance.jpg"),
    fallbackClass: "bg-primary/10 text-primary ring-primary/15",
  },
  regulatory: {
    name: "Marcus Bell",
    title: "Regulatory Expert",
    photo: photo("regulatory.jpg"),
    fallbackClass: "bg-primary/10 text-primary ring-primary/15",
  },
  packaging_engineer: {
    name: "Ryan Kessler",
    title: "Packaging Engineer",
    photo: photo("packaging-engineer.jpg"),
    fallbackClass: "bg-primary/10 text-primary ring-primary/15",
  },
  packaging_reviewer: {
    name: "Nora Bennett",
    title: "Packaging Reviewer",
    photo: photo("packaging-reviewer.jpg"),
    fallbackClass: "bg-primary/10 text-primary ring-primary/15",
  },
  claims: {
    name: "Erin Walsh",
    title: "Claims Specialist",
    photo: photo("claims.jpg"),
    fallbackClass: "bg-primary/10 text-primary ring-primary/15",
  },
  executive: {
    name: "Grant Whitfield",
    title: "Executive Briefer",
    photo: photo("executive.jpg"),
    fallbackClass: "bg-primary/10 text-primary ring-primary/15",
  },
  agent_router: {
    // The router is a dispatcher, not a person — no headshot by design.
    name: "Workspace Router",
    title: "Workspace Router",
    fallbackClass: "bg-brand/15 text-brand ring-brand/25",
  },
}

/** Derive up to two initials from a name for the fallback avatar. */
export function specialistInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "AI"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Resolve a profile for a specialist key, falling back to a synthesized
 * profile (using the provided label) when the key is unknown.
 */
export function getSpecialistProfile(
  key: string | undefined,
  label?: string,
): SpecialistProfile {
  if (key && SPECIALIST_PROFILES[key]) return SPECIALIST_PROFILES[key]
  return {
    name: label ?? "AI Specialist",
    title: label ?? "AI Specialist",
    fallbackClass: "bg-primary/10 text-primary ring-primary/15",
  }
}
