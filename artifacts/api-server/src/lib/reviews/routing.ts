// Category -> team routing rules. A package's free-text category is matched
// (case-insensitive substring) against each rule's keywords in order; the first
// rule that matches wins. Team names must match the teams seeded for the org.
// Kept as data (not hardcoded branches) so the routing map is easy to audit and
// extend as new specialist teams are introduced.
export interface RoutingRule {
  team: string;
  keywords: string[];
}

export const ROUTING_RULES: RoutingRule[] = [
  {
    team: "Toys & Children Safety",
    keywords: [
      "toy",
      "children",
      "child",
      "kid",
      "infant",
      "baby",
      "juvenile",
      "nursery",
    ],
  },
  {
    team: "Household & Chemicals",
    keywords: [
      "household",
      "chemical",
      "cleaning",
      "cleaner",
      "disinfectant",
      "sanitizer",
      "pesticide",
      "cosmetic",
      "personal care",
      "aerosol",
      "hazard",
      "epa",
    ],
  },
  {
    team: "Food & Beverage Compliance",
    keywords: [
      "food",
      "beverage",
      "drink",
      "snack",
      "grocery",
      "nutrition",
      "allergen",
      "labeling",
      "label",
      "dietary",
      "supplement",
      "origin",
    ],
  },
];

// Returns the team name a category should route to, or null if nothing matches.
export function matchTeamName(category: string | null | undefined): string | null {
  if (!category) return null;
  const c = category.toLowerCase();
  for (const rule of ROUTING_RULES) {
    if (rule.keywords.some((k) => c.includes(k))) return rule.team;
  }
  return null;
}
