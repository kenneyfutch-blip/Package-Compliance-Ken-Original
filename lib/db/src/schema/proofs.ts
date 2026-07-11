import {
  pgTable,
  serial,
  text,
  integer,
  real,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { packagesTable } from "./packages";

// A proof is an uploaded artwork file (PNG/JPG/PDF) attached to a package and
// put through collaborative review. Multiple proofs per package = versions.
export const proofsTable = pgTable(
  "proofs",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id"),
    packageId: integer("package_id")
      .notNull()
      .references(() => packagesTable.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    fileName: text("file_name").notNull(),
    objectPath: text("object_path").notNull(),
    contentType: text("content_type").notNull(),
    fileSize: integer("file_size").notNull().default(0),
    pageCount: integer("page_count").notNull().default(1),
    status: text("status").notNull().default("In Review"),
    uploadedById: text("uploaded_by_id"),
    uploadedByName: text("uploaded_by_name").notNull().default("Reviewer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Guards against concurrent uploads producing duplicate version numbers.
  (t) => [unique("proofs_package_version_unique").on(t.packageId, t.version)],
);

// A markup on a proof: a pin (point) or a box (region), normalized 0..1 to the
// rendered image so it scales with any display size.
export const proofAnnotationsTable = pgTable("proof_annotations", {
  id: serial("id").primaryKey(),
  proofId: integer("proof_id")
    .notNull()
    .references(() => proofsTable.id, { onDelete: "cascade" }),
  page: integer("page").notNull().default(1),
  kind: text("kind").notNull().default("pin"),
  x: real("x").notNull(),
  y: real("y").notNull(),
  w: real("w").notNull().default(0),
  h: real("h").notNull().default(0),
  color: text("color").notNull().default("#1F47FF"),
  resolved: boolean("resolved").notNull().default(false),
  authorId: text("author_id"),
  authorName: text("author_name").notNull().default("Reviewer"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// A comment on a proof. If annotationId is set, it belongs to that markup thread;
// otherwise it is a general proof-level comment.
export const proofCommentsTable = pgTable("proof_comments", {
  id: serial("id").primaryKey(),
  proofId: integer("proof_id")
    .notNull()
    .references(() => proofsTable.id, { onDelete: "cascade" }),
  annotationId: integer("annotation_id").references(
    () => proofAnnotationsTable.id,
    { onDelete: "cascade" },
  ),
  body: text("body").notNull(),
  authorId: text("author_id"),
  authorName: text("author_name").notNull().default("Reviewer"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// A reviewer's approval decision on a proof.
export const proofDecisionsTable = pgTable("proof_decisions", {
  id: serial("id").primaryKey(),
  proofId: integer("proof_id")
    .notNull()
    .references(() => proofsTable.id, { onDelete: "cascade" }),
  decision: text("decision").notNull(), // approved | changes_requested | rejected
  note: text("note"),
  reviewerId: text("reviewer_id"),
  reviewerName: text("reviewer_name").notNull().default("Reviewer"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ProofRow = typeof proofsTable.$inferSelect;
export type ProofAnnotationRow = typeof proofAnnotationsTable.$inferSelect;
export type ProofCommentRow = typeof proofCommentsTable.$inferSelect;
export type ProofDecisionRow = typeof proofDecisionsTable.$inferSelect;
