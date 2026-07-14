import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  packagesTable,
  packageVersionsTable,
  violationsTable,
  auditEventsTable,
  reportsTable,
  type PackageRow,
} from "@workspace/db";
import {
  eq,
  ne,
  desc,
  and,
  or,
  ilike,
  inArray,
  gte,
  lt,
  type SQL,
} from "drizzle-orm";
import { parsePagination, MAX_LIMIT } from "../lib/pagination";
import {
  CreatePackageBody,
  UpdatePackageBody,
  AskCopilotBody,
  GenerateReportBody,
  BulkAnalyzeBody,
} from "@workspace/api-zod";
import {
  mapPackage,
  mapAuditEvent,
  mapReport,
  mapExtraction,
} from "../lib/mappers";
import { runExtraction } from "../lib/document-ai/service";
import { getActiveProvider } from "../lib/document-ai/providers/registry";
import { resolveSupplierId } from "../lib/suppliers/link";
import {
  applyAnalysis,
  buildDetail,
  loadRegulations,
  ensureInitialVersion,
} from "../lib/packageService";
import { analyzePackaging, askCompliancePilot } from "../lib/ai";
import {
  retrieveRelevantPolicies,
  formatPoliciesForPrompt,
} from "../lib/policies/engine";
import { logger } from "../lib/logger";
import { requirePermission, orgId, getAuthContext } from "../lib/rbac/context";
import { packageConds, canAccessPackage, canAccessObjectOwner } from "../lib/rbac/scope";
import { resolveObjectOwner } from "./storage";
import { writeAudit } from "../lib/audit";
import { autoAssignReview, completeReview } from "../lib/reviews/engine";
import { matchTeamName } from "../lib/reviews/routing";
import { enqueuePackageAnalysis } from "../lib/packageAnalysis";
import {
  retrieveSimilarFindings,
  captureFindingsForDecision,
  packageQueryText,
  formatMemoryForPrompt,
} from "../lib/memory/engine";
import { readArchivedAuditForPackage } from "../lib/maintenance/archive";
import { gatherEcfrIntelligence, formatEcfrForPrompt } from "../lib/ecfr";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  renderPdfThumbnail,
  getCachedThumbnail,
  setCachedThumbnail,
  ThumbnailError,
} from "../lib/thumbnail";

const objectStorage = new ObjectStorageService();

const router: IRouter = Router();

// Map a raw archived audit row (snake_case, from the archive schema) into the
// same response shape as a live audit row.
function mapArchivedAudit(r: Record<string, unknown>) {
  const createdAt = r["created_at"];
  return {
    id: Number(r["id"]),
    packageId: r["package_id"] === null ? null : Number(r["package_id"]),
    entityType: String(r["entity_type"] ?? "package"),
    entityId: r["entity_id"] === null ? null : Number(r["entity_id"]),
    actor: String(r["actor"] ?? "Unknown"),
    action: String(r["action"] ?? ""),
    detail: (r["detail"] as string | null) ?? null,
    before: (r["before"] as Record<string, unknown> | null) ?? null,
    after: (r["after"] as Record<string, unknown> | null) ?? null,
    regulationRefs: (r["regulation_refs"] as string[] | null) ?? [],
    createdAt:
      createdAt instanceof Date
        ? createdAt.toISOString()
        : String(createdAt ?? ""),
  };
}

// Compliance Memory recall: fetch how similar findings were resolved on past
// packages and format them for the AI review prompt. Non-fatal — a memory miss
// must never block analysis. When a supplier user triggers the analysis, recall
// is restricted to that supplier's own findings so the resulting suggestions can
// never echo another supplier's data.
async function priorKnowledgeFor(
  pkg: PackageRow,
  req: Request,
): Promise<string | undefined> {
  try {
    const ctx = getAuthContext(req);
    const supplierId =
      ctx.roleKey === "supplier_user" ? (ctx.supplierId ?? -1) : null;
    const similar = await retrieveSimilarFindings({
      organizationId: ctx.organizationId,
      queryText: packageQueryText(pkg),
      limit: 6,
      excludePackageId: pkg.id,
      supplierId,
    });
    return formatMemoryForPrompt(similar) || undefined;
  } catch (err) {
    logger.error({ err }, "Compliance memory recall failed");
    return undefined;
  }
}

