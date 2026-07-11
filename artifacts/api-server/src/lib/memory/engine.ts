import { db, violationsTable, complianceMemoryTable } from "@workspace/db";
import type { PackageRow } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { embed, toVectorLiteral } from "./embedding";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Compliance Memory engine.
//
// Turns every resolved review into reusable institutional knowledge: each finding
// and the fix that resolved it is embedded and stored so future AI reviews can
// semantically recall how similar issues were handled before.
// ---------------------------------------------------------------------------

// A finding's embedding text combines its title, description, offending/suggested
// text and classification so semantically related findings cluster together.
function findingContent(v: {
  title: string;
  description: string;
  detectedText: string | null;
  suggestedText: string | null;
  engine: string;
  regulationRef: string | null;
  category?: string | null;
}): string {
  return [
    v.title,
    v.description,
    v.detectedText ?? "",
    v.suggestedText ?? "",
    v.engine,
    v.regulationRef ?? "",
    v.category ?? "",
  ]
    .filter(Boolean)
    .join(". ");
}

// Idempotently create the ANN index for vector search. HNSW gives fast, accurate
// nearest-neighbour queries and does not require training/data like ivfflat.
export async function ensureMemoryIndexes(): Promise<void> {
  try {
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_cmem_embedding ON compliance_memory USING hnsw (embedding vector_cosine_ops);`,
    );
  } catch (err) {
    logger.error({ err }, "Failed to create compliance_memory vector index");
  }
}

// Capture all of a package's findings into memory when a human review reaches a
// terminal decision. An "Approved" package means its suggested fixes became the
// accepted resolution; "Needs Revision" records the finding but marks the fix as
// not-yet-accepted so it is excluded from institutional recall by default.
//
// Non-fatal by contract: memory capture must never break a review decision.
export async function captureFindingsForDecision(params: {
  organizationId: number;
  pkg: PackageRow;
  decision: string;
  actorName: string;
  actorId: string | null;
}): Promise<void> {
  const { organizationId, pkg, decision } = params;
  const approved = decision === "Approved";

  const violations = await db
    .select()
    .from(violationsTable)
    .where(
      and(
        eq(violationsTable.packageId, pkg.id),
        eq(violationsTable.organizationId, organizationId),
      ),
    );

  // Keep memory in sync with the package's current findings: replace any prior
  // captures for this package (a re-analysis churns violation rows).
  await db
    .delete(complianceMemoryTable)
    .where(
      and(
        eq(complianceMemoryTable.packageId, pkg.id),
        eq(complianceMemoryTable.organizationId, organizationId),
      ),
    );

  if (violations.length === 0) return;

  const rows = violations.map((v) => {
    const content = findingContent({ ...v, category: pkg.category });
    return {
      organizationId,
      packageId: pkg.id,
      violationId: v.id,
      engine: v.engine,
      severity: v.severity,
      category: pkg.category,
      vendor: pkg.vendor,
      regulationRef: v.regulationRef,
      findingTitle: v.title,
      findingText: v.description,
      suggestedFix: v.suggestedText,
      approvedFix: approved ? v.suggestedText : null,
      reviewer: params.actorName,
      reviewerId: params.actorId,
      outcome: decision,
      approvalStatus: approved ? "Approved" : "Rejected",
      content,
      embedding: embed(content),
    };
  });

  await db.insert(complianceMemoryTable).values(rows);
}

export type SimilarFinding = {
  id: number;
  findingTitle: string;
  findingText: string | null;
  suggestedFix: string | null;
  approvedFix: string | null;
  regulationRef: string | null;
  engine: string;
  severity: string;
  category: string;
  vendor: string | null;
  outcome: string | null;
  reviewer: string | null;
  createdAt: string;
  similarity: number;
};

// Retrieve the most semantically similar past *approved* findings for a query.
// Always org-scoped. Optionally excludes a package (so a package doesn't recall
// itself) and enforces a minimum similarity so weak matches are not surfaced.
export async function retrieveSimilarFindings(params: {
  organizationId: number;
  queryText: string;
  limit?: number;
  excludePackageId?: number | null;
  minSimilarity?: number;
  approvedOnly?: boolean;
  // When set, restricts recall to a single supplier's own findings (by vendor).
  // Required for supplier_user callers so one supplier can never see another's
  // findings, even within the same organization.
  supplierName?: string | null;
}): Promise<SimilarFinding[]> {
  const {
    organizationId,
    queryText,
    limit = 5,
    excludePackageId = null,
    minSimilarity = 0.12,
    approvedOnly = true,
    supplierName = null,
  } = params;

  if (!queryText || !queryText.trim()) return [];

  const literal = toVectorLiteral(embed(queryText));

  const conds = [sql`organization_id = ${organizationId}`, sql`embedding IS NOT NULL`];
  if (approvedOnly) conds.push(sql`approval_status = 'Approved'`);
  if (supplierName !== null) conds.push(sql`vendor = ${supplierName}`);
  if (excludePackageId !== null) {
    conds.push(sql`(package_id IS NULL OR package_id <> ${excludePackageId})`);
  }
  const whereSql = sql.join(conds, sql` AND `);

  const result = await db.execute(sql`
    SELECT id, finding_title, finding_text, suggested_fix, approved_fix,
           regulation_ref, engine, severity, category, vendor, outcome, reviewer,
           created_at,
           1 - (embedding <=> ${literal}::vector) AS similarity
    FROM compliance_memory
    WHERE ${whereSql}
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${limit}
  `);

  const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
  return rows
    .map((r) => ({
      id: Number(r["id"]),
      findingTitle: String(r["finding_title"] ?? ""),
      findingText: (r["finding_text"] as string | null) ?? null,
      suggestedFix: (r["suggested_fix"] as string | null) ?? null,
      approvedFix: (r["approved_fix"] as string | null) ?? null,
      regulationRef: (r["regulation_ref"] as string | null) ?? null,
      engine: String(r["engine"] ?? ""),
      severity: String(r["severity"] ?? ""),
      category: String(r["category"] ?? ""),
      vendor: (r["vendor"] as string | null) ?? null,
      outcome: (r["outcome"] as string | null) ?? null,
      reviewer: (r["reviewer"] as string | null) ?? null,
      createdAt:
        r["created_at"] instanceof Date
          ? (r["created_at"] as Date).toISOString()
          : String(r["created_at"] ?? ""),
      similarity: Number(r["similarity"] ?? 0),
    }))
    .filter((r) => r.similarity >= minSimilarity);
}

// Build the text used to query memory for a package under review: its category
// plus the extracted artwork copy (bounded so the query stays focused).
export function packageQueryText(pkg: PackageRow): string {
  const parts = [pkg.category, pkg.productType ?? "", pkg.name];
  if (pkg.extractedText) parts.push(pkg.extractedText.slice(0, 2000));
  return parts.filter(Boolean).join(". ");
}

// Render similar findings as a compact prompt section for the AI review.
export function formatMemoryForPrompt(findings: SimilarFinding[]): string {
  if (findings.length === 0) return "";
  const lines = findings.map((f, i) => {
    const fix = f.approvedFix ?? f.suggestedFix ?? "(no recorded fix)";
    return `${i + 1}. [${f.engine} / ${f.severity}] ${f.findingTitle}${
      f.regulationRef ? ` (Ref: ${f.regulationRef})` : ""
    } — Approved resolution: ${fix}`;
  });
  return lines.join("\n");
}
