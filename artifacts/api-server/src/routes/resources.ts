import { Router, type IRouter, type Request, type Response } from "express";
import { db, regulationsTable, policiesTable, sopDocumentsTable } from "@workspace/db";
import { and, eq, or, ilike, sql, type SQL } from "drizzle-orm";
import { orgId, hasPermission, requireAnyPermission } from "../lib/rbac/context";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Resource Center — a single specialist-facing hub that unifies every
// compliance reference resource (regulatory libraries, internal SOP rules,
// internal policies/standards, and — reserved for follow-on features — the
// approved-language/glossary library and SOP document store) behind one
// overview and one cross-resource search.
//
// Regulations are global (not org scoped); policies are org scoped. Every read
// only includes the resource types the caller is actually permitted to see.
// ---------------------------------------------------------------------------

// Reserved section keys whose data model does not exist yet. Their search/count
// wiring is present so the follow-on features drop in without re-plumbing.
type ReservedType = "glossary";

function sopHref(id: number): string {
  return `/resources/sop?doc=${id}`;
}

// Does this regulation belong to the Internal SOP library rather than an
// external agency library? Kept in sync with the client-side classifier in
// regulatory-library.tsx so the same rule appears under the same heading.
function isInternalAgency(agency: string | null | undefined): boolean {
  return /internal|sop|dollar tree|brand/i.test(agency ?? "");
}

// Map an agency label to the route segment used by the regulatory library.
function agencyRouteKey(agency: string): string {
  if (isInternalAgency(agency)) return "sop";
  return agency.trim().toLowerCase();
}

function regulationHref(id: number, agency: string): string {
  return `/regulatory/${agencyRouteKey(agency)}?rule=${id}`;
}

function policyHref(id: number): string {
  return `/resources/policies?policy=${id}`;
}

// GET /resources/overview — aggregate counts for every resource group plus the
// per-agency breakdown that drives the regulatory-library cards on the hub.
router.get(
  "/resources/overview",
  requireAnyPermission("regulations:read", "policies:read"),
  async (req: Request, res: Response): Promise<void> => {
    const canRegulations = hasPermission(req, "regulations:read");
    const canPolicies = hasPermission(req, "policies:read");

    let regulatoryCount = 0;
    let internalSopCount = 0;
    const agencyCounts = new Map<string, number>();

    if (canRegulations) {
      const regs = await db
        .select({ id: regulationsTable.id, agency: regulationsTable.agency })
        .from(regulationsTable);
      for (const r of regs) {
        if (isInternalAgency(r.agency)) {
          internalSopCount += 1;
        } else {
          regulatoryCount += 1;
          const key = r.agency || "Other";
          agencyCounts.set(key, (agencyCounts.get(key) ?? 0) + 1);
        }
      }
    }

    let policyCount = 0;
    let sopDocumentCount = 0;
    if (canPolicies) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(policiesTable)
        .where(
          and(
            eq(policiesTable.organizationId, orgId(req)),
            eq(policiesTable.status, "active"),
          ),
        );
      policyCount = row?.count ?? 0;

      const [sopRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(sopDocumentsTable)
        .where(
          and(
            eq(sopDocumentsTable.organizationId, orgId(req)),
            eq(sopDocumentsTable.status, "active"),
          ),
        );
      sopDocumentCount = sopRow?.count ?? 0;
    }

    const groups = [
      {
        type: "regulation",
        label: "Regulatory Libraries",
        description:
          "FDA, EPA, CPSC, FTC and USDA rules that packaging is validated against.",
        count: regulatoryCount,
        href: "/regulations",
        available: canRegulations,
      },
      {
        type: "internal_sop",
        label: "Internal Standards & SOPs",
        description: "Dollar Tree internal standards and standard operating procedures.",
        count: internalSopCount,
        href: "/regulatory/sop",
        available: canRegulations,
      },
      {
        type: "policy",
        label: "Policy Repository",
        description:
          "Internal policies enforced automatically during compliance reviews.",
        count: policyCount,
        href: "/resources/policies",
        available: canPolicies,
      },
      {
        type: "sop_document",
        label: "SOP Documents",
        description: "Uploadable SOP documents with version history and comparison.",
        count: sopDocumentCount,
        href: "/resources/sop",
        available: canPolicies,
      },
      {
        type: "glossary",
        label: "Approved Language & Glossary",
        description: "Pre-approved compliance language and a searchable glossary.",
        count: 0,
        href: "/resources/glossary",
        available: false,
      },
    ];

    const agencyLabels: Record<string, string> = {
      FDA: "FDA Library",
      EPA: "EPA Library",
      CPSC: "CPSC Library",
      FTC: "FTC Library",
      USDA: "USDA Library",
    };
    const agencies = Array.from(agencyCounts.entries())
      .map(([agency, count]) => ({
        agency,
        label: agencyLabels[agency] ?? `${agency} Library`,
        count,
        href: `/regulatory/${agencyRouteKey(agency)}`,
      }))
      .sort((a, b) => b.count - a.count || a.agency.localeCompare(b.agency));

    const total = regulatoryCount + internalSopCount + policyCount;
    res.json({ groups, agencies, total });
  },
);

