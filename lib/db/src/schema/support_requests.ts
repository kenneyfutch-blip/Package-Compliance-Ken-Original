import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// In-platform support tickets raised from the Contact Support page. Users see
// their own; admins (anyone who can manage users) get an org-wide inbox plus a
// per-admin notification when a new request is filed.
export const supportRequestsTable = pgTable(
  "support_requests",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    userId: integer("user_id").notNull(), // requester
    subject: text("subject").notNull(),
    // general | bug | feature | account | billing | training | other
    category: text("category").notNull().default("general"),
    // low | normal | high | urgent
    priority: text("priority").notNull().default("normal"),
    message: text("message").notNull(),
    // open | in_progress | resolved | closed
    status: text("status").notNull().default("open"),
    // Route the user was on when filing, for triage context.
    pageContext: text("page_context"),
    adminResponse: text("admin_response"),
    resolvedByUserId: integer("resolved_by_user_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgStatusIdx: index("support_requests_org_status_idx").on(
      t.organizationId,
      t.status,
    ),
    userIdx: index("support_requests_user_idx").on(t.userId),
  }),
);

export type SupportRequestRow = typeof supportRequestsTable.$inferSelect;
export type InsertSupportRequest = typeof supportRequestsTable.$inferInsert;
