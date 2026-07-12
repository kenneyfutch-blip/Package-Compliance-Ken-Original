import {
  pgTable,
  serial,
  text,
  integer,
  real,
  jsonb,
  timestamp,
  index,
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

// Suggested groupings for approved-language / glossary entries. The category
// column is free-form text so an org can add its own, but these drive the UI's
// grouping, filter chips, and defaults.
export const GLOSSARY_CATEGORIES = [
  "Approved Claim",
  "Required Statement",
  "Defined Term",
  "Allergen & Warning",
  "Brand Language",
  "Prohibited Language",
] as const;
export type GlossaryCategory = (typeof GLOSSARY_CATEGORIES)[number];

// The editable Approved Language & Glossary library. An authoritative, org-scoped
// store of the wording reviewers must reuse — required regulatory statements,
// pre-approved marketing claims, allergen/warning phrasings, and defined terms —
// that previously lived only in people's heads and the AI review prompt. Entries
// are browsable/searchable in the Resource Center, and their active values are
// fed into the Language Review Engine so it reasons against approved wording.
// Change tracking is provided by the immutable audit trail (entity_type
// "glossary_entry"), plus createdBy/updatedBy denormalized here for quick display.
export const glossaryEntriesTable = pgTable(
  "glossary_entries",
  {
    id: serial("id").primaryKey(),
    // Tenant scope — every read/write filters on this.
    organizationId: integer("organization_id").notNull(),
    // The term or phrase being defined/approved (e.g. "Non-GMO", "Contains: Soy").
    term: text("term").notNull(),
    // The approved value: the definition, the exact approved phrasing, or the
    // required statement text reviewers should use.
    approvedValue: text("approved_value").notNull(),
    // Grouping (see GLOSSARY_CATEGORIES). Free-form so orgs can extend it.
    category: text("category").notNull().default("Defined Term"),
    // active | retired. Retired entries are hidden from browse/search and are
    // not fed to the review engine, but are retained for audit history.
    status: text("status").notNull().default("active"),
    // Optional guidance for reviewers (when/how to use the approved wording).
    notes: text("notes"),
    // Optional regulatory reference backing the entry (e.g. "FDA 21 CFR 101.9").
    regulatoryReference: text("regulatory_reference"),
    createdBy: text("created_by"),
    createdById: text("created_by_id"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_glossary_org").on(t.organizationId),
    index("idx_glossary_org_status").on(t.organizationId, t.status),
    index("idx_glossary_org_category").on(t.organizationId, t.category),
  ],
);

export type GlossaryEntryRow = typeof glossaryEntriesTable.$inferSelect;
export type InsertGlossaryEntry = typeof glossaryEntriesTable.$inferInsert;
