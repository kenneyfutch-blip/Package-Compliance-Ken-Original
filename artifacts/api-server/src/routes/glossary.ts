import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  glossaryEntriesTable,
  auditEventsTable,
  type GlossaryEntryRow,
} from "@workspace/db";
import { eq, and, or, ilike, desc, type SQL } from "drizzle-orm";
import { requirePermission, orgId, getAuthContext } from "../lib/rbac/context";
import { writeAudit } from "../lib/audit";

const router: IRouter = Router();

function requireId(
  raw: string | string[] | undefined,
  res: Response,
): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
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

function mapEntry(e: GlossaryEntryRow) {
  return {
    id: e.id,
    term: e.term,
    approvedValue: e.approvedValue,
    category: e.category,
    status: e.status,
    notes: e.notes,
    regulatoryReference: e.regulatoryReference,
    createdBy: e.createdBy,
    updatedBy: e.updatedBy,
    createdAt: iso(e.createdAt),
    updatedAt: iso(e.updatedAt),
  };
}

// GET /glossary — list approved-language/glossary entries with optional filters.
// Defaults to active-only so browse + the review lookup only surface live wording;
// pass status=all (or a specific status) to include retired entries.
router.get(
  "/glossary",
  requirePermission("glossary:read"),
  async (req: Request, res: Response): Promise<void> => {
    const { search, category, status } = req.query;
    const conds: SQL[] = [eq(glossaryEntriesTable.organizationId, orgId(req))];

    if (typeof status === "string" && status && status !== "all") {
      conds.push(eq(glossaryEntriesTable.status, status));
    } else if (status === undefined || status === "") {
      conds.push(eq(glossaryEntriesTable.status, "active"));
    }
    if (typeof category === "string" && category && category !== "all") {
      conds.push(eq(glossaryEntriesTable.category, category));
    }
    if (typeof search === "string" && search.trim()) {
      const term = `%${search.trim()}%`;
      conds.push(
        or(
          ilike(glossaryEntriesTable.term, term),
          ilike(glossaryEntriesTable.approvedValue, term),
          ilike(glossaryEntriesTable.notes, term),
          ilike(glossaryEntriesTable.regulatoryReference, term),
        )!,
      );
    }

    const rows = await db
      .select()
      .from(glossaryEntriesTable)
      .where(and(...conds))
      .orderBy(
        glossaryEntriesTable.category,
        desc(glossaryEntriesTable.updatedAt),
      )
      .limit(500);

    res.json(rows.map(mapEntry));
  },
);

async function loadOwnedEntry(
  req: Request,
  res: Response,
  id: number,
): Promise<GlossaryEntryRow | null> {
  const [row] = await db
    .select()
    .from(glossaryEntriesTable)
    .where(
      and(
        eq(glossaryEntriesTable.id, id),
        eq(glossaryEntriesTable.organizationId, orgId(req)),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "Glossary entry not found" });
    return null;
  }
  return row;
}

// GET /glossary/:id — single entry.
router.get(
  "/glossary/:id",
  requirePermission("glossary:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const row = await loadOwnedEntry(req, res, id);
    if (!row) return;
    res.json(mapEntry(row));
  },
);

