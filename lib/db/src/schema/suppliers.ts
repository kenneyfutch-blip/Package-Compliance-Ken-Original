import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const suppliersTable = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code"),
  category: text("category"),
  riskLevel: text("risk_level").notNull().default("Low"),
  contactEmail: text("contact_email"),
  country: text("country"),
  complianceScore: integer("compliance_score").notNull().default(100),
  packagesReviewed: integer("packages_reviewed").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Supplier = typeof suppliersTable.$inferSelect;
export type InsertSupplier = typeof suppliersTable.$inferInsert;
