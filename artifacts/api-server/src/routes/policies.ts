import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  policiesTable,
  policyVersionsTable,
  type PolicyRow,
  type PolicyVersionRow,
} from "@workspace/db";
import { eq, and, or, ilike, desc, type SQL } from "drizzle-orm";
import {
  CreatePolicyBody,
  UpdatePolicyBody,
  CreatePolicyVersionBody,
} from "@workspace/api-zod";
import { requirePermission, orgId, getAuthContext } from "../lib/rbac/context";
import { logger } from "../lib/logger";
import {
  policyEmbedText,
  retrieveRelevantPolicies,
} from "../lib/policies/engine";
import { extractPolicyText } from "../lib/policies/extract";
import { embed } from "../lib/memory/embedding";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}

function requireId(raw: string | string[] | undefined, res: Response): number | null {
  const id = parseId(raw);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  return id;
}

function iso(value: Date | string | null): string {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : "";
}

function mapPolicy(p: PolicyRow) {
  return {
    id: p.id,
    name: p.name,
    policyType: p.policyType,
    category: p.category,
    department: p.department,
    owner: p.owner,
    source: p.source,
    summary: p.summary,
    status: p.status,
    defaultSeverity: p.defaultSeverity,
    tags: p.tags ?? [],
    effectiveDate: p.effectiveDate,
    expirationDate: p.expirationDate,
    version: p.version,
    documentUrl: p.documentUrl,
    fileName: p.fileName,
    contentType: p.contentType,
    extractedText: p.extractedText,
    extractionStatus: p.extractionStatus,
    extractionEngine: p.extractionEngine,
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  };
}

function mapPolicyVersion(v: PolicyVersionRow) {
  return {
    id: v.id,
    policyId: v.policyId,
    version: v.version,
    name: v.name,
    category: v.category ?? "",
    status: v.status ?? "",
    summary: v.summary,
    documentUrl: v.documentUrl,
    fileName: v.fileName,
    effectiveDate: v.effectiveDate,
    expirationDate: v.expirationDate,
    changeNote: v.changeNote,
    createdBy: v.createdBy,
    createdAt: iso(v.createdAt),
  };
}

// Recompute the embedding for a policy row from its current searchable text.
function embeddingFor(p: PolicyRow): number[] {
  return embed(
    policyEmbedText({
      name: p.name,
      category: p.category,
      policyType: p.policyType,
      source: p.source,
      summary: p.summary,
      tags: p.tags,
      extractedText: p.extractedText,
    }),
  );
}

// Extract text from any attached document, then persist extraction result +
// a refreshed embedding. Non-fatal: extraction failures are recorded, never thrown.
async function processAndEmbed(policyId: number, organizationId: number): Promise<PolicyRow | undefined> {
  const [row] = await db
    .select()
    .from(policiesTable)
    .where(and(eq(policiesTable.id, policyId), eq(policiesTable.organizationId, organizationId)));
  if (!row) return undefined;

  const extraction = await extractPolicyText({
    documentUrl: row.documentUrl,
    contentType: row.contentType,
  });

  const merged: PolicyRow = {
    ...row,
    extractedText: extraction.text ?? row.extractedText,
    extractionStatus: extraction.status,
    extractionEngine: extraction.engine,
  };

  const [updated] = await db
    .update(policiesTable)
    .set({
      extractedText: merged.extractedText,
      extractionStatus: merged.extractionStatus,
      extractionEngine: merged.extractionEngine,
      embedding: embeddingFor(merged),
      updatedAt: new Date(),
    })
    .where(and(eq(policiesTable.id, policyId), eq(policiesTable.organizationId, organizationId)))
    .returning();

  return updated;
}

// GET /policies — list with optional search/category/status filters.
router.get(
  "/policies",
  requirePermission("policies:read"),
  async (req: Request, res: Response): Promise<void> => {
    const organizationId = orgId(req);
    const { search, category, status } = req.query;
    const conditions: SQL[] = [eq(policiesTable.organizationId, organizationId)];
    if (typeof search === "string" && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(
        or(
          ilike(policiesTable.name, term),
          ilike(policiesTable.summary, term),
          ilike(policiesTable.source, term),
        )!,
      );
    }
    if (typeof category === "string" && category) {
      conditions.push(eq(policiesTable.category, category));
    }
    if (typeof status === "string" && status) {
      conditions.push(eq(policiesTable.status, status));
    }
    const rows = await db
      .select()
      .from(policiesTable)
      .where(and(...conditions))
      .orderBy(desc(policiesTable.updatedAt));
    res.json(rows.map(mapPolicy));
  },
);

