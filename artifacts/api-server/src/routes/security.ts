// Security posture endpoints for the admin "Security Posture" page and the
// downloadable PDF audit report. Gated to org administrators.
import { Router, type IRouter, type Request, type Response } from "express";
import { db, jobsTable } from "@workspace/db";
import { sql, gte } from "drizzle-orm";
import { requirePermission } from "../lib/rbac/context";
import {
  AUDIT_HISTORY,
  POSTURE_META,
  SECURITY_CONTROLS,
} from "../lib/security-posture";
import { buildSecurityReportPdf } from "../lib/security-report";

const router: IRouter = Router();

const DB_PING_TIMEOUT_MS = 2_500;
const WORKER_RECENCY_MS = 15 * 60 * 1000;

// GET /security/posture — control catalog + audit history + live checks, for
// the cyber-security team's real-time reference page.
router.get(
  "/security/posture",
  requirePermission("org:manage"),
  async (_req: Request, res: Response): Promise<void> => {
    let dbOk = false;
    let worker: "active" | "idle" | "unknown" = "unknown";
    try {
      await Promise.race([
        db.execute(sql`select 1`),
        new Promise((_r, reject) =>
          setTimeout(() => reject(new Error("db ping timeout")), DB_PING_TIMEOUT_MS),
        ),
      ]);
      dbOk = true;
    } catch {
      dbOk = false;
    }
    if (dbOk) {
      try {
        const cutoff = new Date(Date.now() - WORKER_RECENCY_MS);
        const [row] = await db
          .select({ one: sql<number>`1` })
          .from(jobsTable)
          .where(gte(jobsTable.updatedAt, cutoff))
          .limit(1);
        worker = row ? "active" : "idle";
      } catch {
        worker = "unknown";
      }
    }

    res.json({
      generatedAt: new Date().toISOString(),
      meta: POSTURE_META,
      controls: SECURITY_CONTROLS,
      audits: AUDIT_HISTORY,
      live: {
        database: dbOk ? "connected" : "unreachable",
        backgroundWorker: worker,
        environment: process.env["NODE_ENV"] === "production" ? "production" : "development",
        authGuard: "active", // reaching this handler proves the global requireAuth + permission gate ran
      },
    });
  },
);

// GET /security/report.pdf — downloadable audit & posture report.
router.get(
  "/security/report.pdf",
  requirePermission("org:manage"),
  (_req: Request, res: Response): void => {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="security-audit-report.pdf"',
    );
    const doc = buildSecurityReportPdf();
    doc.pipe(res);
  },
);

export default router;
