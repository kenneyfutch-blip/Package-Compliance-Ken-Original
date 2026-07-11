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
} from "../lib/mappers";
import {
  analyzePackaging,
  askCompliancePilot,
  type AnalysisResult,
} from "../lib/ai";
import { logger } from "../lib/logger";

const router: IRouter = Router();

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

  await db.insert(auditEventsTable).values({
    packageId: pkg.id,
    actor: "AI Compliance Engine",
    action: "Analysis completed",
    detail: `Grade ${result.grade}, risk ${result.riskScore}, ${result.violations.length} issue(s) detected. Status: ${result.complianceStatus}.`,
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
router.get("/packages", async (req: Request, res: Response): Promise<void> => {
  const { search, status, category, risk, vendor, engine } = req.query;
  const conditions: SQL[] = [];

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
        and(gte(packagesTable.riskScore, 40), lt(packagesTable.riskScore, 70))!,
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
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(packagesTable.createdAt));

  res.json(rows.map(mapPackage));
});

// POST /packages
router.post("/packages", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreatePackageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;

  const [inserted] = await db
    .insert(packagesTable)
    .values({
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

  await db.insert(auditEventsTable).values({
    packageId: inserted.id,
    actor: "System",
    action: "Package uploaded",
    detail: `${inserted.name} (${inserted.sku}) uploaded for review.`,
  });

  let current = inserted;
  if (data.extractedText && data.extractedText.trim()) {
    try {
      const regulations = await loadRegulations();
      const result = await analyzePackaging(inserted, regulations);
      await applyAnalysis(inserted, result);
      const [refreshed] = await db
        .select()
        .from(packagesTable)
        .where(eq(packagesTable.id, inserted.id));
      if (refreshed) current = refreshed;
    } catch (err) {
      logger.error({ err }, "Auto-analysis failed on create");
    }
  }

  res.status(201).json(await buildDetail(current));
});

// GET /packages/:id
router.get(
  "/packages/:id",
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const [pkg] = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.id, id));
    if (!pkg) {
      res.status(404).json({ error: "Package not found" });
      return;
    }
    res.json(await buildDetail(pkg));
  },
);

// PATCH /packages/:id
router.patch(
  "/packages/:id",
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const parsed = UpdatePackageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [existing] = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Package not found" });
      return;
    }

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

    await db.insert(auditEventsTable).values({
      packageId: id,
      actor: existing.reviewer ?? "Reviewer",
      action: "Package updated",
      detail: data.status
        ? `Status changed to ${data.status}.`
        : "Package record updated.",
    });

    const [updated] = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.id, id));
    res.json(await buildDetail(updated!));
  },
);

// DELETE /packages/:id
router.delete(
  "/packages/:id",
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const [existing] = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Package not found" });
      return;
    }
    await db.delete(violationsTable).where(eq(violationsTable.packageId, id));
    await db.delete(packagesTable).where(eq(packagesTable.id, id));
    res.status(204).send();
  },
);

// POST /packages/:id/analyze
router.post(
  "/packages/:id/analyze",
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const [pkg] = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.id, id));
    if (!pkg) {
      res.status(404).json({ error: "Package not found" });
      return;
    }
    try {
      const regulations = await loadRegulations();
      const result = await analyzePackaging(pkg, regulations);
      await applyAnalysis(pkg, result);
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

// POST /packages/:id/copilot
router.post(
  "/packages/:id/copilot",
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const parsed = AskCopilotBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [pkg] = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.id, id));
    if (!pkg) {
      res.status(404).json({ error: "Package not found" });
      return;
    }
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
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const rows = await db
      .select()
      .from(auditEventsTable)
      .where(eq(auditEventsTable.packageId, id))
      .orderBy(desc(auditEventsTable.createdAt));
    res.json(rows.map(mapAuditEvent));
  },
);

// POST /packages/:id/report
router.post(
  "/packages/:id/report",
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const parsed = GenerateReportBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [pkg] = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.id, id));
    if (!pkg) {
      res.status(404).json({ error: "Package not found" });
      return;
    }
    const [report] = await db
      .insert(reportsTable)
      .values({
        packageId: id,
        title: parsed.data.title,
        type: parsed.data.type ?? "Compliance",
        format: parsed.data.format ?? "PDF",
        summary:
          pkg.summary ??
          `Compliance report for ${pkg.name} (grade ${pkg.grade ?? "N/A"}).`,
      })
      .returning();

    await db.insert(auditEventsTable).values({
      packageId: id,
      actor: "Reviewer",
      action: "Report generated",
      detail: `${parsed.data.title} (${parsed.data.format ?? "PDF"}).`,
    });

    res.status(201).json(mapReport(report!));
  },
);

// POST /packages/bulk-analyze
router.post(
  "/packages/bulk-analyze",
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
    const rows = await db
      .select()
      .from(packagesTable)
      .where(inArray(packagesTable.id, ids));
    const regulations = await loadRegulations();

    let passed = 0;
    let failed = 0;
    let analyzed = 0;
    for (const pkg of rows) {
      try {
        const result = await analyzePackaging(pkg, regulations);
        await applyAnalysis(pkg, result);
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
