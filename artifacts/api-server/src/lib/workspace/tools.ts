import type { Request } from "express";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  packagesTable,
  violationsTable,
  reviewTasksTable,
  specialistProfilesTable,
  suppliersTable,
  reportsTable,
  regulationsTable,
  sopDocumentsTable,
  auditEventsTable,
} from "@workspace/db";
import { getAuthContext, hasPermission } from "../rbac/context";
import { packageConds } from "../rbac/scope";
import { retrieveSimilarFindings } from "../memory/engine";
import { retrieveEcfrSections } from "../ecfr/engine";
import { fetchRecalls } from "../fda";
import { RECALL_CATEGORIES, type RecallCategory } from "../fda/datasets";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Workspace read-tool layer
//
// A registry of server-side, READ-ONLY data tools the AI Workspace model may
// call to ground its answers in the user's real platform data. Every tool
// resolves the caller's identity server-side (via the request's auth context)
// and filters strictly by organization + RBAC + supplier isolation, reusing the
// same scoping helpers the REST routes use. Suppliers only ever see their own
// data; no tool can reach another organization's data or admin/secret material.
//
// Each tool returns a compact text block for the model AND structured citations
// so the UI can render source links back into the app (hrefs stay within the
// app's own route space — the allowlist pattern).
// ---------------------------------------------------------------------------

export type WorkspaceCitation = {
  type: string;
  id: number | string;
  label: string;
  href: string | null;
};

export type ToolResult = {
  text: string;
  citations: WorkspaceCitation[];
};

type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type WorkspaceTool = {
  name: string;
  description: string;
  parameters: JsonSchema;
  // Permission keys the caller must ALL hold for this tool to be offered.
  requiredPerms: string[];
  // Whether a supplier_user may EVER use this tool. Set false for org-wide
  // internal resources (specialist directory, reports, SOPs, audit trail) whose
  // query is scoped by organization only — those are not supplier-scoped, so
  // they must never be offered to a supplier even if a misconfigured role grants
  // the underlying read permission. Supplier-scoped tools (package/supplier/
  // memory backed) and non-tenant reference tools (regulations, recalls) are safe.
  supplierSafe: boolean;
  execute: (req: Request, args: Record<string, unknown>) => Promise<ToolResult>;
};

// --- small helpers ---------------------------------------------------------

function clampLimit(raw: unknown, def = 8, max = 15): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

function str(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length ? t : null;
}

function likeTerm(v: string): string {
  return `%${v.replace(/[%_]/g, (m) => `\\${m}`)}%`;
}

// Supplier-scoped conditions for the suppliers table (mirrors the suppliers
// route's supplierConds without importing across route boundaries): org scope
// for everyone, and supplier users restricted to their own supplier row.
function supplierScopeConds(req: Request): SQL[] {
  const ctx = getAuthContext(req);
  const conds: SQL[] = [eq(suppliersTable.organizationId, ctx.organizationId)];
  if (ctx.roleKey === "supplier_user") {
    conds.push(eq(suppliersTable.id, ctx.supplierId ?? -1));
  }
  return conds;
}

// --- tools -----------------------------------------------------------------

