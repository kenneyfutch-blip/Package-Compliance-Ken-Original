import {
  pgTable,
  serial,
  text,
  integer,
  real,
  timestamp,
} from "drizzle-orm/pg-core";

// Markup + comments placed directly on the artwork. Covers human markup
// (pins, highlights, shapes, arrows, strike-throughs, text notes) and
// AI-generated compliance comments, both anchored to normalized coordinates.
export const annotationsTable = pgTable("annotations", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id").notNull(),
  versionId: integer("version_id"),
  // pin | highlight | rectangle | circle | arrow | strikethrough | text
  type: text("type").notNull().default("pin"),
  page: integer("page").notNull().default(0),
  // Normalized 0..1 coordinates relative to the rendered page.
  x: real("x"),
  y: real("y"),
  w: real("w"),
  h: real("h"),
  color: text("color"),
  author: text("author").notNull(),
  authorRole: text("author_role"),
  text: text("text"),
  // low | medium | high | critical
  priority: text("priority").notNull().default("medium"),
  // open | resolved
  status: text("status").notNull().default("open"),
  // human | ai
  source: text("source").notNull().default("human"),
  // AI-specific fields (populated when source = ai)
  confidence: real("confidence"),
  severity: text("severity"),
  regulationRef: text("regulation_ref"),
  suggestedFix: text("suggested_fix"),
  violationId: integer("violation_id"),
  mentions: text("mentions").array().notNull().default([]),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AnnotationRow = typeof annotationsTable.$inferSelect;
export type InsertAnnotation = typeof annotationsTable.$inferInsert;

// Threaded replies on an annotation/comment.
export const commentRepliesTable = pgTable("comment_replies", {
  id: serial("id").primaryKey(),
  annotationId: integer("annotation_id").notNull(),
  author: text("author").notNull(),
  authorRole: text("author_role"),
  text: text("text").notNull(),
  source: text("source").notNull().default("human"),
  mentions: text("mentions").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CommentReplyRow = typeof commentRepliesTable.$inferSelect;
export type InsertCommentReply = typeof commentRepliesTable.$inferInsert;