// Internal Policy & Standards recall: fetch the org's active internal policies
// most relevant to this package and format them for the AI review prompt so they
// participate in analysis with equal authority to government regulations.
// Non-fatal — a recall miss must never block analysis.
async function relevantPoliciesFor(
  pkg: PackageRow,
  req: Request,
): Promise<string | undefined> {
  try {
    const policies = await retrieveRelevantPolicies({
      organizationId: orgId(req),
      queryText: packageQueryText(pkg),
      limit: 8,
    });
    return formatPoliciesForPrompt(policies) || undefined;
  } catch (err) {
    logger.error({ err }, "Internal policy recall failed");
    return undefined;
  }
}

// eCFR recall: fetch the synced federal regulation sections most relevant to
// this package and format them for the AI review prompt so AI-generated
// violations can cite real CFR sections. Reads only locally-synced content and
// is non-fatal — an unsynced or unreachable store must never block analysis.
async function ecfrRegulationsFor(
  pkg: PackageRow,
): Promise<string | undefined> {
  try {
    const intel = await gatherEcfrIntelligence(pkg);
    return formatEcfrForPrompt(intel.sections) || undefined;
  } catch (err) {
    logger.error({ err }, "eCFR recall failed");
    return undefined;
  }
}

// Load the four independent analysis inputs concurrently. None depends on the
// others, so awaiting them serially just stacked latency in front of every AI
// analysis. Each helper already swallows its own failures to undefined.
async function loadAnalysisContext(pkg: PackageRow, req: Request) {
  const [regulations, priorKnowledge, internalStandards, cfrRegulations] =
    await Promise.all([
      loadRegulations(),
      priorKnowledgeFor(pkg, req),
      relevantPoliciesFor(pkg, req),
      ecfrRegulationsFor(pkg),
    ]);
  return { regulations, priorKnowledge, internalStandards, cfrRegulations };
}

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return Number(value);
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