const searchPackages: WorkspaceTool = {
  name: "search_packages",
  supplierSafe: true,
  description:
    "Search the user's packaging assets (packages) by name, SKU, brand or vendor, optionally filtered by status or category. Returns compliance status, risk score and grade for each. Use to find packages or answer questions about the portfolio.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free-text match on name/SKU/brand/vendor." },
      status: { type: "string", description: "Filter by compliance status e.g. Passed, Failed, Needs Review." },
      category: { type: "string", description: "Filter by product category." },
      limit: { type: "integer", description: "Max results (default 8, max 15)." },
    },
    additionalProperties: false,
  },
  requiredPerms: ["packages:read"],
  async execute(req, args) {
    const limit = clampLimit(args["limit"]);
    const conds = packageConds(req);
    const q = str(args["query"]);
    if (q) {
      const t = likeTerm(q);
      conds.push(
        or(
          ilike(packagesTable.name, t),
          ilike(packagesTable.sku, t),
          ilike(packagesTable.brand, t),
          ilike(packagesTable.vendor, t),
        )!,
      );
    }
    const status = str(args["status"]);
    if (status) conds.push(ilike(packagesTable.complianceStatus, likeTerm(status)));
    const category = str(args["category"]);
    if (category) conds.push(ilike(packagesTable.category, likeTerm(category)));

    const rows = await db
      .select({
        id: packagesTable.id,
        name: packagesTable.name,
        sku: packagesTable.sku,
        brand: packagesTable.brand,
        vendor: packagesTable.vendor,
        category: packagesTable.category,
        status: packagesTable.complianceStatus,
        riskScore: packagesTable.riskScore,
        grade: packagesTable.grade,
      })
      .from(packagesTable)
      .where(and(...conds))
      .orderBy(desc(packagesTable.updatedAt))
      .limit(limit);

    if (rows.length === 0) return { text: "No matching packages.", citations: [] };
    const text = rows
      .map(
        (r) =>
          `- [#${r.id}] ${r.name} (SKU ${r.sku}) — ${r.brand ?? "?"} / ${r.vendor ?? "?"} — category ${r.category ?? "?"} — status ${r.status ?? "?"}, risk ${r.riskScore ?? "?"}, grade ${r.grade ?? "?"}`,
      )
      .join("\n");
    return {
      text,
      citations: rows.map((r) => ({
        type: "package",
        id: r.id,
        label: `${r.name} (${r.sku})`,
        href: `/reviews/${r.id}`,
      })),
    };
  },
};

