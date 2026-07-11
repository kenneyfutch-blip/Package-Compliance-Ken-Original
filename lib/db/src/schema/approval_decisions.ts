import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

// A recorded approval-workflow decision on a package/version.
export const approvalDecisionsTable = pgTable("approval_decisions", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id").notNull(),
  versionId: integer("version_id"),
  // approve | approve_with_comments | needs_revision | reject | escalate
  decision: text("decision").notNull(),
  reviewer: text("reviewer").notNull(),
  reviewerRole: text("reviewer_role"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ApprovalDecisionRow = typeof approvalDecisionsTable.$inferSelect;
export type InsertApprovalDecision =
  typeof approvalDecisionsTable.$inferInsert;
