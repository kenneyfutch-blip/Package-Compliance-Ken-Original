import { Readable } from "stream";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  sopDocumentsTable,
  sopDocumentVersionsTable,
  type SopDocumentRow,
  type SopDocumentVersionRow,
} from "@workspace/db";
import { eq, and, or, ilike, desc, type SQL } from "drizzle-orm";
import {
  CreateSopDocumentBody,
  UpdateSopDocumentBody,
  CreateSopDocumentVersionBody,
} from "@workspace/api-zod";
import { requirePermission, orgId, getAuthContext } from "../lib/rbac/context";
import { logger } from "../lib/logger";
// SOP documents reuse the platform document-extraction path (object storage
// download + active OCR provider / direct text decode) rather than introducing a
// new one. extractPolicyText is generic over { documentUrl, contentType }.
import { extractPolicyText } from "../lib/policies/extract";
import { diffSopText } from "../lib/sop/diff";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

function parseId(raw: string | string[] | undefined): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}

function requireId(
  raw: string | string[] | undefined,
  res: Response,
): number | null {
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

function mapSopDocument(d: SopDocumentRow) {
  return {
    id: d.id,
    title: d.title,
    category: d.category,
    owner: d.owner,
    status: d.status,
    currentVersion: d.currentVersion,
    documentUrl: d.documentUrl,
    fileName: d.fileName,
    contentType: d.contentType,
    extractedText: d.extractedText,
    extractionStatus: d.extractionStatus,
    extractionEngine: d.extractionEngine,
    effectiveDate: d.effectiveDate,
    createdBy: d.createdBy,
    updatedBy: d.updatedBy,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  };
}

function mapSopVersion(v: SopDocumentVersionRow) {
  return {
    id: v.id,
    sopDocumentId: v.sopDocumentId,
    version: v.version,
    documentUrl: v.documentUrl,
    fileName: v.fileName,
    contentType: v.contentType,
    extractionStatus: v.extractionStatus,
    extractionEngine: v.extractionEngine,
    effectiveDate: v.effectiveDate,
    changeNote: v.changeNote,
    createdBy: v.createdBy,
    createdAt: iso(v.createdAt),
  };
}

// GET /sop-documents — list with optional search/category/status filters.
router.get(
  "/sop-documents",
  requirePermission("policies:read"),
  async (req: Request, res: Response): Promise<void> => {
    const organizationId = orgId(req);
    const { search, category, status } = req.query;
    const conditions: SQL[] = [
      eq(sopDocumentsTable.organizationId, organizationId),
    ];
    if (typeof search === "string" && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(
        or(
          ilike(sopDocumentsTable.title, term),
          ilike(sopDocumentsTable.owner, term),
          ilike(sopDocumentsTable.extractedText, term),
        )!,
      );
    }
    if (typeof category === "string" && category) {
      conditions.push(eq(sopDocumentsTable.category, category));
    }
    if (typeof status === "string" && status) {
      conditions.push(eq(sopDocumentsTable.status, status));
    }
    const rows = await db
      .select()
      .from(sopDocumentsTable)
      .where(and(...conditions))
      .orderBy(desc(sopDocumentsTable.updatedAt));
    res.json(rows.map(mapSopDocument));
  },
);

async function loadOwnedSop(
  req: Request,
  res: Response,
  id: number,
): Promise<SopDocumentRow | null> {
  const [row] = await db
    .select()
    .from(sopDocumentsTable)
    .where(
      and(
        eq(sopDocumentsTable.id, id),
        eq(sopDocumentsTable.organizationId, orgId(req)),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "SOP document not found" });
    return null;
  }
  return row;
}

async function loadOwnedVersion(
  req: Request,
  sopDocumentId: number,
  versionId: number,
): Promise<SopDocumentVersionRow | null> {
  const [row] = await db
    .select()
    .from(sopDocumentVersionsTable)
    .where(
      and(
        eq(sopDocumentVersionsTable.id, versionId),
        eq(sopDocumentVersionsTable.sopDocumentId, sopDocumentId),
        eq(sopDocumentVersionsTable.organizationId, orgId(req)),
      ),
    );
  return row ?? null;
}