// GET /policies/search — semantic recall. Registered before /policies/:id.
router.get(
  "/policies/search",
  requirePermission("policies:read"),
  async (req: Request, res: Response): Promise<void> => {
    const q = req.query["q"];
    if (typeof q !== "string" || !q.trim()) {
      res.status(400).json({ error: "Query 'q' is required" });
      return;
    }
    const limitRaw = req.query["limit"];
    const limit = typeof limitRaw === "string" ? Number(limitRaw) : undefined;
    const matches = await retrieveRelevantPolicies({
      organizationId: orgId(req),
      queryText: q,
      limit: Number.isFinite(limit) && (limit as number) > 0 ? (limit as number) : 10,
      minSimilarity: 0,
      activeOnly: false,
    });
    res.json(matches);
  },
);

// POST /policies — create a policy (optionally from an uploaded document).
router.post(
  "/policies",
  requirePermission("policies:write"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreatePolicyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    const organizationId = orgId(req);
    const ctx = getAuthContext(req);
    const actor = ctx.name || ctx.email || "System";

    const [inserted] = await db
      .insert(policiesTable)
      .values({
        organizationId,
        name: d.name,
        category: d.category,
        policyType: d.policyType ?? null,
        department: d.department ?? null,
        owner: d.owner ?? null,
        source: d.source ?? null,
        summary: d.summary ?? null,
        status: d.status ?? "active",
        defaultSeverity: d.defaultSeverity ?? "major",
        tags: d.tags ?? null,
        effectiveDate: d.effectiveDate ?? null,
        expirationDate: d.expirationDate ?? null,
        documentUrl: d.documentUrl ?? null,
        fileName: d.fileName ?? null,
        contentType: d.contentType ?? null,
        extractionStatus: d.documentUrl ? "Pending" : "Skipped",
        createdBy: actor,
        createdById: String(ctx.userId),
        updatedBy: actor,
      })
      .returning();

    if (!inserted) {
      res.status(500).json({ error: "Failed to create policy" });
      return;
    }

    // Extract document text (if any) and compute the embedding. Non-fatal.
    let current = inserted;
    try {
      const processed = await processAndEmbed(inserted.id, organizationId);
      if (processed) current = processed;
    } catch (err) {
      logger.error({ err }, "Policy extraction/embedding failed on create");
    }

    res.status(201).json(mapPolicy(current));
  },
);

async function loadOwnedPolicy(
  req: Request,
  res: Response,
  id: number,
): Promise<PolicyRow | null> {
  const [row] = await db
    .select()
    .from(policiesTable)
    .where(and(eq(policiesTable.id, id), eq(policiesTable.organizationId, orgId(req))));
  if (!row) {
    res.status(404).json({ error: "Policy not found" });
    return null;
  }
  return row;
}

// GET /policies/:id
router.get(
  "/policies/:id",
  requirePermission("policies:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const row = await loadOwnedPolicy(req, res, id);
    if (!row) return;
    res.json(mapPolicy(row));
  },
);

