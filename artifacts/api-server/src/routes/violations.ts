import { Router, type IRouter, type Request, type Response } from "express";
import { db, violationsTable, packagesTable } from "@workspace/db";
import {
  eq,
  and,
  or,
  ilike,
  inArray,
  desc,
  sql,
  type SQL,
} from "drizzle-orm";
import { requirePermission, getAuthContext } from "../lib/rbac/context";
import { packageConds } from "../lib/rbac/scope";
import { writeAudit } from "../lib/audit";
import { recomputePackageCounts } from "../lib/packageService";
import { mapViolation } from "../lib/mappers";
import {
  captureFindingDismissal,
  removeFindingMemory,
} from "../lib/memory/engine";
import {
  NOT_APPLICABLE_STATUS,
  OPEN_STATUS,
  dismissReasonLabel,
} from "../lib/violations/status";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const RESOLVED_STATUSES = ["Resolved", "Fixed", "Accepted", "Closed"];
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function toInt(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// GET /violations — every violation the caller may see, joined with package context.
router.get(
  "/violations",
  requirePermission("violations:read"),
  async (req: Request, res: Response): Promise<void> => {
    const { search, engine, severity, status, vendor, category, resolved } =
      req.query;
    const limit = Math.min(toInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const offset = toInt(req.query.offset, 0);
    // Tenant + supplier scoping is applied on the joined package.
    const conditions: SQL[] = [...packageConds(req)];

    if (typeof search === "string" && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(
        or(
          ilike(violationsTable.title, term),
          ilike(violationsTable.description, term),
          ilike(violationsTable.detectedText, term),
          ilike(violationsTable.suggestedText, term),
          ilike(packagesTable.name, term),
          ilike(packagesTable.sku, term),
          ilike(packagesTable.vendor, term),
        )!,
      );
    }
    if (typeof engine === "string" && engine) {
      conditions.push(eq(violationsTable.engine, engine));
    }
    if (typeof severity === "string" && severity) {
      conditions.push(eq(violationsTable.severity, severity));
    }
    if (typeof status === "string" && status) {
      conditions.push(eq(violationsTable.status, status));
    }
    if (typeof vendor === "string" && vendor) {
      conditions.push(eq(packagesTable.vendor, vendor));
    }
    if (typeof category === "string" && category) {
      conditions.push(eq(packagesTable.category, category));
    }
    // Resolution is a violation-level state, not a package-level one.
    if (resolved === "true") {
      conditions.push(inArray(violationsTable.status, RESOLVED_STATUSES));
    } else if (resolved === "false") {
      conditions.push(eq(violationsTable.status, "Open"));
    }

    const severityRank = sql`CASE ${violationsTable.severity}
      WHEN 'critical' THEN 0
      WHEN 'major' THEN 1
      WHEN 'minor' THEN 2
      ELSE 3 END`;

    const rows = await db
      .select({
        id: violationsTable.id,
        packageId: violationsTable.packageId,
        severity: violationsTable.severity,
        engine: violationsTable.engine,
        title: violationsTable.title,
        description: violationsTable.description,
        regulationRef: violationsTable.regulationRef,
        recommendation: violationsTable.recommendation,
        detectedText: violationsTable.detectedText,
        suggestedText: violationsTable.suggestedText,
        status: violationsTable.status,
        createdAt: violationsTable.createdAt,
        packageSku: packagesTable.sku,
        packageName: packagesTable.name,
        vendor: packagesTable.vendor,
        category: packagesTable.category,
        packageStatus: packagesTable.status,
        complianceStatus: packagesTable.complianceStatus,
        grade: packagesTable.grade,
        riskScore: packagesTable.riskScore,
      })
      .from(violationsTable)
      .innerJoin(
        packagesTable,
        eq(violationsTable.packageId, packagesTable.id),
      )
      .where(and(...conditions))
      // Deterministic ordering: severity, then newest, with id as tie-breaker.
      .orderBy(
        severityRank,
        desc(violationsTable.createdAt),
        desc(violationsTable.id),
      )
      .limit(limit)
      .offset(offset);

    res.json(
      rows.map((r) => ({
        ...r,
        createdAt: new Date(r.createdAt).toISOString(),
      })),
    );
  },
);

// POST /violations/:id/dismiss — mark a finding "Not Applicable" (e.g. the AI
// OCR'd prepress/production-layer content: color callouts, file names, dielines).
// The finding is kept for the audit trail but excluded from the compliance score
// and captured into compliance memory so future AI reviews learn to treat
// similar content as a non-issue.
router.post(
  "/violations/:id/dismiss",
  requirePermission("violations:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid violation id" });
      return;
    }
    const reasonKey =
      typeof req.body?.reason === "string" ? req.body.reason : null;
    const note =
      typeof req.body?.note === "string" && req.body.note.trim()
        ? req.body.note.trim().slice(0, 1000)
        : null;

    // Load the finding within the caller's tenant/supplier scope (scoping is
    // applied on the joined package).
    const [found] = await db
      .select({ v: violationsTable, pkg: packagesTable })
      .from(violationsTable)
      .innerJoin(packagesTable, eq(violationsTable.packageId, packagesTable.id))
      .where(and(eq(violationsTable.id, id), ...packageConds(req)));
    if (!found) {
      res.status(404).json({ error: "Finding not found" });
      return;
    }

    const ctx = getAuthContext(req);
    const reasonLabel = dismissReasonLabel(reasonKey);
    // Preserve the status the finding held before dismissal so Restore returns
    // it exactly (guard against a re-dismiss clobbering the saved prior state).
    const priorStatus =
      found.v.status === NOT_APPLICABLE_STATUS
        ? (found.v.dismissPriorStatus ?? OPEN_STATUS)
        : found.v.status;
    // Status change + score recompute are atomic so counts never drift from the
    // finding's state; memory + audit follow the committed change.
    await db.transaction(async (tx) => {
      await tx
        .update(violationsTable)
        .set({
          status: NOT_APPLICABLE_STATUS,
          dismissReason: reasonLabel,
          dismissNote: note,
          dismissedBy: ctx.name || ctx.email || "Unknown",
          dismissedByUserId: ctx.userId,
          dismissedAt: new Date(),
          dismissPriorStatus: priorStatus,
        })
        .where(eq(violationsTable.id, id));
      // A dismissed finding no longer counts against the compliance score.
      await recomputePackageCounts(found.pkg.id, tx);
    });

    const [updated] = await db
      .select()
      .from(violationsTable)
      .where(eq(violationsTable.id, id));

    // Feed compliance memory — non-fatal, must never break the dismissal.
    try {
      await captureFindingDismissal({
        organizationId: ctx.organizationId,
        pkg: found.pkg,
        violation: updated,
        actorName: ctx.name || ctx.email || "Unknown",
        actorId: ctx.clerkUserId,
      });
    } catch (err) {
      logger.error(
        { err, violationId: id },
        "Failed to capture finding dismissal into compliance memory",
      );
    }

    await writeAudit(req, {
      action: "finding.dismiss",
      entityType: "violation",
      entityId: id,
      packageId: found.pkg.id,
      detail: `Marked finding "${found.v.title}" not applicable — ${reasonLabel}${
        note ? `: ${note}` : ""
      }`,
      before: { status: found.v.status },
      after: { status: NOT_APPLICABLE_STATUS, dismissReason: reasonLabel },
    });

    res.json(mapViolation(updated));
  },
);