// GET /packages
router.get(
  "/packages",
  requirePermission("packages:read"),
  async (req: Request, res: Response): Promise<void> => {
    const { search, status, category, risk, vendor, engine } = req.query;
    const { limit, offset } = parsePagination(req);
    const conditions: SQL[] = [...packageConds(req)];

    if (typeof search === "string" && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(
        or(
          ilike(packagesTable.name, term),
          ilike(packagesTable.sku, term),
          ilike(packagesTable.brand, term),
          ilike(packagesTable.vendor, term),
        )!,
      );
    }
    if (typeof status === "string" && status) {
      conditions.push(eq(packagesTable.status, status));
    }
    if (typeof category === "string" && category) {
      conditions.push(eq(packagesTable.category, category));
    }
    if (typeof vendor === "string" && vendor) {
      conditions.push(eq(packagesTable.vendor, vendor));
    }
    if (typeof risk === "string" && risk) {
      const band = risk.toLowerCase();
      if (band === "high") {
        conditions.push(gte(packagesTable.riskScore, 70));
      } else if (band === "medium") {
        conditions.push(
          and(
            gte(packagesTable.riskScore, 40),
            lt(packagesTable.riskScore, 70),
          )!,
        );
      } else if (band === "low") {
        conditions.push(lt(packagesTable.riskScore, 40));
      } else {
        conditions.push(eq(packagesTable.complianceStatus, risk));
      }
    }
    if (typeof engine === "string" && engine) {
      const withEngine = db
        .select({ id: violationsTable.packageId })
        .from(violationsTable)
        .where(eq(violationsTable.engine, engine));
      conditions.push(inArray(packagesTable.id, withEngine));
    }

    const rows = await db
      .select()
      .from(packagesTable)
      .where(and(...conditions))
      .orderBy(desc(packagesTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json(rows.map(mapPackage));
  },
);

// Look up existing packages in the caller's scope that collide with a proposed
// SKU (case-insensitive) or UPC (exact). Reuses packageConds so the lookup is
// org-scoped (and supplier-scoped for supplier users).
async function findDuplicatePackages(
  req: Request,
  sku?: string | null,
  upc?: string | null,
): Promise<PackageRow[]> {
  const trimmedSku = sku?.trim();
  const trimmedUpc = upc?.trim();
  const matchers: SQL[] = [];
  if (trimmedSku) matchers.push(ilike(packagesTable.sku, trimmedSku));
  if (trimmedUpc) matchers.push(eq(packagesTable.upc, trimmedUpc));
  if (matchers.length === 0) return [];

  return db
    .select()
    .from(packagesTable)
    .where(and(...packageConds(req), or(...matchers)!))
    .orderBy(desc(packagesTable.createdAt))
    .limit(MAX_LIMIT);
}

// GET /packages/duplicates — registered before /packages/:id so the literal
// path is not captured by the :id param route.
router.get(
  "/packages/duplicates",
  requirePermission("packages:read"),
  async (req: Request, res: Response): Promise<void> => {
    const { sku, upc } = req.query;
    const matches = await findDuplicatePackages(
      req,
      typeof sku === "string" ? sku : undefined,
      typeof upc === "string" ? upc : undefined,
    );
    res.json({ matches: matches.map(mapPackage) });
  },
);

// POST /packages
router.post(
  "/packages",
  requirePermission("packages:write"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreatePackageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const data = parsed.data;
    const organizationId = orgId(req);

    // Duplicate guard: block accidental re-creation of a package with the same
    // SKU/UPC unless the caller explicitly opts in. Protects the API/bulk paths
    // too, not just the upload form.
    if (!data.allowDuplicate) {
      const duplicates = await findDuplicatePackages(req, data.sku, data.upc);
      if (duplicates.length > 0) {
        const submittedSku = (data.sku ?? "").trim().toLowerCase();
        const skuMatch = duplicates.some(
          (d) => d.sku.trim().toLowerCase() === submittedSku,
        );
        res.status(409).json({
          error: `A package with this ${skuMatch ? "SKU" : "UPC"} already exists.`,
          duplicates: duplicates.map(mapPackage),
        });
        return;
      }
    }
    // Link to the master supplier record by id (creating it on first sight) so
    // scoping and joins never rely on matching the free-text vendor name.
    const supplierId = await resolveSupplierId(organizationId, data.vendor);

    const [inserted] = await db
      .insert(packagesTable)
      .values({
        organizationId,
        // Metadata is optional at upload time (partial/in-progress artwork,
        // auditing). NOT NULL columns fall back to empty strings; reviewers can
        // fill identifiers in later.
        sku: data.sku ?? "",
        upc: data.upc ?? null,
        name: data.name ?? "",
        brand: data.brand ?? "",
        vendor: data.vendor ?? "",
        supplierId,
        category: data.category ?? "Uncategorized",
        country: data.country ?? null,
        netWeight: data.netWeight ?? null,
        dimensions: data.dimensions ?? null,
        packageType: data.packageType ?? null,
        productType: data.productType ?? null,
        manufacturingRegion: data.manufacturingRegion ?? null,
        artworkUrl: data.artworkUrl ?? null,
        extractedText: data.extractedText ?? null,
        status: "Uploaded",
        complianceStatus: "Pending",
      })
      .returning();

    if (!inserted) {
      res.status(500).json({ error: "Failed to create package" });
      return;
    }

    await writeAudit(req, {
      action: "Package uploaded",
      entityType: "package",
      entityId: inserted.id,
      packageId: inserted.id,
      detail: `${inserted.name} (${inserted.sku}) uploaded for review.`,
      after: { name: inserted.name, sku: inserted.sku, vendor: inserted.vendor },
    });

    let current = inserted;

    // Extraction layer. If the client already supplied artwork text — a PDF text
    // layer read in-browser, an image OCR result, or pasted copy — record it as
    // "Provided". Otherwise DO NOT run the OCR provider here: transcribing a
    // scanned PDF / image with Vision is slow and would block the upload. That
    // OCR now runs inside the background analysis job (see runPackageAnalysis),
    // so every upload stays fast while the AI still reads the artwork.
    if (data.extractedText && data.extractedText.trim()) {
      const now = new Date();
      await db
        .update(packagesTable)
        .set({ extractionStatus: "Provided", extractedAt: now })
        .where(eq(packagesTable.id, inserted.id));
      current = { ...inserted, extractionStatus: "Provided", extractedAt: now };
    }

    // Reasoning + assignment now run in the BACKGROUND so the upload returns
    // immediately instead of blocking on a multi-second — and, for high-risk
    // items that escalate to the reasoning tier, multi-minute — AI analysis.
    // The package enters "AI Review"; a durable job analyzes it and routes it to
    // a team, and the review page polls until the results land.
    // Enqueue the background job when there is text to analyze OR artwork to OCR
    // first. Metadata-only packages (no text, no artwork) have nothing to defer,
    // so they fall through to synchronous manual assignment below.
    const hasText = !!(current.extractedText && current.extractedText.trim());
    const hasArtwork = !!(current.artworkUrl && current.artworkUrl.trim());
    if (hasText || hasArtwork) {
      const ctx = getAuthContext(req);
      const supplierId =
        ctx.roleKey === "supplier_user" ? (ctx.supplierId ?? -1) : null;
      await db
        .update(packagesTable)
        .set({ status: "AI Review" })
        .where(eq(packagesTable.id, current.id));
      current = { ...current, status: "AI Review" };
      try {
        await enqueuePackageAnalysis({
          packageId: current.id,
          organizationId,
          supplierId,
          actorUserId: ctx.userId,
          actorName: ctx.name || ctx.email || "System",
        });
      } catch (err) {
        // Enqueue failed: never strand the package in "AI Review" with no job to
        // complete it. Drop it out of the holding state and route it for manual
        // handling, mirroring the no-text branch below.
        logger.error(
          { err, packageId: current.id },
          "Failed to enqueue package analysis; routing for manual review",
        );
        await db
          .update(packagesTable)
          .set({ status: "Needs Review" })
          .where(eq(packagesTable.id, current.id))
          .catch(() => {});
        current = { ...current, status: "Needs Review" };
        try {
          await autoAssignReview({
            organizationId,
            packageId: current.id,
            category: current.category,
            teamName: matchTeamName(current.category),
            priority: "normal",
            actorUserId: ctx.userId,
            actorName: ctx.name || ctx.email || "System",
          });
        } catch (assignErr) {
          logger.error(
            { err: assignErr, packageId: current.id },
            "Auto-assignment failed after enqueue failure",
          );
        }
      }
    } else {
      // Metadata-only package: no text and no artwork to OCR, so there is nothing
      // for the background job to do. Route it for manual handling now.
      try {
        const ctx = getAuthContext(req);
        await autoAssignReview({
          organizationId,
          packageId: current.id,
          category: current.category,
          teamName: matchTeamName(current.category),
          priority: "normal",
          actorUserId: ctx.userId,
          actorName: ctx.name || ctx.email || "System",
        });
      } catch (err) {
        logger.error({ err }, "Auto-assignment failed on create");
      }
    }

    res.status(201).json(await buildDetail(current));
  },
);

async function loadOwnedPackage(
  req: Request,
  res: Response,
  id: number,
): Promise<PackageRow | null> {
  const [pkg] = await db
    .select()
    .from(packagesTable)
    .where(eq(packagesTable.id, id));
  if (!pkg || !canAccessPackage(req, pkg)) {
    res.status(404).json({ error: "Package not found" });
    return null;
  }
  return pkg;
}

// GET /packages/:id
router.get(
  "/packages/:id",
  requirePermission("packages:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const pkg = await loadOwnedPackage(req, res, id);
    if (!pkg) return;
    res.json(await buildDetail(pkg));
  },
);

// GET /packages/:id/thumbnail
// Server-rendered artwork preview for package cards. Rasterizes page 1 of the
// current version's source file (PDF, extensionless legacy uploads, or a
// PDF-compatible .ai) to a small PNG, cached by content hash. Images are served
// as-is; anything unrenderable (.indd, corrupt) returns 404 so the card falls
// back to a typed placeholder. Auth rides on the browser session cookie, same as
// the object-serving route, so plain <img src> tags work.
router.get(
  "/packages/:id/thumbnail",
  requirePermission("packages:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const pkg = await loadOwnedPackage(req, res, id);
    if (!pkg) return;

    const [version] = await db
      .select({
        fileUrl: packageVersionsTable.fileUrl,
        fileHash: packageVersionsTable.fileHash,
        previewUrl: packageVersionsTable.previewUrl,
      })
      .from(packageVersionsTable)
      .where(
        and(
          eq(packageVersionsTable.packageId, id),
          eq(packageVersionsTable.isCurrent, true),
        ),
      )
      .limit(1);

    // Prefer an explicitly attached preview export; otherwise render the source
    // artwork itself.
    const sourceUrl =
      version?.previewUrl ?? version?.fileUrl ?? pkg.artworkUrl ?? null;

    // Only object-storage uploads reach this endpoint. Seed artwork served by
    // the web app (/artwork/...) is always an image shown directly by the card.
    if (!sourceUrl || !sourceUrl.startsWith("/objects/")) {
      res.status(404).json({ error: "No renderable artwork" });
      return;
    }

    // Defense-in-depth: authorize the object itself with the SAME owner-scoping
    // as /storage/objects/*, not just the package. This guards against a version
    // record whose file path is out of the caller's tenant/supplier scope (bad
    // migration, legacy data) ever being read here. Deny-by-default -> 404.
    const owner = await resolveObjectOwner(sourceUrl);
    if (!owner || !canAccessObjectOwner(req, owner)) {
      res.status(404).json({ error: "No renderable artwork" });
      return;
    }

    const cacheKey = version?.fileHash ?? sourceUrl;
    const cached = getCachedThumbnail(cacheKey);
    if (cached) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.end(cached);
      return;
    }

    try {
      const file = await objectStorage.getObjectEntityFile(sourceUrl);
      const { buffer, contentType } =
        await objectStorage.downloadObjectBytes(file);

      // Defensive: if the source is already an image, serve it directly. The
      // card normally renders images itself and won't call this endpoint.
      if (contentType.startsWith("image/")) {
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "private, max-age=86400");
        res.end(buffer);
        return;
      }

      const isPdf =
        contentType === "application/pdf" ||
        buffer.subarray(0, 5).toString("latin1") === "%PDF-";
      if (!isPdf) {
        res.status(404).json({ error: "Not renderable" });
        return;
      }

      const png = await renderPdfThumbnail(buffer);
      setCachedThumbnail(cacheKey, png);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.end(png);
    } catch (err) {
      // Missing/unrenderable artwork is expected for some source types; return
      // 404 so the card shows its placeholder instead of a broken state.
      if (!(err instanceof ThumbnailError)) {
        logger.error({ err, packageId: id }, "thumbnail error");
      } else {
        logger.warn({ err, packageId: id }, "thumbnail render failed");
      }
      res.status(404).json({ error: "Thumbnail unavailable" });
    }
  },
);