const getPackageDetails: WorkspaceTool = {
  name: "get_package_details",
  supplierSafe: true,
  description:
    "Get full detail for one package by id: metadata, compliance status/risk/grade, executive summary, and its detected findings/violations (severity, engine, regulation ref). Use when the user asks about a specific package or its issues.",
  parameters: {
    type: "object",
    properties: { packageId: { type: "integer", description: "The package id." } },
    required: ["packageId"],
    additionalProperties: false,
  },
  requiredPerms: ["packages:read"],
  async execute(req, args) {
    const id = Number(args["packageId"]);
    if (!Number.isFinite(id)) return { text: "Invalid packageId.", citations: [] };
    const [pkg] = await db
      .select()
      .from(packagesTable)
      .where(and(eq(packagesTable.id, id), ...packageConds(req)))
      .limit(1);
    if (!pkg) return { text: `No package #${id} accessible to you.`, citations: [] };

    const findings = await db
      .select({
        severity: violationsTable.severity,
        engine: violationsTable.engine,
        title: violationsTable.title,
        regulationRef: violationsTable.regulationRef,
        findingClass: violationsTable.findingClass,
        status: violationsTable.status,
      })
      .from(violationsTable)
      .where(eq(violationsTable.packageId, id))
      .orderBy(desc(violationsTable.confidence))
      .limit(25);

    const header = [
      `Package #${pkg.id}: ${pkg.name} (SKU ${pkg.sku})`,
      `Brand ${pkg.brand ?? "?"} / Vendor ${pkg.vendor ?? "?"} — category ${pkg.category ?? "?"}, type ${pkg.productType ?? "?"}`,
      `Compliance: ${pkg.complianceStatus ?? "?"} | risk ${pkg.riskScore ?? "?"} | grade ${pkg.grade ?? "?"} | approval ${pkg.approvalStatus ?? "?"}`,
      `Counts — critical ${pkg.criticalCount ?? 0}, major ${pkg.majorCount ?? 0}, minor ${pkg.minorCount ?? 0}`,
      pkg.summary ? `Summary: ${pkg.summary}` : null,
      pkg.complianceImpact ? `Impact: ${pkg.complianceImpact}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const findingsText = findings.length
      ? "\nFindings:\n" +
        findings
          .map(
            (f) =>
              `  - [${f.severity}/${f.findingClass}] ${f.engine}: ${f.title}${f.regulationRef ? ` (${f.regulationRef})` : ""}${f.status ? ` — ${f.status}` : ""}`,
          )
          .join("\n")
      : "\nNo recorded findings.";

    return {
      text: header + findingsText,
      citations: [
        {
          type: "package",
          id: pkg.id,
          label: `${pkg.name} (${pkg.sku})`,
          href: `/reviews/${pkg.id}`,
        },
      ],
    };
  },
};

const searchFindings: WorkspaceTool = {
  name: "search_findings",
  supplierSafe: true,
  description:
    "Search compliance findings/violations across the user's packages, filtered by severity, engine (e.g. FDA, EPA, Spelling & Grammar) or free text. Use for portfolio-wide questions like 'all critical FDA findings'.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      severity: { type: "string", description: "critical | major | minor | informational" },
      engine: { type: "string" },
      limit: { type: "integer" },
    },
    additionalProperties: false,
  },
  requiredPerms: ["violations:read"],
  async execute(req, args) {
    const limit = clampLimit(args["limit"]);
    // Join to packages so package-level org + supplier scoping applies to findings.
    const conds = packageConds(req);
    const severity = str(args["severity"]);
    if (severity) conds.push(eq(violationsTable.severity, severity));
    const engine = str(args["engine"]);
    if (engine) conds.push(ilike(violationsTable.engine, likeTerm(engine)));
    const q = str(args["query"]);
    if (q) {
      const t = likeTerm(q);
      conds.push(
        or(ilike(violationsTable.title, t), ilike(violationsTable.description, t))!,
      );
    }
    const rows = await db
      .select({
        id: violationsTable.id,
        packageId: violationsTable.packageId,
        packageName: packagesTable.name,
        severity: violationsTable.severity,
        engine: violationsTable.engine,
        title: violationsTable.title,
        regulationRef: violationsTable.regulationRef,
      })
      .from(violationsTable)
      .innerJoin(packagesTable, eq(violationsTable.packageId, packagesTable.id))
      .where(and(...conds))
      .orderBy(desc(violationsTable.createdAt))
      .limit(limit);

    if (rows.length === 0) return { text: "No matching findings.", citations: [] };
    const text = rows
      .map(
        (r) =>
          `- [${r.severity}] ${r.engine}: ${r.title}${r.regulationRef ? ` (${r.regulationRef})` : ""} — on ${r.packageName} (#${r.packageId})`,
      )
      .join("\n");
    const seen = new Set<number>();
    const citations: WorkspaceCitation[] = [];
    for (const r of rows) {
      if (r.packageId != null && !seen.has(r.packageId)) {
        seen.add(r.packageId);
        citations.push({
          type: "package",
          id: r.packageId,
          label: r.packageName ?? `Package #${r.packageId}`,
          href: `/reviews/${r.packageId}`,
        });
      }
    }
    return { text, citations };
  },
};

const searchRegulations: WorkspaceTool = {
  name: "search_regulations",
  supplierSafe: true,
  description:
    "Search the internal regulatory knowledge base (curated FDA/FTC/USDA/EPA/CPSC rules and internal standards) by text, agency or category. Returns rule code, title and summary.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      agency: { type: "string" },
      category: { type: "string" },
      limit: { type: "integer" },
    },
    additionalProperties: false,
  },
  requiredPerms: ["regulations:read"],
  async execute(_req, args) {
    const limit = clampLimit(args["limit"]);
    const conds: SQL[] = [];
    const q = str(args["query"]);
    if (q) {
      const t = likeTerm(q);
      conds.push(
        or(
          ilike(regulationsTable.title, t),
          ilike(regulationsTable.summary, t),
          ilike(regulationsTable.ruleCode, t),
        )!,
      );
    }
    const agency = str(args["agency"]);
    if (agency) conds.push(ilike(regulationsTable.agency, likeTerm(agency)));
    const category = str(args["category"]);
    if (category) conds.push(ilike(regulationsTable.category, likeTerm(category)));

    const rows = await db
      .select({
        id: regulationsTable.id,
        agency: regulationsTable.agency,
        ruleCode: regulationsTable.ruleCode,
        title: regulationsTable.title,
        category: regulationsTable.category,
        section: regulationsTable.section,
        summary: regulationsTable.summary,
      })
      .from(regulationsTable)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(regulationsTable.id))
      .limit(limit);

    if (rows.length === 0) return { text: "No matching regulations.", citations: [] };
    const text = rows
      .map(
        (r) =>
          `- [${r.agency} ${r.ruleCode}${r.section ? ` §${r.section}` : ""}] ${r.title} (${r.category}): ${r.summary}`,
      )
      .join("\n");
    return {
      text,
      citations: rows.map((r) => ({
        type: "regulation",
        id: r.id,
        label: `${r.agency} ${r.ruleCode}`,
        href: `/regulations`,
      })),
    };
  },
};