interface SearchResult {
  type: string;
  typeLabel: string;
  refId: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  category: string | null;
  source: string | null;
  badge: string | null;
  href: string;
  similarity: number | null;
}

// GET /resources/search — one query, ranked results across every resource type.
router.get(
  "/resources/search",
  requireAnyPermission("regulations:read", "policies:read"),
  async (req: Request, res: Response): Promise<void> => {
    const qRaw = req.query["q"];
    const q = typeof qRaw === "string" ? qRaw.trim() : "";
    if (!q) {
      res.status(400).json({ error: "Query 'q' is required" });
      return;
    }

    const typesRaw = req.query["types"];
    const requestedTypes =
      typeof typesRaw === "string" && typesRaw.trim()
        ? new Set(typesRaw.split(",").map((t) => t.trim()).filter(Boolean))
        : null; // null = all types
    const wants = (type: string) => !requestedTypes || requestedTypes.has(type);

    const limitRaw = req.query["limit"];
    const parsedLimit = typeof limitRaw === "string" ? Number(limitRaw) : NaN;
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 50)
        : 20;

    const term = `%${q}%`;
    const results: SearchResult[] = [];

    const canRegulations = hasPermission(req, "regulations:read");
    const canPolicies = hasPermission(req, "policies:read");

    // Regulations power BOTH the external regulatory libraries and the internal
    // SOP library — one table, split by agency into two result types.
    if (canRegulations && (wants("regulation") || wants("internal_sop"))) {
      const regRows = await db
        .select()
        .from(regulationsTable)
        .where(
          or(
            ilike(regulationsTable.title, term),
            ilike(regulationsTable.summary, term),
            ilike(regulationsTable.ruleCode, term),
            ilike(regulationsTable.agency, term),
            ilike(regulationsTable.category, term),
          ),
        )
        .limit(limit);
      for (const r of regRows) {
        const internal = isInternalAgency(r.agency);
        const type = internal ? "internal_sop" : "regulation";
        if (!wants(type)) continue;
        results.push({
          type,
          typeLabel: internal ? "Internal SOP" : "Regulation",
          refId: String(r.id),
          title: r.title,
          subtitle: `${r.agency} · ${r.ruleCode}`,
          description: r.summary,
          category: r.category,
          source: r.source ?? null,
          badge: r.ruleCode,
          href: regulationHref(r.id, r.agency),
          similarity: null,
        });
      }
    }

    // Internal policies / standards (org scoped).
    if (canPolicies && wants("policy")) {
      const policyRows = await db
        .select()
        .from(policiesTable)
        .where(
          and(
            eq(policiesTable.organizationId, orgId(req)),
            or(
              ilike(policiesTable.name, term),
              ilike(policiesTable.summary, term),
              ilike(policiesTable.source, term),
              ilike(policiesTable.category, term),
            ) as SQL,
          ),
        )
        .limit(limit);
      for (const p of policyRows) {
        results.push({
          type: "policy",
          typeLabel: "Policy",
          refId: String(p.id),
          title: p.name,
          subtitle: p.source ?? p.policyType ?? null,
          description: p.summary,
          category: p.category,
          source: p.source ?? null,
          badge: `v${p.version}`,
          href: policyHref(p.id),
          similarity: null,
        });
      }
    }

    // SOP documents (org scoped). Match on title, category, owner, and the text
    // extracted from the current uploaded file so an SOP is findable by content.
    if (canPolicies && wants("sop_document")) {
      const sopRows = await db
        .select()
        .from(sopDocumentsTable)
        .where(
          and(
            eq(sopDocumentsTable.organizationId, orgId(req)),
            eq(sopDocumentsTable.status, "active"),
            or(
              ilike(sopDocumentsTable.title, term),
              ilike(sopDocumentsTable.category, term),
              ilike(sopDocumentsTable.owner, term),
              ilike(sopDocumentsTable.extractedText, term),
            ) as SQL,
          ),
        )
        .limit(limit);
      for (const s of sopRows) {
        results.push({
          type: "sop_document",
          typeLabel: "SOP Document",
          refId: String(s.id),
          title: s.title,
          subtitle: s.owner ?? null,
          description: s.fileName ?? null,
          category: s.category,
          source: s.owner ?? null,
          badge: `v${s.currentVersion}`,
          href: sopHref(s.id),
          similarity: null,
        });
      }
    }

    // Reserved types (glossary): the data model does not exist yet. The wiring is
    // intentionally present so the follow-on feature only needs to add its query
    // here — until then it contributes no results.
    const reserved: ReservedType[] = ["glossary"];
    for (const _t of reserved) {
      if (!wants(_t)) continue;
      // No-op: no records to search yet.
    }

    res.json({ query: q, results: results.slice(0, limit) });
  },
);

export default router;