// PATCH /policies/:id — edit fields / change status; re-embeds when text changes.
router.patch(
  "/policies/:id",
  requirePermission("policies:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const existing = await loadOwnedPolicy(req, res, id);
    if (!existing) return;

    const parsed = UpdatePolicyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    const ctx = getAuthContext(req);

    const merged: PolicyRow = {
      ...existing,
      name: d.name ?? existing.name,
      category: d.category ?? existing.category,
      policyType: d.policyType !== undefined ? d.policyType : existing.policyType,
      department: d.department !== undefined ? d.department : existing.department,
      owner: d.owner !== undefined ? d.owner : existing.owner,
      source: d.source !== undefined ? d.source : existing.source,
      summary: d.summary !== undefined ? d.summary : existing.summary,
      status: d.status ?? existing.status,
      defaultSeverity: d.defaultSeverity ?? existing.defaultSeverity,
      tags: d.tags !== undefined ? d.tags : existing.tags,
      effectiveDate: d.effectiveDate !== undefined ? d.effectiveDate : existing.effectiveDate,
      expirationDate: d.expirationDate !== undefined ? d.expirationDate : existing.expirationDate,
    };

    const [updated] = await db
      .update(policiesTable)
      .set({
        name: merged.name,
        category: merged.category,
        policyType: merged.policyType,
        department: merged.department,
        owner: merged.owner,
        source: merged.source,
        summary: merged.summary,
        status: merged.status,
        defaultSeverity: merged.defaultSeverity,
        tags: merged.tags,
        effectiveDate: merged.effectiveDate,
        expirationDate: merged.expirationDate,
        embedding: embeddingFor(merged),
        updatedBy: ctx.name || ctx.email || "System",
        updatedAt: new Date(),
      })
      .where(and(eq(policiesTable.id, id), eq(policiesTable.organizationId, orgId(req))))
      .returning();

    res.json(mapPolicy(updated!));
  },
);

// GET /policies/:id/versions
router.get(
  "/policies/:id/versions",
  requirePermission("policies:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const row = await loadOwnedPolicy(req, res, id);
    if (!row) return;
    const versions = await db
      .select()
      .from(policyVersionsTable)
      .where(
        and(
          eq(policyVersionsTable.policyId, id),
          eq(policyVersionsTable.organizationId, orgId(req)),
        ),
      )
      .orderBy(desc(policyVersionsTable.version));
    res.json(versions.map(mapPolicyVersion));
  },
);

// POST /policies/:id/versions — snapshot the current state, then bump version.
router.post(
  "/policies/:id/versions",
  requirePermission("policies:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const existing = await loadOwnedPolicy(req, res, id);
    if (!existing) return;

    const parsed = CreatePolicyVersionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const changeNote = parsed.data.changeNote ?? null;
    const ctx = getAuthContext(req);
    const organizationId = orgId(req);

    const updated = await db.transaction(async (tx) => {
      // Re-read the row inside the transaction WITH A ROW LOCK so concurrent
      // publishes serialize: the second waits here, then snapshots the already
      // bumped version. This makes the snapshot + bump atomic and monotonic.
      const [locked] = await tx
        .select()
        .from(policiesTable)
        .where(
          and(
            eq(policiesTable.id, existing.id),
            eq(policiesTable.organizationId, organizationId),
          ),
        )
        .for("update");
      if (!locked) return undefined;

      // Snapshot the current (pre-bump) state immutably.
      await tx.insert(policyVersionsTable).values({
        organizationId,
        policyId: locked.id,
        version: locked.version,
        name: locked.name,
        category: locked.category,
        status: locked.status,
        summary: locked.summary,
        documentUrl: locked.documentUrl,
        fileName: locked.fileName,
        contentType: locked.contentType,
        extractedText: locked.extractedText,
        effectiveDate: locked.effectiveDate,
        expirationDate: locked.expirationDate,
        changeNote,
        createdBy: ctx.name || ctx.email || "System",
        createdById: String(ctx.userId),
      });

      const [bumped] = await tx
        .update(policiesTable)
        .set({
          version: locked.version + 1,
          updatedBy: ctx.name || ctx.email || "System",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(policiesTable.id, locked.id),
            eq(policiesTable.organizationId, organizationId),
          ),
        )
        .returning();
      return bumped;
    });

    if (!updated) {
      res.status(404).json({ error: "Policy not found" });
      return;
    }
    res.json(mapPolicy(updated));
  },
);

// POST /policies/:id/reprocess — re-extract document text and re-embed.
router.post(
  "/policies/:id/reprocess",
  requirePermission("policies:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const existing = await loadOwnedPolicy(req, res, id);
    if (!existing) return;

    let current = existing;
    try {
      const processed = await processAndEmbed(id, orgId(req));
      if (processed) current = processed;
    } catch (err) {
      logger.error({ err }, "Policy reprocess failed");
      res.status(502).json({ error: "Policy reprocessing failed. Please retry." });
      return;
    }
    res.json(mapPolicy(current));
  },
);

export default router;