const searchFederalRegulations: WorkspaceTool = {
  name: "search_federal_regulations",
  supplierSafe: true,
  description:
    "Semantically search the live federal eCFR (Electronic Code of Federal Regulations, Title 21 FDA / Title 40 EPA) for verbatim regulatory text relevant to a plain-English question.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Plain-English regulatory question." },
      limit: { type: "integer" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  requiredPerms: ["regulations:read"],
  async execute(_req, args) {
    const q = str(args["query"]);
    if (!q) return { text: "A query is required.", citations: [] };
    const limit = clampLimit(args["limit"], 5, 8);
    try {
      const sections = await retrieveEcfrSections({ queryText: q, limit });
      if (!sections.length)
        return { text: "No matching eCFR sections.", citations: [] };
      const text = sections
        .map((s: any) => {
          const cite = s.citation ?? s.section ?? s.ref ?? "eCFR";
          const heading = s.heading ?? s.title ?? "";
          const body = (s.text ?? s.content ?? "").slice(0, 600);
          return `- ${cite} ${heading}: ${body}`;
        })
        .join("\n");
      return { text, citations: [{ type: "regulation", id: "ecfr", label: "eCFR sections", href: "/regulations" }] };
    } catch (err) {
      logger.warn({ err }, "workspace tool search_federal_regulations failed");
      return { text: "Live eCFR lookup is unavailable right now.", citations: [] };
    }
  },
};

const searchComplianceMemory: WorkspaceTool = {
  name: "search_compliance_memory",
  supplierSafe: true,
  description:
    "Semantically recall how similar compliance findings were resolved before (institutional Compliance Memory): the finding, the approved fix and the reviewer outcome. Use to answer 'how did we handle X before'.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "integer" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  requiredPerms: ["violations:read"],
  async execute(req, args) {
    const q = str(args["query"]);
    if (!q) return { text: "A query is required.", citations: [] };
    const ctx = getAuthContext(req);
    const limit = clampLimit(args["limit"], 5, 10);
    try {
      const findings = await retrieveSimilarFindings({
        organizationId: ctx.organizationId,
        queryText: q,
        limit,
        // Supplier users are isolated to their own supplier's memory.
        supplierId: ctx.roleKey === "supplier_user" ? ctx.supplierId ?? -1 : null,
      });
      if (!findings.length)
        return { text: "No similar past findings in Compliance Memory.", citations: [] };
      const text = findings
        .map((f: any) => {
          const title = f.findingTitle ?? f.title ?? "Finding";
          const fix = f.approvedFix ?? f.suggestedFix ?? "";
          const eng = f.engine ? `[${f.engine}] ` : "";
          return `- ${eng}${title}${fix ? ` → fix: ${fix}` : ""}`;
        })
        .join("\n");
      return {
        text,
        citations: [{ type: "memory", id: "memory", label: "Compliance Memory", href: "/ai/memory" }],
      };
    } catch (err) {
      logger.warn({ err }, "workspace tool search_compliance_memory failed");
      return { text: "Compliance Memory lookup is unavailable right now.", citations: [] };
    }
  },
};

