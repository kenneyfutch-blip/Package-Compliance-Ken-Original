import {
  pgTable,
  serial,
  text,
  integer,
  real,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

// The six detection layers of the AI Language Review Engine.
export const LANGUAGE_ISSUE_TYPES = [
  "Spelling",
  "Grammar",
  "Context",
  "Regulatory",
  "Marketing Claim",
  "Brand Language",
] as const;
export type LanguageIssueType = (typeof LANGUAGE_ISSUE_TYPES)[number];

// Which downstream authorities a marketing claim may require review from.
export type ClaimReviewFlags = {
  fda?: boolean;
  epa?: boolean;
  ftc?: boolean;
  legal?: boolean;
};

// A single run of the Language Review Engine against a package. Holds the
// aggregate Language Quality Score and per-layer/severity counts so lists,
// dashboards, and bulk views can render without recomputing.
export const languageReviewsTable = pgTable("language_reviews", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  packageId: integer("package_id").notNull(),
  score: integer("score").notNull().default(100),
  confidence: real("confidence"),
  status: text("status").notNull().default("Complete"),
  summary: text("summary"),
  issueCount: integer("issue_count").notNull().default(0),
  criticalCount: integer("critical_count").notNull().default(0),
  majorCount: integer("major_count").notNull().default(0),
  minorCount: integer("minor_count").notNull().default(0),
  spellingCount: integer("spelling_count").notNull().default(0),
  grammarCount: integer("grammar_count").notNull().default(0),
  contextCount: integer("context_count").notNull().default(0),
  regulatoryCount: integer("regulatory_count").notNull().default(0),
  marketingCount: integer("marketing_count").notNull().default(0),
  brandCount: integer("brand_count").notNull().default(0),
  reviewer: text("reviewer"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One language finding produced by the engine, tied to a review + package.
export const languageFindingsTable = pgTable("language_findings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  reviewId: integer("review_id").notNull(),
  packageId: integer("package_id").notNull(),
  issueType: text("issue_type").notNull(),
  severity: text("severity").notNull(),
  originalText: text("original_text"),
  suggestedText: text("suggested_text"),
  reason: text("reason"),
  regulationReference: text("regulation_reference"),
  confidenceScore: real("confidence_score"),
  claimRiskScore: integer("claim_risk_score"),
  reviewFlags: jsonb("review_flags").$type<ClaimReviewFlags | null>(),
  bboxX: real("bbox_x"),
  bboxY: real("bbox_y"),
  bboxW: real("bbox_w"),
  bboxH: real("bbox_h"),
  status: text("status").notNull().default("Open"),
  approvedFix: text("approved_fix"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type LanguageReviewRow = typeof languageReviewsTable.$inferSelect;
export type InsertLanguageReview = typeof languageReviewsTable.$inferInsert;
export type LanguageFindingRow = typeof languageFindingsTable.$inferSelect;
export type InsertLanguageFinding = typeof languageFindingsTable.$inferInsert;