// GET /glossary/:id/history — the immutable audit trail for one entry so the UI
// can show who changed what and when.
router.get(
  "/glossary/:id/history",
  requirePermission("glossary:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const row = await loadOwnedEntry(req, res, id);
    if (!row) return;
    const events = await db
      .select()
      .from(auditEventsTable)
      .where(
        and(
          eq(auditEventsTable.organizationId, orgId(req)),
          eq(auditEventsTable.entityType, "glossary_entry"),
          eq(auditEventsTable.entityId, id),
        ),
      )
      .orderBy(desc(auditEventsTable.createdAt))
      .limit(200);
    res.json(
      events.map((ev) => ({
        id: ev.id,
        actor: ev.actor,
        action: ev.action,
        detail: ev.detail,
        createdAt: iso(ev.createdAt),
      })),
    );
  },
);

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// POST /glossary — create an entry.
router.post(
  "/glossary",
  requirePermission("glossary:write"),
  async (req: Request, res: Response): Promise<void> => {
    const term = trimStr(req.body?.term);
    const approvedValue = trimStr(req.body?.approvedValue);
    if (!term || !approvedValue) {
      res
        .status(400)
        .json({ error: "term and approvedValue are required" });
      return;
    }
    const category = trimStr(req.body?.category) || "Defined Term";
    const status = trimStr(req.body?.status) || "active";
    const notes = trimStr(req.body?.notes) || null;
    const regulatoryReference = trimStr(req.body?.regulatoryReference) || null;
    const ctx = getAuthContext(req);
    const actor = ctx.name || ctx.email || "System";

    const [inserted] = await db
      .insert(glossaryEntriesTable)
      .values({
        organizationId: orgId(req),
        term,
        approvedValue,
        category,
        status,
        notes,
        regulatoryReference,
        createdBy: actor,
        createdById: String(ctx.userId),
        updatedBy: actor,
      })
      .returning();

    if (!inserted) {
      res.status(500).json({ error: "Failed to create glossary entry" });
      return;
    }

    await writeAudit(req, {
      action: "Glossary entry created",
      entityType: "glossary_entry",
      entityId: inserted.id,
      detail: `Added ${category} "${term}".`,
      after: mapEntry(inserted) as Record<string, unknown>,
      regulationRefs: regulatoryReference ? [regulatoryReference] : [],
    });

    res.status(201).json(mapEntry(inserted));
  },
);

// PATCH /glossary/:id — edit fields or change status (retire/restore).
router.patch(
  "/glossary/:id",
  requirePermission("glossary:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const existing = await loadOwnedEntry(req, res, id);
    if (!existing) return;

    const b = req.body ?? {};
    const next = {
      term: typeof b.term === "string" ? b.term.trim() : existing.term,
      approvedValue:
        typeof b.approvedValue === "string"
          ? b.approvedValue.trim()
          : existing.approvedValue,
      category:
        typeof b.category === "string" && b.category.trim()
          ? b.category.trim()
          : existing.category,
      status:
        typeof b.status === "string" && b.status.trim()
          ? b.status.trim()
          : existing.status,
      notes:
        b.notes !== undefined
          ? typeof b.notes === "string" && b.notes.trim()
            ? b.notes.trim()
            : null
          : existing.notes,
      regulatoryReference:
        b.regulatoryReference !== undefined
          ? typeof b.regulatoryReference === "string" &&
            b.regulatoryReference.trim()
            ? b.regulatoryReference.trim()
            : null
          : existing.regulatoryReference,
    };

    if (!next.term || !next.approvedValue) {
      res.status(400).json({ error: "term and approvedValue cannot be empty" });
      return;
    }

    const ctx = getAuthContext(req);
    const [updated] = await db
      .update(glossaryEntriesTable)
      .set({
        ...next,
        updatedBy: ctx.name || ctx.email || "System",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(glossaryEntriesTable.id, id),
          eq(glossaryEntriesTable.organizationId, orgId(req)),
        ),
      )
      .returning();

    const retired =
      existing.status !== "retired" && updated!.status === "retired";
    const restored =
      existing.status === "retired" && updated!.status !== "retired";
    const action = retired
      ? "Glossary entry retired"
      : restored
        ? "Glossary entry restored"
        : "Glossary entry updated";

    await writeAudit(req, {
      action,
      entityType: "glossary_entry",
      entityId: id,
      detail: `${action}: "${updated!.term}".`,
      before: mapEntry(existing) as Record<string, unknown>,
      after: mapEntry(updated!) as Record<string, unknown>,
      regulationRefs: updated!.regulatoryReference
        ? [updated!.regulatoryReference]
        : [],
    });

    res.json(mapEntry(updated!));
  },
);

export default router;
