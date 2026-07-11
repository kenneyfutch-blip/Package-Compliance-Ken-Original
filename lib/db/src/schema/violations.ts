import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  real,
} from "drizzle-orm/pg-core";

export const violationsTable = pgTable("violations", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id").notNull(),
  severity: text("severity").notNull(),
  engine: text("engine").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  regulationRef: text("regulation_ref"),
  recommendation: text("recommendation"),
  detectedText: text("detected_text"),
  suggestedText: text("suggested_text"),
  bboxX: real("bbox_x"),
  bboxY: real("bbox_y"),
  bboxW: real("bbox_w"),
  bboxH: real("bbox_h"),
  status: text("status").notNull().default("Open"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ViolationRow = typeof violationsTable.$inferSelect;
export type InsertViolation = typeof violationsTable.$inferInsert;