const listSpecialistsTool: WorkspaceTool = {
  name: "list_specialists",
  supplierSafe: false,
  description:
    "List compliance specialists in the directory (name, role, department, expertise, availability, approval authority). Use to answer routing/staffing questions like 'who can review an FDA food label' or 'who is available'.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Match on name, job title or expertise text." },
      availableOnly: { type: "boolean" },
      approvalAuthority: { type: "boolean" },
      limit: { type: "integer" },
    },
    additionalProperties: false,
  },
  requiredPerms: ["specialists:read"],
  async execute(req, args) {
    const ctx = getAuthContext(req);
    const limit = clampLimit(args["limit"]);
    const conds: SQL[] = [eq(specialistProfilesTable.organizationId, ctx.organizationId)];
    if (args["availableOnly"] === true)
      conds.push(eq(specialistProfilesTable.acceptingAssignments, true));
    if (args["approvalAuthority"] === true)
      conds.push(eq(specialistProfilesTable.approvalAuthority, true));
    const q = str(args["query"]);
    if (q) {
      const t = likeTerm(q);
      conds.push(
        or(
          ilike(specialistProfilesTable.name, t),
          ilike(specialistProfilesTable.jobTitle, t),
          sql`${specialistProfilesTable.expertise}::text ILIKE ${t}`,
        )!,
      );
    }
    const rows = await db
      .select({
        id: specialistProfilesTable.id,
        name: specialistProfilesTable.name,
        jobTitle: specialistProfilesTable.jobTitle,
        status: specialistProfilesTable.status,
        accepting: specialistProfilesTable.acceptingAssignments,
        approvalAuthority: specialistProfilesTable.approvalAuthority,
        escalationLevel: specialistProfilesTable.escalationLevel,
        expertise: specialistProfilesTable.expertise,
      })
      .from(specialistProfilesTable)
      .where(and(...conds))
      .orderBy(desc(specialistProfilesTable.routingPriority))
      .limit(limit);

    if (rows.length === 0) return { text: "No matching specialists.", citations: [] };
    const text = rows
      .map((r) => {
        const exp = Array.isArray(r.expertise) ? (r.expertise as string[]).join(", ") : "";
        return `- ${r.name}${r.jobTitle ? `, ${r.jobTitle}` : ""} — ${r.status ?? "?"}${r.accepting ? ", accepting" : ", not accepting"}${r.approvalAuthority ? ", approval authority" : ""}${exp ? ` — expertise: ${exp}` : ""}`;
      })
      .join("\n");
    return {
      text,
      citations: rows.map((r) => ({
        type: "specialist",
        id: r.id,
        label: r.name,
        href: `/operations/specialists`,
      })),
    };
  },
};

const searchTasks: WorkspaceTool = {
  name: "search_tasks",
  supplierSafe: true,
  description:
    "Search review tasks (the work queue) filtered by status or priority. Returns title, status, priority, assignee, due date and the package each is on.",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string" },
      priority: { type: "string" },
      limit: { type: "integer" },
    },
    additionalProperties: false,
  },
  requiredPerms: ["packages:read"],
  async execute(req, args) {
    const limit = clampLimit(args["limit"]);
    // Scope via the owning package (org + supplier isolation).
    const conds = packageConds(req);
    const status = str(args["status"]);
    if (status) conds.push(ilike(reviewTasksTable.status, likeTerm(status)));
    const priority = str(args["priority"]);
    if (priority) conds.push(ilike(reviewTasksTable.priority, likeTerm(priority)));

    const rows = await db
      .select({
        id: reviewTasksTable.id,
        title: reviewTasksTable.title,
        status: reviewTasksTable.status,
        priority: reviewTasksTable.priority,
        assignee: reviewTasksTable.assignee,
        dueDate: reviewTasksTable.dueDate,
        packageId: reviewTasksTable.packageId,
        packageName: packagesTable.name,
      })
      .from(reviewTasksTable)
      .innerJoin(packagesTable, eq(reviewTasksTable.packageId, packagesTable.id))
      .where(and(...conds))
      .orderBy(desc(reviewTasksTable.createdAt))
      .limit(limit);

    if (rows.length === 0) return { text: "No matching tasks.", citations: [] };
    const text = rows
      .map(
        (r) =>
          `- ${r.title} — ${r.status ?? "?"}/${r.priority ?? "?"}${r.assignee ? `, assignee ${r.assignee}` : ""}${r.dueDate ? `, due ${r.dueDate}` : ""} — on ${r.packageName} (#${r.packageId})`,
      )
      .join("\n");
    const seen = new Set<number>();
    const citations: WorkspaceCitation[] = [];
    for (const r of rows) {
      if (r.packageId != null && !seen.has(r.packageId)) {
        seen.add(r.packageId);
        citations.push({
          type: "package",
          id: r.packageId,
          label: r.packageName ?? `Package #${r.packageId}`,
          href: `/reviews/${r.packageId}`,
        });
      }
    }
    return { text, citations };
  },
};

