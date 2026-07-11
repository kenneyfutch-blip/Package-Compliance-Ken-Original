import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  packagesTable,
  violationsTable,
  regulationsTable,
  auditEventsTable,
  reportsTable,
  type PackageRow,
} from "@workspace/db";
import {
  eq,
  desc,
  and,
  or,
  ilike,
  inArray,
  gte,
  lt,
  type SQL,
} from "drizzle-orm";
import {
  CreatePackageBody,
  UpdatePackageBody,
  AskCopilotBody,
  GenerateReportBody,
  BulkAnalyzeBody,
} from "@workspace/api-zod";
import {
  mapPackage,
  mapPackageDetail,
  mapAuditEvent,
  mapReport,
  mapExtraction,
} from "../lib/mappers";
import { runExtraction } from "../lib/document-ai/service";
import {
  analyzePackaging,
  askCompliancePilot,
  type AnalysisResult,
} from "../lib/ai";
import { logger } from "../lib/logger";
import { requirePermission, orgId, getAuthContext } from "../lib/rbac/context";
import { packageConds, canAccessPackage } from "../lib/rbac/scope";
import { writeAudit } from "../lib/audit";
import { autoAssignReview, completeReview } from "../lib/reviews/engine";
import { matchTeamName } from "../lib/reviews/routing";
import {
  retrieveSimilarFindings,
  captureFindingsForDecision,
  packageQueryText,
  formatMemoryForPrompt,
} from "../lib/memory/engine";
import { readArchivedAuditForPackage } from "../lib/maintenance/archive";

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
    const supplierName =
      ctx.roleKey === "supplier_user"
        ? (ctx.supplierName ?? "___no_supplier___")
        : null;
    const similar = await retrieveSimilarFindings({
      organizationId: ctx.organizationId,
      queryText: packageQueryText(pkg),
      limit: 6,
      excludePackageId: pkg.id,
      supplierName,
    });
    return formatMemoryForPrompt(similar) || undefined;
  } catch (err) {
    logger.error({ err }, "Compliance memory recall failed");
    return undefined;
  }
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

function gradeToStatus(complianceStatus: string): string {
  if (complianceStatus === "Passed") return "Approved";
  if (complianceStatus === "Failed") return "Needs Revision";
  return "AI Review";
}

async function applyAnalysis(
  pkg: PackageRow,
  result: AnalysisResult,
  organizationId: number,
): Promise<void> {
  const counts = result.violations.reduce(
    (acc, v) => {
      if (v.severity === "critical") acc.critical += 1;
      else if (v.severity === "major") acc.major += 1;
      else if (v.severity === "minor") acc.minor += 1;
      return acc;
    },
    { critical: 0, major: 0, minor: 0 },
  );

  await db
    .update(packagesTable)
    .set({
      category: result.category,
      grade: result.grade,
      riskScore: result.riskScore,
      complianceStatus: result.complianceStatus,
      status: gradeToStatus(result.complianceStatus),
      summary: result.summary,
      ocr: result.ocr,
      recommendations: result.recommendations,
      criticalCount: counts.critical,
      majorCount: counts.major,
      minorCount: counts.minor,
      analyzedAt: new Date(),
    })
    .where(eq(packagesTable.id, pkg.id));

  await db.delete(violationsTable).where(eq(violationsTable.packageId, pkg.id));

  if (result.violations.length > 0) {
    await db.insert(violationsTable).values(
      result.violations.map((v) => ({
        organizationId,
        packageId: pkg.id,
        severity: v.severity,
        engine: v.engine,
        title: v.title,
        description: v.description,
        regulationRef: v.regulationRef,
        recommendation: v.recommendation,
        detectedText: v.detectedText,
        suggestedText: v.suggestedText,
        bboxX: v.bbox?.x ?? null,
        bboxY: v.bbox?.y ?? null,
        bboxW: v.bbox?.w ?? null,
        bboxH: v.bbox?.h ?? null,
        status: "Open",
      })),
    );
  }

  const regulationRefs = Array.from(
    new Set(
      result.violations
        .map((v) => v.regulationRef)
        .filter((r): r is string => Boolean(r)),
    ),
  );

  await db.insert(auditEventsTable).values({
    organizationId,
    packageId: pkg.id,
    entityType: "package",
    entityId: pkg.id,
    actor: "AI Compliance Engine",
    action: "Analysis completed",
    detail: `Grade ${result.grade}, risk ${result.riskScore}, ${result.violations.length} issue(s) detected. Status: ${result.complianceStatus}.`,
    regulationRefs,
  });
}

