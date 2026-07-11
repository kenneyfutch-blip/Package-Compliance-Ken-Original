import {
  pgTable,
  serial,
  text,
  integer,
  real,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { packagesTable } from "./packages";
import { proofsTable } from "./proofs";

// The canonical taxonomy of packaging components Google Document AI (and, in the
// future, specialized custom extractors) is expected to identify. Kept as a
// const so extraction, storage, and the UI all agree on the same labels.
export const DOCUMENT_COMPONENT_TYPES = [
  "Product Name",
  "Ingredients",
  "Nutrition Facts",
  "Warnings",
  "Directions",
  "Claims",
  "Allergen Statements",
  "Manufacturer Information",
  "Country Of Origin",
  "Net Weight",
  "Lot Codes",
  "Expiration Dates",
  "EPA Registration Numbers",
  "Hazard Statements",
  "Barcode Regions",
] as const;

export type DocumentComponentType = (typeof DOCUMENT_COMPONENT_TYPES)[number];

// A normalized bounding region (0..1 relative to the page) captured by Document AI.
export type ExtractionBbox = { x: number; y: number; w: number; h: number };

// A text block on a page with its location + confidence.
export type ExtractionBlock = {
  text: string;
  confidence: number | null;
  bbox: ExtractionBbox | null;
};

// A single processed page: dimensions + the blocks Document AI found on it.
export type ExtractionPage = {
  pageNumber: number;
  width: number;
  height: number;
  blocks: ExtractionBlock[];
};

// An identified packaging component. `source` distinguishes ML entities returned
// by Document AI from deterministic pattern matches we derive from the OCR text.
export type ExtractedComponent = {
  type: string;
  text: string;
  confidence: number | null;
  page: number | null;
  bbox: ExtractionBbox | null;
  source: "documentai" | "heuristic";
};

export type ExtractionStatus =
  | "Pending"
  | "Processing"
  | "Complete"
  | "Failed";

// Cached Google Document AI results for a package (and, when applicable, a
// specific proof/version). We never re-run Document AI while a cached result for
// the same source document exists — this table IS that cache.
export const documentExtractionsTable = pgTable("document_extractions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  packageId: integer("package_id")
    .notNull()
    .references(() => packagesTable.id, { onDelete: "cascade" }),
  // The proof/version this extraction was run against, when triggered by a
  // version upload. Null for the package's original artwork.
  proofId: integer("proof_id").references(() => proofsTable.id, {
    onDelete: "cascade",
  }),
  version: integer("version").notNull().default(1),
  // SHA-256 of the source document bytes — the cache key for "has the source
  // document changed?". Same hash + Complete status => never re-run.
  sourceHash: text("source_hash").notNull(),
  sourceType: text("source_type").notNull().default("artwork"),
  sourceName: text("source_name"),
  status: text("status").notNull().default("Pending").$type<ExtractionStatus>(),
  engine: text("engine").notNull().default("google-document-ai"),
  processor: text("processor"),
  text: text("text"),
  pages: jsonb("pages").$type<ExtractionPage[]>().notNull().default([]),
  components: jsonb("components")
    .$type<ExtractedComponent[]>()
    .notNull()
    .default([]),
  confidence: real("confidence"),
  pageCount: integer("page_count").notNull().default(0),
  error: text("error"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type DocumentExtractionRow = typeof documentExtractionsTable.$inferSelect;
export type InsertDocumentExtraction =
  typeof documentExtractionsTable.$inferInsert;