// PATCH /packages/:id
router.patch(
  "/packages/:id",
  requirePermission("packages:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const parsed = UpdatePackageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const existing = await loadOwnedPackage(req, res, id);
    if (!existing) return;

    const data = parsed.data;
    await db
      .update(packagesTable)
      .set({
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.reviewer !== undefined ? { reviewer: data.reviewer } : {}),
        ...(data.grade !== undefined ? { grade: data.grade } : {}),
        ...(data.riskScore !== undefined ? { riskScore: data.riskScore } : {}),
        ...(data.complianceStatus !== undefined
          ? { complianceStatus: data.complianceStatus }
          : {}),
      })
      .where(eq(packagesTable.id, id));

    const [updated] = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.id, id));

    await writeAudit(req, {
      action: "Package updated",
      entityType: "package",
      entityId: id,
      packageId: id,
      detail: data.status
        ? `Status changed to ${data.status}.`
        : "Package record updated.",
      before: {
        status: existing.status,
        reviewer: existing.reviewer,
        grade: existing.grade,
        riskScore: existing.riskScore,
        complianceStatus: existing.complianceStatus,
      },
      after: {
        status: updated!.status,
        reviewer: updated!.reviewer,
        grade: updated!.grade,
        riskScore: updated!.riskScore,
        complianceStatus: updated!.complianceStatus,
      },
    });

    // A human review decision (Approved / Needs Revision) closes the active
    // assignment and captures its SLA + duration metrics for reporting.
    if (data.status === "Approved" || data.status === "Needs Revision") {
      const ctx = getAuthContext(req);
      try {
        await completeReview({
          organizationId: orgId(req),
          packageId: id,
          actorUserId: ctx.userId,
          actorName: ctx.name || ctx.email || "Unknown",
          detail: `Review completed with decision: ${data.status}`,
        });
      } catch (err) {
        logger.error({ err }, "Failed to complete review on decision");
      }

      // Distil this review into Compliance Memory so future AI reviews can recall
      // how these findings were resolved. Non-fatal.
      try {
        await captureFindingsForDecision({
          organizationId: orgId(req),
          pkg: updated!,
          decision: data.status,
          actorName: ctx.name || ctx.email || "Unknown",
          actorId: ctx.clerkUserId,
        });
      } catch (err) {
        logger.error({ err }, "Failed to capture findings into compliance memory");
      }
    }

    res.json(await buildDetail(updated!));
  },
);