const listSuppliers: WorkspaceTool = {
  name: "list_suppliers",
  supplierSafe: true,
  description:
    "List suppliers/vendors (name, category, risk level, status, compliance score). Use for vendor questions like 'which suppliers are high risk'.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      status: { type: "string" },
      riskLevel: { type: "string" },
      limit: { type: "integer" },
    },
    additionalProperties: false,
  },
  requiredPerms: ["suppliers:read"],
  async execute(req, args) {
    const limit = clampLimit(args["limit"]);
    const conds = supplierScopeConds(req);
    const q = str(args["query"]);
    if (q) conds.push(ilike(suppliersTable.name, likeTerm(q)));
    const status = str(args["status"]);
    if (status) conds.push(ilike(suppliersTable.status, likeTerm(status)));
    const risk = str(args["riskLevel"]);
    if (risk) conds.push(ilike(suppliersTable.riskLevel, likeTerm(risk)));

    const rows = await db
      .select({
        id: suppliersTable.id,
        name: suppliersTable.name,
        category: suppliersTable.category,
        riskLevel: suppliersTable.riskLevel,
        status: suppliersTable.status,
        complianceScore: suppliersTable.complianceScore,
      })
      .from(suppliersTable)
      .where(and(...conds))
      .orderBy(desc(suppliersTable.updatedAt))
      .limit(limit);

    if (rows.length === 0) return { text: "No matching suppliers.", citations: [] };
    const text = rows
      .map(
        (r) =>
          `- ${r.name}${r.category ? ` (${r.category})` : ""} — risk ${r.riskLevel ?? "?"}, status ${r.status ?? "?"}, score ${r.complianceScore ?? "?"}`,
      )
      .join("\n");
    return {
      text,
      citations: rows.map((r) => ({
        type: "supplier",
        id: r.id,
        label: r.name,
        href: `/suppliers`,
      })),
    };
  },
};

const listReports: WorkspaceTool = {
  name: "list_reports",
  supplierSafe: false,
  description:
    "List generated compliance reports (title, type, summary). Use to find or reference existing reports.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      type: { type: "string" },
      limit: { type: "integer" },
    },
    additionalProperties: false,
  },
  requiredPerms: ["reports:read"],
  async execute(req, args) {
    const ctx = getAuthContext(req);
    const limit = clampLimit(args["limit"]);
    const conds: SQL[] = [eq(reportsTable.organizationId, ctx.organizationId)];
    const q = str(args["query"]);
    if (q) conds.push(ilike(reportsTable.title, likeTerm(q)));
    const type = str(args["type"]);
    if (type) conds.push(ilike(reportsTable.type, likeTerm(type)));

    const rows = await db
      .select({
        id: reportsTable.id,
        title: reportsTable.title,
        type: reportsTable.type,
        summary: reportsTable.summary,
      })
      .from(reportsTable)
      .where(and(...conds))
      .orderBy(desc(reportsTable.createdAt))
      .limit(limit);

    if (rows.length === 0) return { text: "No matching reports.", citations: [] };
    const text = rows
      .map((r) => `- ${r.title}${r.type ? ` (${r.type})` : ""}${r.summary ? `: ${r.summary}` : ""}`)
      .join("\n");
    return {
      text,
      citations: rows.map((r) => ({
        type: "report",
        id: r.id,
        label: r.title,
        href: `/reports`,
      })),
    };
  },
};

