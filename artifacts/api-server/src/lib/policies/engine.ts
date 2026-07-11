import { db, policiesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { embed, toVectorLiteral } from "../memory/embedding";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Internal Policy & Standards engine.
//
// Semantic recall over company-specific standards so a package under review is
// validated against the internal policies most relevant to it — giving internal
// standards equal authority to external regulations. Mirrors the compliance
// memory engine (shared hashed embedder + pgvector cosine search).
// ---------------------------------------------------------------------------

// Idempotently create the pgvector extension + ANN index for policy search.
export async function ensurePolicyIndexes(): Promise<void> {
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector;`);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_policies_embedding ON policies USING hnsw (embedding vector_cosine_ops);`,
    );
  } catch (err) {
    logger.error({ err }, "Failed to create policies vector index");
  }
}

// The text embedded for a policy: name + classification + authored rule text +
// (bounded) extracted document text so semantically related policies cluster.
export function policyEmbedText(p: {
  name: string;
  category?: string | null;
  policyType?: string | null;
  source?: string | null;
  summary?: string | null;
  tags?: string[] | null;
  extractedText?: string | null;
}): string {
  return [
    p.name,
    p.category ?? "",
    p.policyType ?? "",
    p.source ?? "",
    (p.tags ?? []).join(" "),
    p.summary ?? "",
    (p.extractedText ?? "").slice(0, 4000),
  ]
    .filter(Boolean)
    .join(". ");
}

export type RelevantPolicy = {
  id: number;
  name: string;
  category: string;
  policyType: string | null;
  source: string | null;
  summary: string | null;
  defaultSeverity: string;
  effectiveDate: string | null;
  expirationDate: string | null;
  version: number;
  similarity: number;
};

// Retrieve the policies most semantically similar to a query. Always org-scoped.
// By default only enforceable policies are returned: status = active and (when
// set) within their effective/expiration window.
export async function retrieveRelevantPolicies(params: {
  organizationId: number;
  queryText: string;
  limit?: number;
  minSimilarity?: number;
  activeOnly?: boolean;
}): Promise<RelevantPolicy[]> {
  const {
    organizationId,
    queryText,
    limit = 6,
    minSimilarity = 0.1,
    activeOnly = true,
  } = params;

  if (!queryText || !queryText.trim()) return [];

  const literal = toVectorLiteral(embed(queryText));
  const today = new Date().toISOString().slice(0, 10);

  const conds = [
    sql`organization_id = ${organizationId}`,
    sql`embedding IS NOT NULL`,
  ];
  if (activeOnly) {
    conds.push(sql`status = 'active'`);
    conds.push(
      sql`(expiration_date IS NULL OR expiration_date = '' OR expiration_date >= ${today})`,
    );
    conds.push(
      sql`(effective_date IS NULL OR effective_date = '' OR effective_date <= ${today})`,
    );
  }
  const whereSql = sql.join(conds, sql` AND `);

  const result = await db.execute(sql`
    SELECT id, name, category, policy_type, source, summary, default_severity,
           effective_date, expiration_date, version,
           1 - (embedding <=> ${literal}::vector) AS similarity
    FROM policies
    WHERE ${whereSql}
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${limit}
  `);

  const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
  return rows
    .map((r) => ({
      id: Number(r["id"]),
      name: String(r["name"] ?? ""),
      category: String(r["category"] ?? ""),
      policyType: (r["policy_type"] as string | null) ?? null,
      source: (r["source"] as string | null) ?? null,
      summary: (r["summary"] as string | null) ?? null,
      defaultSeverity: String(r["default_severity"] ?? "major"),
      effectiveDate: (r["effective_date"] as string | null) ?? null,
      expirationDate: (r["expiration_date"] as string | null) ?? null,
      version: Number(r["version"] ?? 1),
      similarity: Number(r["similarity"] ?? 0),
    }))
    .filter((r) => r.similarity >= minSimilarity);
}

// Render relevant policies as a compact prompt section for the AI review. The
// authored rule text is the instruction the model applies; source/name are cited
// back on any violation the model raises.
export function formatPoliciesForPrompt(policies: RelevantPolicy[]): string {
  if (policies.length === 0) return "";
  return policies
    .map((p, i) => {
      const rule = p.summary?.trim() || "(refer to the attached policy document)";
      const src = p.source?.trim() || p.name;
      return `${i + 1}. [${p.category} / ${p.defaultSeverity}] ${p.name} (Source: ${src}) — Rule: ${rule}`;
    })
    .join("\n");
}