// DELETE /packages/:id
router.delete(
  "/packages/:id",
  requirePermission("packages:delete"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const existing = await loadOwnedPackage(req, res, id);
    if (!existing) return;
    await writeAudit(req, {
      action: "Package deleted",
      entityType: "package",
      entityId: id,
      packageId: id,
      detail: `${existing.name} (${existing.sku}) deleted.`,
      before: { name: existing.name, sku: existing.sku },
    });
    await db.delete(violationsTable).where(eq(violationsTable.packageId, id));
    await db.delete(packagesTable).where(eq(packagesTable.id, id));
    res.status(204).send();
  },
);

// POST /packages/:id/analyze
router.post(
  "/packages/:id/analyze",
  requirePermission("packages:analyze"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const pkg = await loadOwnedPackage(req, res, id);
    if (!pkg) return;

    const hasText = !!(pkg.extractedText && pkg.extractedText.trim());
    const hasArtwork = !!(pkg.artworkUrl && pkg.artworkUrl.trim());

    // When there's text to analyze or artwork to OCR, run the (potentially
    // multi-minute, reasoning-tier) analysis in the BACKGROUND — the same path as
    // upload — so the request returns immediately. The review page's progress
    // stepper + 4s polling then take over, instead of the "Re-run AI" button
    // hanging with a spinner for the whole analysis.
    if (hasText || hasArtwork) {
      const ctx = getAuthContext(req);
      const supplierId =
        ctx.roleKey === "supplier_user" ? (ctx.supplierId ?? -1) : null;
      // Atomic single-flight guard: claim the package only if it isn't already
      // analyzing. Concurrent re-run requests (double-click, multiple tabs/users,
      // retries) serialize on this row update, so exactly one wins and enqueues a
      // job; the losers see 0 rows and return the current detail idempotently —
      // never a duplicate expensive analysis or an out-of-order overwrite.
      const claimed = await db
        .update(packagesTable)
        .set({ status: "AI Review" })
        .where(and(eq(packagesTable.id, id), ne(packagesTable.status, "AI Review")))
        .returning({ id: packagesTable.id });
      if (claimed.length === 0) {
        const [inFlight] = await db
          .select()
          .from(packagesTable)
          .where(eq(packagesTable.id, id));
        res.json(await buildDetail(inFlight!));
        return;
      }
      try {
        await enqueuePackageAnalysis({
          packageId: id,
          organizationId: orgId(req),
          supplierId,
          actorUserId: ctx.userId,
          actorName: ctx.name || ctx.email || "System",
          // This endpoint backs the manual "Deep Analysis" re-run, so run the
          // thorough, escalation-capable review — as opposed to the fast triage
          // that runs automatically on upload.
          deep: true,
        });
      } catch (err) {
        // Never strand the package in "AI Review" with no job to complete it.
        logger.error({ err, packageId: id }, "Failed to enqueue re-run analysis");
        await db
          .update(packagesTable)
          .set({ status: "Needs Review" })
          .where(eq(packagesTable.id, id))
          .catch(() => {});
        res
          .status(502)
          .json({ error: "Couldn't start AI analysis. Please retry." });
        return;
      }
      const [queued] = await db
        .select()
        .from(packagesTable)
        .where(eq(packagesTable.id, id));
      res.json(await buildDetail(queued!));
      return;
    }

    // Metadata-only package (no text, no artwork): there's nothing to OCR and the
    // background job would just route it for manual review, so analyze inline.
    // This intentionally stays fast (no deep escalation) — it runs synchronously
    // in the request, and a multi-minute deep pass here would hang the response.
    try {
      const { regulations, priorKnowledge, internalStandards, cfrRegulations } =
        await loadAnalysisContext(pkg, req);
      const result = await analyzePackaging(
        pkg,
        regulations,
        priorKnowledge,
        internalStandards,
        cfrRegulations,
      );
      const version = await ensureInitialVersion(pkg);
      await applyAnalysis(pkg, result, version.id, orgId(req));
    } catch (err) {
      logger.error({ err }, "Analysis failed");
      res.status(502).json({ error: "AI analysis failed. Please retry." });
      return;
    }
    const [refreshed] = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.id, id));
    res.json(await buildDetail(refreshed!));
  },
);

