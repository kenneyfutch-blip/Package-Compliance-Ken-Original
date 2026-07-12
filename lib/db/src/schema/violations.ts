import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  real,
  boolean,
  index,
} from "drizzle-orm/pg-core";
// integer is used for page/counts and real for bbox/confidence.

export const violationsTable = pgTable(
  "violations",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id"),
    packageId: integer("package_id").notNull(),
    severity: text("severity").notNull(),
    engine: text("engine").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    regulationRef: text("regulation_ref"),
    recommendation: text("recommendation"),
    detectedText: text("detected_text"),
    suggestedText: text("suggested_text"),
    // The concrete observed basis for the finding — distinct from `description`
    // (the AI's reasoning): quoted artwork copy, a missing-element observation,
    // or the provided regulation/standard relied on.
    evidence: text("evidence"),
    bboxX: real("bbox_x"),
    bboxY: real("bbox_y"),
    bboxW: real("bbox_w"),
    bboxH: real("bbox_h"),
    page: integer("page").notNull().default(0),
    // AI confidence 0..100 for this finding.
    confidence: real("confidence"),
    // Color-coded proof class: issue (red) | warning (yellow) | passed (green) | recommendation (purple)
    findingClass: text("finding_class").notNull().default("issue"),
    // Review-authority flags for marketing claims: EPA | FDA | FTC | Legal
    claimFlags: text("claim_flags").array().notNull().default([]),
    // True when a human compliance reviewer should confirm before acting
    // (auto-set for high-risk or low-confidence findings).
    humanReviewRecommended: boolean("human_review_recommended")
      .notNull()
      .default(false),
    // Optional per-finding caveat for high-risk / low-confidence findings.
    disclaimer: text("disclaimer"),
    status: text("status").notNull().default("Open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Detail views load every violation for a package.
    index("idx_violations_package").on(t.packageId),
    // Org-scoped aggregation (dashboards, engine/severity breakdowns).
    index("idx_violations_org").on(t.organizationId),
    index("idx_violations_org_engine").on(t.organizationId, t.engine),
    index("idx_violations_org_severity").on(t.organizationId, t.severity),
    index("idx_violations_org_status").on(t.organizationId, t.status),
    // Retention/archival sweeps range-scan by time.
    index("idx_violations_created").on(t.createdAt),
  ],
);

export type ViolationRow = typeof violationsTable.$inferSelect;
export type InsertViolation = typeof violationsTable.$inferInsert;