const searchSopDocuments: WorkspaceTool = {
  name: "search_sop_documents",
  supplierSafe: false,
  description:
    "Search internal SOP (standard operating procedure) documents by title/category. Returns title, category, status and effective date.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      status: { type: "string" },
      limit: { type: "integer" },
    },
    additionalProperties: false,
  },
  requiredPerms: ["policies:read"],
  async execute(req, args) {
    const ctx = getAuthContext(req);
    const limit = clampLimit(args["limit"]);
    const conds: SQL[] = [eq(sopDocumentsTable.organizationId, ctx.organizationId)];
    const q = str(args["query"]);
    if (q) {
      const t = likeTerm(q);
      conds.push(or(ilike(sopDocumentsTable.title, t), ilike(sopDocumentsTable.category, t))!);
    }
    const status = str(args["status"]);
    if (status) conds.push(ilike(sopDocumentsTable.status, likeTerm(status)));

    const rows = await db
      .select({
        id: sopDocumentsTable.id,
        title: sopDocumentsTable.title,
        category: sopDocumentsTable.category,
        status: sopDocumentsTable.status,
        effectiveDate: sopDocumentsTable.effectiveDate,
      })
      .from(sopDocumentsTable)
      .where(and(...conds))
      .orderBy(desc(sopDocumentsTable.updatedAt))
      .limit(limit);

    if (rows.length === 0) return { text: "No matching SOP documents.", citations: [] };
    const text = rows
      .map(
        (r) =>
          `- ${r.title}${r.category ? ` (${r.category})` : ""} — ${r.status ?? "?"}${r.effectiveDate ? `, effective ${r.effectiveDate}` : ""}`,
      )
      .join("\n");
    return {
      text,
      citations: rows.map((r) => ({
        type: "sop",
        id: r.id,
        label: r.title,
        href: `/resources/sop`,
      })),
    };
  },
};

const searchAuditTrail: WorkspaceTool = {
  name: "search_audit_trail",
  supplierSafe: false,
  description:
    "Search the append-only audit trail (who did what, when) filtered by entity type or free text on the action/detail. Use for questions like 'what changed on this package' or 'recent approvals'.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      entityType: { type: "string" },
      limit: { type: "integer" },
    },
    additionalProperties: false,
  },
  requiredPerms: ["audit:read"],
  async execute(req, args) {
    const ctx = getAuthContext(req);
    const limit = clampLimit(args["limit"]);
    const conds: SQL[] = [eq(auditEventsTable.organizationId, ctx.organizationId)];
    const entityType = str(args["entityType"]);
    if (entityType) conds.push(eq(auditEventsTable.entityType, entityType));
    const q = str(args["query"]);
    if (q) {
      const t = likeTerm(q);
      conds.push(or(ilike(auditEventsTable.action, t), ilike(auditEventsTable.detail, t))!);
    }
    const rows = await db
      .select({
        id: auditEventsTable.id,
        actor: auditEventsTable.actor,
        action: auditEventsTable.action,
        entityType: auditEventsTable.entityType,
        entityId: auditEventsTable.entityId,
        detail: auditEventsTable.detail,
        createdAt: auditEventsTable.createdAt,
      })
      .from(auditEventsTable)
      .where(and(...conds))
      .orderBy(desc(auditEventsTable.createdAt))
      .limit(limit);

    if (rows.length === 0) return { text: "No matching audit events.", citations: [] };
    const text = rows
      .map(
        (r) =>
          `- ${r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : "?"} ${r.actor} ${r.action} ${r.entityType}${r.entityId ? ` #${r.entityId}` : ""}${r.detail ? ` — ${r.detail}` : ""}`,
      )
      .join("\n");
    return { text, citations: [] };
  },
};