// POST /packages/:id/reprocess
// Manual reprocess: force the active OCR provider to re-extract the source
// document (bypassing the cache), then re-run OpenAI analysis on the fresh text.
// This is one of the only triggers allowed to invoke the extraction provider.
router.post(
  "/packages/:id/reprocess",
  requirePermission("packages:analyze"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const pkg = await loadOwnedPackage(req, res, id);
    if (!pkg) return;

    const run = await runExtraction({ req, pkg, force: true });

    if (run.outcome === "NotConfigured") {
      res.status(503).json({
        error: `${getActiveProvider().label} is not configured. Add its credentials to enable document extraction.`,
      });
      return;
    }
    if (run.outcome === "Skipped") {
      res.status(422).json({
        error: run.message ?? "No source document available to extract.",
      });
      return;
    }
    if (run.outcome === "Unsupported") {
      res.status(415).json({
        error: run.message ?? "Unsupported document type for extraction.",
      });
      return;
    }
    if (run.outcome === "Failed") {
      res.status(502).json({
        error: run.message ?? "Document extraction failed. Please retry.",
      });
      return;
    }

    // Extraction succeeded (Complete or Cached). Re-run reasoning on the text.
    const [afterExtract] = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.id, id));
    let current = afterExtract ?? pkg;
    if (current.extractedText && current.extractedText.trim()) {
      try {
        const { regulations, priorKnowledge, internalStandards, cfrRegulations } =
          await loadAnalysisContext(current, req);
        const result = await analyzePackaging(
          current,
          regulations,
          priorKnowledge,
          internalStandards,
          cfrRegulations,
        );
        const version = await ensureInitialVersion(current);
        await applyAnalysis(current, result, version.id, orgId(req));
        const [refreshed] = await db
          .select()
          .from(packagesTable)
          .where(eq(packagesTable.id, id));
        if (refreshed) current = refreshed;
      } catch (err) {
        logger.error({ err }, "Re-analysis after reprocess failed");
      }
    }

    res.json({
      extraction: run.extraction ? mapExtraction(run.extraction) : null,
      package: await buildDetail(current),
    });
  },
);