// POST /sop-documents — create a new SOP with its first uploaded version.
router.post(
  "/sop-documents",
  requirePermission("policies:write"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateSopDocumentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    const organizationId = orgId(req);
    const ctx = getAuthContext(req);
    const actor = ctx.name || ctx.email || "System";

    if (d.documentUrl && !d.documentUrl.startsWith("/objects/")) {
      res.status(400).json({ error: "Invalid document reference" });
      return;
    }

    // Extract searchable text from the uploaded document up front so the SOP is
    // immediately searchable. Non-fatal: a failure is recorded as a status.
    const extraction = await extractPolicyText({
      documentUrl: d.documentUrl,
      contentType: d.contentType,
    });

    const inserted = await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(sopDocumentsTable)
        .values({
          organizationId,
          title: d.title,
          category: d.category,
          owner: d.owner ?? null,
          status: d.status ?? "active",
          currentVersion: 1,
          documentUrl: d.documentUrl ?? null,
          fileName: d.fileName ?? null,
          contentType: d.contentType ?? null,
          extractedText: extraction.text,
          extractionStatus: extraction.status,
          extractionEngine: extraction.engine,
          effectiveDate: d.effectiveDate ?? null,
          createdBy: actor,
          createdById: String(ctx.userId),
          updatedBy: actor,
        })
        .returning();
      if (!doc) return undefined;

      await tx.insert(sopDocumentVersionsTable).values({
        organizationId,
        sopDocumentId: doc.id,
        version: 1,
        documentUrl: doc.documentUrl,
        fileName: doc.fileName,
        contentType: doc.contentType,
        extractedText: doc.extractedText,
        extractionStatus: doc.extractionStatus,
        extractionEngine: doc.extractionEngine,
        effectiveDate: doc.effectiveDate,
        changeNote: d.changeNote ?? null,
        createdBy: actor,
        createdById: String(ctx.userId),
      });
      return doc;
    });

    if (!inserted) {
      res.status(500).json({ error: "Failed to create SOP document" });
      return;
    }
    res.status(201).json(mapSopDocument(inserted));
  },
);

// GET /sop-documents/:id
router.get(
  "/sop-documents/:id",
  requirePermission("policies:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const row = await loadOwnedSop(req, res, id);
    if (!row) return;
    res.json(mapSopDocument(row));
  },
);

// PATCH /sop-documents/:id — edit metadata / archive (does not touch files).
router.patch(
  "/sop-documents/:id",
  requirePermission("policies:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const existing = await loadOwnedSop(req, res, id);
    if (!existing) return;

    const parsed = UpdateSopDocumentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    const ctx = getAuthContext(req);

    const [updated] = await db
      .update(sopDocumentsTable)
      .set({
        title: d.title ?? existing.title,
        category: d.category ?? existing.category,
        owner: d.owner !== undefined ? d.owner : existing.owner,
        status: d.status ?? existing.status,
        effectiveDate:
          d.effectiveDate !== undefined
            ? d.effectiveDate
            : existing.effectiveDate,
        updatedBy: ctx.name || ctx.email || "System",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sopDocumentsTable.id, id),
          eq(sopDocumentsTable.organizationId, orgId(req)),
        ),
      )
      .returning();

    res.json(mapSopDocument(updated!));
  },
);

// GET /sop-documents/:id/versions — full revision history, newest first.
router.get(
  "/sop-documents/:id/versions",
  requirePermission("policies:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const row = await loadOwnedSop(req, res, id);
    if (!row) return;
    const versions = await db
      .select()
      .from(sopDocumentVersionsTable)
      .where(
        and(
          eq(sopDocumentVersionsTable.sopDocumentId, id),
          eq(sopDocumentVersionsTable.organizationId, orgId(req)),
        ),
      )
      .orderBy(desc(sopDocumentVersionsTable.version));
    res.json(versions.map(mapSopVersion));
  },
);

