import {
  pgTable,
  serial,
  text,
  integer,
  real,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export type OcrData = {
  productName?: string | null;
  ingredients?: string | null;
  directions?: string | null;
  warnings?: string | null;
  claims?: string[];
  marketingCopy?: string | null;
  nutritionFacts?: string | null;
  allergenStatements?: string | null;
  netWeight?: string | null;
  countryOfOrigin?: string | null;
  manufacturerInfo?: string | null;
  expirationDate?: string | null;
  epaRegistrationNumbers?: string | null;
  hazardStatements?: string | null;
};

export const packagesTable = pgTable("packages", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  sku: text("sku").notNull(),
  upc: text("upc"),
  name: text("name").notNull(),
  brand: text("brand").notNull(),
  // Human-readable vendor name, kept for display and legacy filtering. The
  // authoritative link to the master supplier record is supplierId; vendor is
  // denormalized and can drift (e.g. a supplier rename), so authorization and
  // joins must use supplierId, never this string.
  vendor: text("vendor").notNull(),
  // Foreign key to the master supplier record (suppliers.id). Nullable so the
  // column can be added without a backfill window; a startup backfill and the
  // create paths populate it. This is the source of truth for supplier scoping.
  supplierId: integer("supplier_id"),
  category: text("category").notNull().default("Uncategorized"),
  country: text("country"),
  netWeight: text("net_weight"),
  dimensions: text("dimensions"),
  packageType: text("package_type"),
  productType: text("product_type"),
  manufacturingRegion: text("manufacturing_region"),
  status: text("status").notNull().default("Uploaded"),
  grade: text("grade"),
  riskScore: integer("risk_score"),
  complianceStatus: text("compliance_status").notNull().default("Pending"),
  // Approval-workflow state: Pending | Approved | Approved with Comments | Needs Revision | Rejected | Escalated
  approvalStatus: text("approval_status").notNull().default("Pending"),
  reviewer: text("reviewer"),
  artworkUrl: text("artwork_url"),
  summary: text("summary"),
  // One-sentence business/regulatory consequence of shipping as-is, written by
  // the AI analysis engine alongside the executive summary.
  complianceImpact: text("compliance_impact"),
  extractedText: text("extracted_text"),
  // Google Document AI extraction status/metadata, denormalized for fast list
  // rendering. The full cached result lives in document_extractions.
  extractionStatus: text("extraction_status"),
  extractionConfidence: real("extraction_confidence"),
  extractionEngine: text("extraction_engine"),
  extractedAt: timestamp("extracted_at", { withTimezone: true }),
  ocr: jsonb("ocr").$type<OcrData | null>(),
  recommendations: jsonb("recommendations").$type<string[]>().notNull().default([]),
  criticalCount: integer("critical_count").notNull().default(0),
  majorCount: integer("major_count").notNull().default(0),
  minorCount: integer("minor_count").notNull().default(0),
  languageScore: integer("language_score"),
  languageIssueCount: integer("language_issue_count").notNull().default(0),
  languageCriticalCount: integer("language_critical_count").notNull().default(0),
  languageAnalyzedAt: timestamp("language_analyzed_at", { withTimezone: true }),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (t) => [
  // Nearly every read is org-scoped; the composite indexes back the dashboard
  // filters and the paginated package list (which orders by createdAt desc).
  index("idx_packages_org_created").on(t.organizationId, t.createdAt),
  index("idx_packages_org_status").on(t.organizationId, t.status),
  index("idx_packages_org_compliance").on(t.organizationId, t.complianceStatus),
  index("idx_packages_org_category").on(t.organizationId, t.category),
  index("idx_packages_org_vendor").on(t.organizationId, t.vendor),
  index("idx_packages_org_supplier").on(t.organizationId, t.supplierId),
  index("idx_packages_sku").on(t.sku),
]);

export type PackageRow = typeof packagesTable.$inferSelect;
export type InsertPackage = typeof packagesTable.$inferInsert;