// POST /packages/:id/copilot
router.post(
  "/packages/:id/copilot",
  requirePermission("packages:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const parsed = AskCopilotBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const pkg = await loadOwnedPackage(req, res, id);
    if (!pkg) return;
    const [violations, regulations] = await Promise.all([
      db.select().from(violationsTable).where(eq(violationsTable.packageId, id)),
      loadRegulations(),
    ]);
    try {
      const answer = await askCompliancePilot(
        pkg,
        violations,
        regulations,
        parsed.data.question,
      );
      res.json(answer);
    } catch (err) {
      logger.error({ err }, "Copilot failed");
      res.status(502).json({ error: "Copilot is unavailable. Please retry." });
    }
  },
);

// GET /packages/:id/audit
router.get(
  "/packages/:id/audit",
  requirePermission("audit:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const pkg = await loadOwnedPackage(req, res, id);
    if (!pkg) return;
    const organizationId = orgId(req);
    const [rows, archived] = await Promise.all([
      db
        .select()
        .from(auditEventsTable)
        .where(
          and(
            eq(auditEventsTable.packageId, id),
            eq(auditEventsTable.organizationId, organizationId),
          ),
        )
        .orderBy(desc(auditEventsTable.createdAt)),
      readArchivedAuditForPackage(organizationId, id),
    ]);
    // Full history = hot rows plus any that have rolled into the archive.
    const merged = [...rows.map(mapAuditEvent), ...archived.map(mapArchivedAudit)];
    merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json(merged);
  },
);