const searchRecalls: WorkspaceTool = {
  name: "search_recalls",
  supplierSafe: true,
  description:
    "Look up recent FDA enforcement/recall records (food, drug or device) from openFDA. Use for questions about recent recalls relevant to a product or ingredient.",
  parameters: {
    type: "object",
    properties: {
      category: { type: "string", description: "One of: food, drug, device." },
      query: { type: "string", description: "Optional search term (product/firm/reason)." },
      limit: { type: "integer" },
    },
    required: ["category"],
    additionalProperties: false,
  },
  requiredPerms: ["fda:read"],
  async execute(_req, args) {
    const raw = (str(args["category"]) ?? "").toLowerCase();
    const category = (RECALL_CATEGORIES as string[]).includes(raw)
      ? (raw as RecallCategory)
      : "food";
    const limit = clampLimit(args["limit"], 5, 10);
    const q = str(args["query"]);
    try {
      const result = await fetchRecalls({ category, search: q ?? undefined, limit });
      const recalls = (result as any)?.data ?? (result as any)?.results ?? [];
      if (!Array.isArray(recalls) || recalls.length === 0)
        return { text: "No matching recalls found.", citations: [] };
      const text = recalls
        .slice(0, limit)
        .map((r: any) => {
          const firm = r.firmName ?? r.recalling_firm ?? "?";
          const reason = r.reason ?? r.reason_for_recall ?? "";
          const product = r.productDescription ?? r.product_description ?? "";
          return `- ${firm}: ${product.slice(0, 120)}${reason ? ` — reason: ${reason.slice(0, 160)}` : ""}`;
        })
        .join("\n");
      return {
        text,
        citations: [{ type: "recall", id: category, label: `FDA ${category} recalls`, href: "/regulatory/recalls" }],
      };
    } catch (err) {
      logger.warn({ err }, "workspace tool search_recalls failed");
      return { text: "FDA recall lookup is unavailable right now.", citations: [] };
    }
  },
};

// The full registry. Order is roughly by likely usefulness (shown to the model).
const ALL_TOOLS: WorkspaceTool[] = [
  searchPackages,
  getPackageDetails,
  searchFindings,
  searchRegulations,
  searchFederalRegulations,
  searchComplianceMemory,
  listSpecialistsTool,
  searchTasks,
  listSuppliers,
  listReports,
  searchSopDocuments,
  searchAuditTrail,
  searchRecalls,
];

// Tools the caller is permitted to use: they must hold every requiredPerm, and
// supplier users additionally only see supplier-safe tools. This is the FIRST of
// two enforcement layers — each supplier-safe tool ALSO re-scopes its query by
// org + supplier at execution time, and the agent re-checks membership of this
// set before executing, so removing a tool here only changes what the model is
// offered, never what a query could return.
export function availableToolsFor(req: Request): WorkspaceTool[] {
  const isSupplier = getAuthContext(req).roleKey === "supplier_user";
  return ALL_TOOLS.filter(
    (t) =>
      t.requiredPerms.every((p) => hasPermission(req, p)) &&
      (!isSupplier || t.supplierSafe),
  );
}

export function findTool(name: string): WorkspaceTool | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

// A short human label for a tool, used in "searching…" status events.
export function toolStatusLabel(name: string): string {
  const map: Record<string, string> = {
    search_packages: "Searching packages",
    get_package_details: "Reading package detail",
    search_findings: "Searching findings",
    search_regulations: "Searching regulations",
    search_federal_regulations: "Searching federal eCFR",
    search_compliance_memory: "Recalling Compliance Memory",
    list_specialists: "Checking the specialist directory",
    search_tasks: "Searching review tasks",
    list_suppliers: "Looking up suppliers",
    list_reports: "Looking up reports",
    search_sop_documents: "Searching SOP documents",
    search_audit_trail: "Reading the audit trail",
    search_recalls: "Looking up FDA recalls",
  };
  return map[name] ?? "Looking that up";
}
