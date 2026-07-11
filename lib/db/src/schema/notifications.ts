import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  // Target recipient. Null = an org-wide notification visible to everyone in the
  // org (legacy behavior); set = a per-user notification only that user sees.
  userId: integer("user_id"),
  // Optional package this notification is about, so the UI can deep-link to the
  // relevant review workspace.
  packageId: integer("package_id"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default("info"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type NotificationRow = typeof notificationsTable.$inferSelect;
export type InsertNotification = typeof notificationsTable.$inferInsert;