async function loadRegulations() {
  return db.select().from(regulationsTable);
}

async function buildDetail(pkg: PackageRow) {
  const [violations, regulations] = await Promise.all([
    db
      .select()
      .from(violationsTable)
      .where(eq(violationsTable.packageId, pkg.id)),
    loadRegulations(),
  ]);
  return mapPackageDetail(pkg, violations, regulations);
}

// GET /packages
router.get(
  "/packages",
  requirePermission("packages:read"),
  async (req: Request, res: Response): Promise<void> => {
    const { search, status, category, risk, vendor, engine } = req.query;
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
      .orderBy(desc(packagesTable.createdAt));

    res.json(rows.map(mapPackage));
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

    const [inserted] = await db
      .insert(packagesTable)
      .values({
        organizationId,
        sku: data.sku,
        upc: data.upc ?? null,
        name: data.name,
        brand: data.brand,
        vendor: data.vendor,
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

    // Extraction layer: Google Document AI runs on new-package upload. When it
    // is not configured, this is a no-op and we fall back to any supplied text.
    try {
      const run = await runExtraction({ req, pkg: inserted });
      if (run.outcome === "Complete" || run.outcome === "Cached") {
        const [afterExtract] = await db
          .select()
          .from(packagesTable)
          .where(eq(packagesTable.id, inserted.id));
        if (afterExtract) current = afterExtract;
      }
    } catch (err) {
      logger.error({ err }, "Document extraction failed on create");
    }

    // Reasoning layer: OpenAI analysis runs once we have extracted text, whether
    // it came from Document AI or was supplied on the request.
    if (current.extractedText && current.extractedText.trim()) {
      try {
        const regulations = await loadRegulations();
        const priorKnowledge = await priorKnowledgeFor(current, req);
        const result = await analyzePackaging(current, regulations, priorKnowledge);
        await applyAnalysis(current, result, organizationId);
        const [refreshed] = await db
          .select()
          .from(packagesTable)
          .where(eq(packagesTable.id, inserted.id));
        if (refreshed) current = refreshed;
      } catch (err) {
        logger.error({ err }, "Auto-analysis failed on create");
      }
    }

    // Assignment layer: route the package to the right team by category and
    // load-balance it onto the least-loaded specialist. Non-fatal — a failure
    // here must not block package creation.
    try {
      const ctx = getAuthContext(req);
      await autoAssignReview({
        organizationId,
        packageId: current.id,
        category: current.category,
        teamName: matchTeamName(current.category),
        priority: (current.criticalCount ?? 0) > 0 ? "critical" : "normal",
        actorUserId: ctx.userId,
        actorName: ctx.name || ctx.email || "System",
      });
    } catch (err) {
      logger.error({ err }, "Auto-assignment failed on create");
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
    try {
      const regulations = await loadRegulations();
      const priorKnowledge = await priorKnowledgeFor(pkg, req);
      const result = await analyzePackaging(pkg, regulations, priorKnowledge);
      await applyAnalysis(pkg, result, orgId(req));
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
// Manual reprocess: force Google Document AI to re-extract the source document
// (bypassing the cache), then re-run OpenAI analysis on the fresh text. This is
// one of the only triggers allowed to invoke Document AI.
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
        error:
          "Google Document AI is not configured. Add the Document AI environment variables to enable extraction.",
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
        const regulations = await loadRegulations();
        const priorKnowledge = await priorKnowledgeFor(current, req);
        const result = await analyzePackaging(current, regulations, priorKnowledge);
        await applyAnalysis(current, result, orgId(req));
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
    for (const pkg of rows) {
      try {
        const priorKnowledge = await priorKnowledgeFor(pkg, req);
        const result = await analyzePackaging(pkg, regulations, priorKnowledge);
        await applyAnalysis(pkg, result, organizationId);
        analyzed += 1;
        if (result.complianceStatus === "Passed") passed += 1;
        else if (result.complianceStatus === "Failed") failed += 1;
      } catch (err) {
        logger.error({ err, packageId: pkg.id }, "Bulk analysis item failed");
      }
    }

    res.json({ analyzed, passed, failed });
  },
);

export default router;
