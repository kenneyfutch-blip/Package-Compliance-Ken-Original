import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const regulationsTable = pgTable("regulations", {
  id: serial("id").primaryKey(),
  agency: text("agency").notNull(),
  category: text("category").notNull(),
  ruleCode: text("rule_code").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  regulationText: text("regulation_text"),
  section: text("section"),
  source: text("source"),
  publicationDate: text("publication_date"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Regulation = typeof regulationsTable.$inferSelect;
export type InsertRegulation = typeof regulationsTable.$inferInsert;
