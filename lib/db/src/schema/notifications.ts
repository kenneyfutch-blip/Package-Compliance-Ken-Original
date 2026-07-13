import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
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
  // Archived notifications are hidden from the default inbox but retained (and
  // restorable) rather than permanently deleted.
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type NotificationRow = typeof notificationsTable.$inferSelect;
export type InsertNotification = typeof notificationsTable.$inferInsert;

// Per-user notification preferences. `mutedTypes` holds notification `type`
// values the user has silenced — muted types are filtered out of their feed and
// unread badge. One row per (organization, user).
export const notificationPreferencesTable = pgTable(
  "notification_preferences",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    userId: integer("user_id").notNull(),
    mutedTypes: jsonb("muted_types").$type<string[]>().notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgUser: uniqueIndex("notification_preferences_org_user_unique").on(
      t.organizationId,
      t.userId,
    ),
  }),
);

export type NotificationPreferenceRow =
  typeof notificationPreferencesTable.$inferSelect;
export type InsertNotificationPreference =
  typeof notificationPreferencesTable.$inferInsert;

// Per-user read/archived/deleted state for a notification. Org-wide
// notifications (notifications.userId IS NULL) are shared across the org, so
// their read/archive/delete state must be tracked PER USER here rather than on
// the shared row — otherwise one user acting on a broadcast would change it for
// everyone. One row per (notification, user).
export const notificationStatesTable = pgTable(
  "notification_states",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    notificationId: integer("notification_id").notNull(),
    userId: integer("user_id").notNull(),
    read: boolean("read").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    // Soft, per-user delete: hides the notification from this user only.
    deleted: boolean("deleted").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    notifUser: uniqueIndex("notification_states_notif_user_unique").on(
      t.notificationId,
      t.userId,
    ),
  }),
);

export type NotificationStateRow = typeof notificationStatesTable.$inferSelect;
export type InsertNotificationState =
  typeof notificationStatesTable.$inferInsert;