// POST /violations/:id/restore — undo a dismissal, returning the finding to the
// exact status it held before dismissal so it counts against the score again, and
// dropping its dismissal memory. Rejects (409) if the finding is not dismissed.
router.post(
  "/violations/:id/restore",
  requirePermission("violations:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid violation id" });
      return;
    }
    const [found] = await db
      .select({ v: violationsTable, pkg: packagesTable })
      .from(violationsTable)
      .innerJoin(packagesTable, eq(violationsTable.packageId, packagesTable.id))
      .where(and(eq(violationsTable.id, id), ...packageConds(req)));
    if (!found) {
      res.status(404).json({ error: "Finding not found" });
      return;
    }
    // Restore only undoes a dismissal — never mutate a finding that is not
    // currently dismissed (that would force it to Open and wipe metadata).
    if (found.v.status !== NOT_APPLICABLE_STATUS) {
      res.status(409).json({ error: "Finding is not dismissed" });
      return;
    }

    const ctx = getAuthContext(req);
    const restoredStatus = found.v.dismissPriorStatus ?? OPEN_STATUS;
    await db.transaction(async (tx) => {
      await tx
        .update(violationsTable)
        .set({
          status: restoredStatus,
          dismissReason: null,
          dismissNote: null,
          dismissedBy: null,
          dismissedByUserId: null,
          dismissedAt: null,
          dismissPriorStatus: null,
        })
        .where(eq(violationsTable.id, id));
      await recomputePackageCounts(found.pkg.id, tx);
    });

    const [updated] = await db
      .select()
      .from(violationsTable)
      .where(eq(violationsTable.id, id));

    try {
      await removeFindingMemory(ctx.organizationId, id);
    } catch (err) {
      logger.error(
        { err, violationId: id },
        "Failed to remove finding dismissal from compliance memory",
      );
    }

    await writeAudit(req, {
      action: "finding.restore",
      entityType: "violation",
      entityId: id,
      packageId: found.pkg.id,
      detail: `Restored finding "${found.v.title}" to ${restoredStatus}`,
      before: { status: found.v.status },
      after: { status: restoredStatus },
    });

    res.json(mapViolation(updated));
  },
);

export default router;
