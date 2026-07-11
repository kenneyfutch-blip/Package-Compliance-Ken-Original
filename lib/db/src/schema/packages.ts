import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
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
  vendor: text("vendor").notNull(),
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
  reviewer: text("reviewer"),
  artworkUrl: text("artwork_url"),
  summary: text("summary"),
  extractedText: text("extracted_text"),
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
});

export type PackageRow = typeof packagesTable.$inferSelect;
export type InsertPackage = typeof packagesTable.$inferInsert;
