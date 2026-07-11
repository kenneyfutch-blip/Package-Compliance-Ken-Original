import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

// Master supplier record. `status` drives the lifecycle (Prospective -> Active
// -> Suspended -> Offboarded). The external* fields are reserved linkage points
// for a future CIA master-data integration to become the authoritative source
// of supplier metadata; no external sync is built yet.
export const suppliersTable = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  name: text("name").notNull(),
  code: text("code"),
  category: text("category"),
  riskLevel: text("risk_level").notNull().default("Low"),
  // Prospective | Active | Suspended | Offboarded
  status: text("status").notNull().default("Active"),
  contactEmail: text("contact_email"),
  country: text("country"),
  complianceScore: integer("compliance_score").notNull().default(100),
  packagesReviewed: integer("packages_reviewed").notNull().default(0),
  // Reserved for future external master-data linkage (e.g. CIA). externalSource
  // identifies the system of record; externalId is that system's key.
  externalSource: text("external_source"),
  externalId: text("external_id"),
  externalSyncedAt: timestamp("external_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Structured contacts for a supplier (QA lead, regulatory contact, etc.).
export const supplierContactsTable = pgTable("supplier_contacts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  supplierId: integer("supplier_id").notNull(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  title: text("title"),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// A packaging submission made by (or on behalf of) a supplier and taken through
// an internal review. When a submission is created it can spawn a package for
// the normal compliance pipeline (packageId links the two).
export const supplierSubmissionsTable = pgTable("supplier_submissions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  supplierId: integer("supplier_id").notNull(),
  packageId: integer("package_id"),
  submittedByUserId: integer("submitted_by_user_id"),
  submittedByName: text("submitted_by_name").notNull().default("Supplier"),
  title: text("title").notNull(),
  category: text("category"),
  notes: text("notes"),
  artworkUrl: text("artwork_url"),
  // Submitted | UnderReview | ChangesRequested | Approved | Rejected
  status: text("status").notNull().default("Submitted"),
  reviewerUserId: integer("reviewer_user_id"),
  reviewerName: text("reviewer_name"),
  reviewNotes: text("review_notes"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// A point-in-time performance scorecard recorded for a supplier by an internal
// role. The most recent scorecard's overall score is mirrored onto the supplier
// record for fast list rendering.
export const supplierScorecardsTable = pgTable("supplier_scorecards", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  supplierId: integer("supplier_id").notNull(),
  // Free-form period label, e.g. "2026-Q2" or "June 2026".
  period: text("period").notNull(),
  overallScore: integer("overall_score").notNull().default(0),
  qualityScore: integer("quality_score"),
  complianceScore: integer("compliance_score"),
  timelinessScore: integer("timeliness_score"),
  submissionsCount: integer("submissions_count").notNull().default(0),
  approvedCount: integer("approved_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  notes: text("notes"),
  recordedByUserId: integer("recorded_by_user_id"),
  recordedByName: text("recorded_by_name").notNull().default("System"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Append-only trail of supplier status transitions, so the lifecycle is fully
// auditable independent of the mutable current status on the supplier record.
export const supplierStatusHistoryTable = pgTable("supplier_status_history", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  supplierId: integer("supplier_id").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  reason: text("reason"),
  actorUserId: integer("actor_user_id"),
  actorName: text("actor_name").notNull().default("System"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Supplier = typeof suppliersTable.$inferSelect;
export type InsertSupplier = typeof suppliersTable.$inferInsert;
export type SupplierContactRow = typeof supplierContactsTable.$inferSelect;
export type InsertSupplierContact = typeof supplierContactsTable.$inferInsert;
export type SupplierSubmissionRow = typeof supplierSubmissionsTable.$inferSelect;
export type InsertSupplierSubmission = typeof supplierSubmissionsTable.$inferInsert;
export type SupplierScorecardRow = typeof supplierScorecardsTable.$inferSelect;
export type InsertSupplierScorecard = typeof supplierScorecardsTable.$inferInsert;
export type SupplierStatusHistoryRow = typeof supplierStatusHistoryTable.$inferSelect;
export type InsertSupplierStatusHistory = typeof supplierStatusHistoryTable.$inferInsert;
