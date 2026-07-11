import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  vector,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { COMPLIANCE_MEMORY_DIM } from "./compliance-memory";

// Dimension of the eCFR section embeddings. Reuses the same self-contained
// hashed embedder as Compliance Memory (see
// artifacts/api-server/src/lib/memory/embedding.ts). If that embedder changes
// dimension this must change with it and the column/index must be recreated.
export const ECFR_SECTION_DIM = COMPLIANCE_MEMORY_DIM;

// Locally-synced sections of the Electronic Code of Federal Regulations (eCFR).
// Full CFR titles are far too large to fetch during a review, so a curated set of
// labeling-relevant parts (Title 21 — FDA; Title 40 — EPA) is synced on a weekly
// background job and recalled semantically at analysis time. This is PUBLIC
// federal data: the table is global (not org-scoped), matching the existing
// hand-seeded `regulations` table.
export const ecfrSectionsTable = pgTable(
  "ecfr_sections",
  {
    id: serial("id").primaryKey(),
    // CFR title number (e.g. 21 for FDA, 40 for EPA).
    title: integer("title").notNull(),
    // CFR part within the title (e.g. "101", "201").
    part: text("part").notNull(),
    // Section number within the part (e.g. "101.9").
    section: text("section").notNull(),
    // Full citation, e.g. "21 CFR 101.9". Unique — the idempotent upsert key.
    citation: text("citation").notNull(),
    heading: text("heading").notNull(),
    // The section body text (bounded on ingest).
    text: text("text").notNull(),
    // Product-category tag derived from the part (food, supplement, drug,
    // cosmetic, pesticide), used to narrow semantic recall to relevant sections.
    categoryTag: text("category_tag").notNull().default("general"),
    // Deep link back into the regulation on ecfr.gov.
    url: text("url"),
    // The CFR edition (issue) date the content was synced from.
    editionDate: text("edition_date"),
    embedding: vector("embedding", { dimensions: ECFR_SECTION_DIM }),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_ecfr_citation").on(t.citation),
    index("idx_ecfr_title_part").on(t.title, t.part),
    index("idx_ecfr_category").on(t.categoryTag),
    index("idx_ecfr_synced").on(t.syncedAt),
  ],
);

export type EcfrSectionRow = typeof ecfrSectionsTable.$inferSelect;
export type InsertEcfrSection = typeof ecfrSectionsTable.$inferInsert;