// POST /sop-documents/:id/versions — upload a new file as a new version.
// The new file becomes the current version; all prior versions are preserved.
router.post(
  "/sop-documents/:id/versions",
  requirePermission("policies:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const existing = await loadOwnedSop(req, res, id);
    if (!existing) return;

    const parsed = CreateSopDocumentVersionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    if (!d.documentUrl || !d.documentUrl.startsWith("/objects/")) {
      res.status(400).json({ error: "A document upload is required" });
      return;
    }
    const ctx = getAuthContext(req);
    const actor = ctx.name || ctx.email || "System";
    const organizationId = orgId(req);

    // Extract text before the transaction (network/OCR work), then commit the
    // version snapshot + parent bump atomically under a row lock.
    const extraction = await extractPolicyText({
      documentUrl: d.documentUrl,
      contentType: d.contentType,
    });

    const updated = await db.transaction(async (tx) => {
      // Row-lock the parent so concurrent uploads serialize and each snapshots
      // a distinct, monotonic version number.
      const [locked] = await tx
        .select()
        .from(sopDocumentsTable)
        .where(
          and(
            eq(sopDocumentsTable.id, existing.id),
            eq(sopDocumentsTable.organizationId, organizationId),
          ),
        )
        .for("update");
      if (!locked) return undefined;

      const nextVersion = locked.currentVersion + 1;
      await tx.insert(sopDocumentVersionsTable).values({
        organizationId,
        sopDocumentId: locked.id,
        version: nextVersion,
        documentUrl: d.documentUrl,
        fileName: d.fileName ?? null,
        contentType: d.contentType ?? null,
        extractedText: extraction.text,
        extractionStatus: extraction.status,
        extractionEngine: extraction.engine,
        effectiveDate: d.effectiveDate ?? null,
        changeNote: d.changeNote ?? null,
        createdBy: actor,
        createdById: String(ctx.userId),
      });

      const [bumped] = await tx
        .update(sopDocumentsTable)
        .set({
          currentVersion: nextVersion,
          documentUrl: d.documentUrl,
          fileName: d.fileName ?? null,
          contentType: d.contentType ?? null,
          extractedText: extraction.text,
          extractionStatus: extraction.status,
          extractionEngine: extraction.engine,
          effectiveDate: d.effectiveDate ?? locked.effectiveDate,
          updatedBy: actor,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sopDocumentsTable.id, locked.id),
            eq(sopDocumentsTable.organizationId, organizationId),
          ),
        )
        .returning();
      return bumped;
    });

    if (!updated) {
      res.status(404).json({ error: "SOP document not found" });
      return;
    }
    res.status(201).json(mapSopDocument(updated));
  },
);

// GET /sop-documents/:id/compare/:versionA/:versionB
// Side-by-side text diff between any two versions of the SOP.
router.get(
  "/sop-documents/:id/compare/:versionA/:versionB",
  requirePermission("policies:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const doc = await loadOwnedSop(req, res, id);
    if (!doc) return;

    const aId = requireId(req.params["versionA"], res);
    if (aId === null) return;
    const bId = requireId(req.params["versionB"], res);
    if (bId === null) return;

    const [va, vb] = await Promise.all([
      loadOwnedVersion(req, id, aId),
      loadOwnedVersion(req, id, bId),
    ]);
    if (!va || !vb) {
      res.status(404).json({ error: "Version not found" });
      return;
    }

    // Order left (older) → right (newer) by version number regardless of the
    // order the caller passed them.
    const [older, newer] = va.version <= vb.version ? [va, vb] : [vb, va];
    const { rows, summary } = diffSopText(older.extractedText, newer.extractedText);

    res.json({
      documentId: id,
      title: doc.title,
      older: mapSopVersion(older),
      newer: mapSopVersion(newer),
      rows,
      summary,
    });
  },
);

// GET /sop-documents/:id/versions/:versionId/file
// Stream a specific version's stored file. Org-scoped and served through the
// same XSS-safe object-storage serving path as other private downloads.
router.get(
  "/sop-documents/:id/versions/:versionId/file",
  requirePermission("policies:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const versionId = requireId(req.params["versionId"], res);
    if (versionId === null) return;

    // Enforce the same tenant scope as every other read: an out-of-org SOP or
    // version resolves to 404 (deny-by-default, never confirm existence).
    const doc = await loadOwnedSop(req, res, id);
    if (!doc) return;
    const version = await loadOwnedVersion(req, id, versionId);
    if (!version || !version.documentUrl) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    try {
      const file = await objectStorage.getObjectEntityFile(version.documentUrl);
      const response = await objectStorage.downloadObject(file);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) {
        Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
      } else {
        res.end();
      }
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "File not found" });
        return;
      }
      logger.error({ err }, "Failed to serve SOP document version file");
      res.status(500).json({ error: "Failed to serve file" });
    }
  },
);

export default router;
