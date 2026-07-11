// Local storage + semantic recall for synced eCFR sections. Mirrors the
// Compliance Memory pgvector conventions: the same 512-dim hashed embedder, an
// HNSW cosine index created at startup, and raw-SQL vector queries.

import { db, ecfrSectionsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../logger";
import { embed, toVectorLiteral } from "../memory/embedding";
import type { EcfrParsedSection } from "./parser";

// Create the vector ANN index for eCFR semantic search. Idempotent; non-fatal.
export async function ensureEcfrIndexes(): Promise<void> {
  try {
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_ecfr_embedding ON ecfr_sections USING hnsw (embedding vector_cosine_ops);`,
    );
  } catch (err) {
    logger.error({ err }, "Failed to create ecfr_sections vector index");
  }
}

// Idempotently replace the stored sections for a single (title, part). Done in a
// transaction so a part's rows are swapped atomically; other parts are untouched,
// so a mid-sync failure on one part never wipes the rest.
export async function replacePartSections(params: {
  title: number;
  part: string;
  category: string;
  editionDate: string | null;
  sections: EcfrParsedSection[];
}): Promise<number> {
  const { title, part, category, editionDate, sections } = params;
  if (sections.length === 0) return 0;

  const now = new Date();
  const rows = sections.map((s) => ({
    title: s.title,
    part: s.part,
    section: s.section,
    citation: s.citation,
    heading: s.heading,
    text: s.text,
    categoryTag: category,
    url: s.url,
    editionDate,
    embedding: embed(`${s.heading}. ${s.text}`),
    syncedAt: now,
  }));

  await db.transaction(async (tx) => {
    await tx
      .delete(ecfrSectionsTable)
      .where(
        and(
          eq(ecfrSectionsTable.title, title),
          eq(ecfrSectionsTable.part, part),
        ),
      );
    await tx.insert(ecfrSectionsTable).values(rows);
  });

  return rows.length;
}

export interface EcfrRecalledSection {
  id: number;
  title: number;
  part: string;
  section: string;
  citation: string;
  heading: string;
  text: string;
  categoryTag: string;
  url: string | null;
  editionDate: string | null;
  similarity: number;
}

// Retrieve the eCFR sections most semantically similar to a query, optionally
// restricted to a set of category tags. Global (public federal data) — never
// org-scoped.
export async function retrieveEcfrSections(params: {
  queryText: string;
  categoryTags?: string[] | null;
  limit?: number;
  minSimilarity?: number;
}): Promise<EcfrRecalledSection[]> {
  const {
    queryText,
    categoryTags = null,
    limit = 6,
    minSimilarity = 0.05,
  } = params;
  if (!queryText || !queryText.trim()) return [];

  const literal = toVectorLiteral(embed(queryText));
  const conds = [sql`embedding IS NOT NULL`];
  if (categoryTags && categoryTags.length > 0) {
    const list = sql.join(
      categoryTags.map((t) => sql`${t}`),
      sql`, `,
    );
    conds.push(sql`category_tag IN (${list})`);
  }
  const whereSql = sql.join(conds, sql` AND `);

  const result = await db.execute(sql`
    SELECT id, title, part, section, citation, heading, text, category_tag,
           url, edition_date,
           1 - (embedding <=> ${literal}::vector) AS similarity
    FROM ecfr_sections
    WHERE ${whereSql}
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${limit}
  `);

  const rows =
    (result as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
  return rows
    .map((r) => ({
      id: Number(r["id"]),
      title: Number(r["title"]),
      part: String(r["part"] ?? ""),
      section: String(r["section"] ?? ""),
      citation: String(r["citation"] ?? ""),
      heading: String(r["heading"] ?? ""),
      text: String(r["text"] ?? ""),
      categoryTag: String(r["category_tag"] ?? ""),
      url: (r["url"] as string | null) ?? null,
      editionDate: (r["edition_date"] as string | null) ?? null,
      similarity: Number(r["similarity"] ?? 0),
    }))
    .filter((r) => r.similarity >= minSimilarity);
}

export interface EcfrTitleCount {
  title: number;
  sections: number;
}

export interface EcfrStoredMeta {
  totalSections: number;
  countsByTitle: EcfrTitleCount[];
  lastSyncedAt: string | null;
  editionDate: string | null;
}

// Summary of what is currently synced, for the admin status card.
export async function getEcfrStoredMeta(): Promise<EcfrStoredMeta> {
  const result = await db.execute(sql`
    SELECT title, COUNT(*)::int AS sections,
           MAX(synced_at) AS last_synced,
           MAX(edition_date) AS edition_date
    FROM ecfr_sections
    GROUP BY title
    ORDER BY title
  `);
  const rows =
    (result as unknown as { rows: Record<string, unknown>[] }).rows ?? [];

  let total = 0;
  let lastSyncedAt: string | null = null;
  let editionDate: string | null = null;
  const countsByTitle: EcfrTitleCount[] = rows.map((r) => {
    const sections = Number(r["sections"] ?? 0);
    total += sections;
    const synced =
      r["last_synced"] instanceof Date
        ? (r["last_synced"] as Date).toISOString()
        : r["last_synced"]
          ? String(r["last_synced"])
          : null;
    if (synced && (!lastSyncedAt || synced > lastSyncedAt)) lastSyncedAt = synced;
    const edition = r["edition_date"] ? String(r["edition_date"]) : null;
    if (edition && (!editionDate || edition > editionDate)) editionDate = edition;
    return { title: Number(r["title"]), sections };
  });

  return { totalSections: total, countsByTitle, lastSyncedAt, editionDate };
}
