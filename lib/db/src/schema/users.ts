import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  // Stable link to the identity provider (Clerk). Null for seed/demo rows that
  // have not signed in yet; set on first authenticated request.
  clerkUserId: text("clerk_user_id").unique(),
  organizationId: integer("organization_id").references(
    () => organizationsTable.id,
  ),
  name: text("name").notNull(),
  email: text("email").notNull(),
  // Machine role key (e.g. "compliance_specialist") used for authorization.
  roleKey: text("role_key").notNull().default("read_only"),
  // Human role label kept in sync with roleKey, for display.
  role: text("role").notNull().default("Read Only User"),
  // Supplier Users are linked to the one supplier whose data they may access.
  supplierId: integer("supplier_id"),
  status: text("status").notNull().default("active"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UserRow = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
