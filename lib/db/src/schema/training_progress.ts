import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Per-user progress across Training Center content: onboarding checklist steps,
// user-guide sections, walkthroughs, and Compliance Academy modules. One row per
// (user, itemKey); the presence of a row means "completed".
export const trainingProgressTable = pgTable(
  "training_progress",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    userId: integer("user_id").notNull(),
    // Stable content identifier, e.g. "checklist:first-review",
    // "academy:regulatory-foundations", "guide:packaging-reviews".
    itemKey: text("item_key").notNull(),
    // Coarse grouping so completion can be rolled up per area without parsing keys.
    itemType: text("item_type").notNull().default("guide"),
    status: text("status").notNull().default("completed"),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userItemUq: uniqueIndex("training_progress_user_item_uq").on(
      t.userId,
      t.itemKey,
    ),
  }),
);

export type TrainingProgressRow = typeof trainingProgressTable.$inferSelect;
export type InsertTrainingProgress = typeof trainingProgressTable.$inferInsert;
