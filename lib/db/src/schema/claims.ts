import {
  pgTable,
  serial,
  text,
  integer,
  real,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";

// The marketing/label claims the Claims Compliance Engine is tuned to detect.
// The engine may surface other regulated claims too, but these are the ones it
// is explicitly instructed to look for and the ones the UI groups by.
export const TRACKED_CLAIM_TYPES = [
  "Organic",
  "Natural",
  "Clean",
  "Healthy",
  "Sustainable",
  "Eco-Friendly",
  "Recyclable",
  "Biodegradable",
  "Compostable",
  "Non-GMO",
  "Gluten Free",
  "Sugar Free",
] as const;
export type TrackedClaimType = (typeof TRACKED_CLAIM_TYPES)[number];

// Escalating risk bands. High and Critical claims force escalation to the
// reasoning tier (Sol) for a second, deeper pass.
export const CLAIM_RISK_LEVELS = ["Low", "Medium", "High", "Critical"] as const;
export type ClaimRiskLevel = (typeof CLAIM_RISK_LEVELS)[number];

// One run of the Claims Compliance Engine against a package. Holds the
// aggregate counts + orchestration metadata so lists and dashboards can render
// without recomputing. Latest-only: a re-run replaces the prior analysis.
export const claimAnalysesTable = pgTable(
  "claim_analyses",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id"),
    packageId: integer("package_id").notNull(),
    status: text("status").notNull().default("Complete"),
    summary: text("summary"),
    confidence: real("confidence"),
    claimsFound: integer("claims_found").notNull().default(0),
    lowCount: integer("low_count").notNull().default(0),
    mediumCount: integer("medium_count").notNull().default(0),
    highCount: integer("high_count").notNull().default(0),
    criticalCount: integer("critical_count").notNull().default(0),
    // Highest risk band present across the run, for quick list badges.
    highestRisk: text("highest_risk"),
    // Orchestration trail: did the High/Critical escalation to the reasoning
    // tier (Sol) fire, and which tier/model produced the final result.
    escalated: boolean("escalated").notNull().default(false),
    tier: text("tier"),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_claim_analyses_org").on(t.organizationId),
    index("idx_claim_analyses_pkg").on(t.packageId),
  ],
);

// One detected claim, tied to an analysis + package. Carries the full audited
// verdict: jurisdiction, risk band, applicable regulation, remediation, and the
// engine's confidence in the assessment.
export const claimFindingsTable = pgTable(
  "claim_findings",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id"),
    analysisId: integer("analysis_id").notNull(),
    packageId: integer("package_id").notNull(),
    // The tracked claim category (e.g. "Organic") or a free-form regulated
    // claim the engine surfaced.
    claimType: text("claim_type").notNull(),
    // The exact wording found on the artwork that constitutes the claim.
    claimText: text("claim_text"),
    // Regulating authority/authorities (e.g. "USDA", "FTC", "FDA / FTC").
    jurisdiction: text("jurisdiction"),
    // Low | Medium | High | Critical.
    riskLevel: text("risk_level").notNull().default("Low"),
    // The specific regulation/rule that governs the claim.
    regulationReference: text("regulation_reference"),
    // Recommended remediation to bring the claim into compliance.
    remediation: text("remediation"),
    // 0-100 engine confidence in this assessment.
    confidence: integer("confidence"),
    // Whether this specific finding triggered/justified the reasoning-tier
    // escalation (High/Critical).
    escalated: boolean("escalated").notNull().default(false),
    status: text("status").notNull().default("Open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_claim_findings_org").on(t.organizationId),
    index("idx_claim_findings_analysis").on(t.analysisId),
    index("idx_claim_findings_pkg").on(t.packageId),
  ],
);

export type ClaimAnalysisRow = typeof claimAnalysesTable.$inferSelect;
export type InsertClaimAnalysis = typeof claimAnalysesTable.$inferInsert;
export type ClaimFindingRow = typeof claimFindingsTable.$inferSelect;
export type InsertClaimFinding = typeof claimFindingsTable.$inferInsert;