// POST /packages/:id/report
router.post(
  "/packages/:id/report",
  requirePermission("reports:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const parsed = GenerateReportBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const pkg = await loadOwnedPackage(req, res, id);
    if (!pkg) return;
    const [report] = await db
      .insert(reportsTable)
      .values({
        organizationId: orgId(req),
        packageId: id,
        title: parsed.data.title,
        type: parsed.data.type ?? "Compliance",
        format: parsed.data.format ?? "PDF",
        summary:
          pkg.summary ??
          `Compliance report for ${pkg.name} (grade ${pkg.grade ?? "N/A"}).`,
      })
      .returning();

    await writeAudit(req, {
      action: "Report generated",
      entityType: "report",
      entityId: report!.id,
      packageId: id,
      detail: `${parsed.data.title} (${parsed.data.format ?? "PDF"}).`,
    });

    res.status(201).json(mapReport(report!));
  },
);

// POST /packages/bulk-analyze
router.post(
  "/packages/bulk-analyze",
  requirePermission("packages:analyze"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = BulkAnalyzeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const ids = parsed.data.ids;
    if (!ids.length) {
      res.json({ analyzed: 0, passed: 0, failed: 0 });
      return;
    }
    const organizationId = orgId(req);
    const rows = await db
      .select()
      .from(packagesTable)
      .where(and(inArray(packagesTable.id, ids), ...packageConds(req)));
    const regulations = await loadRegulations();

    let passed = 0;
    let failed = 0;
    let analyzed = 0;

    const analyzeOne = async (pkg: (typeof rows)[number]): Promise<void> => {
      try {
        const [priorKnowledge, internalStandards, cfrRegulations] =
          await Promise.all([
            priorKnowledgeFor(pkg, req),
            relevantPoliciesFor(pkg, req),
            ecfrRegulationsFor(pkg),
          ]);
        const result = await analyzePackaging(
          pkg,
          regulations,
          priorKnowledge,
          internalStandards,
          cfrRegulations,
        );
        const version = await ensureInitialVersion(pkg);
        await applyAnalysis(pkg, result, version.id, organizationId);
        analyzed += 1;
        if (result.complianceStatus === "Passed") passed += 1;
        else if (result.complianceStatus === "Failed") failed += 1;
      } catch (err) {
        logger.error({ err, packageId: pkg.id }, "Bulk analysis item failed");
      }
    };

    // Analyze packages with bounded concurrency so a large selection finishes
    // far faster than the old strictly-sequential loop, without firing every AI
    // request at once (which would blow past provider rate limits and DB
    // connection headroom). Workers pull from a shared cursor; JS is
    // single-threaded so the cursor/counter updates need no extra locking. Each
    // worker operates on a distinct package id, so their DB writes never contend.
    const BULK_CONCURRENCY = 4;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < rows.length) {
        const pkg = rows[cursor++]!;
        await analyzeOne(pkg);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(BULK_CONCURRENCY, rows.length) }, () =>
        worker(),
      ),
    );

    res.json({ analyzed, passed, failed });
  },
);

export default router;
