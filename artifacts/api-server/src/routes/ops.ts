import { Router, type IRouter, type Request, type Response } from "express";
import { db, jobsTable } from "@workspace/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { mapJob } from "../lib/mappers";
import { requirePermission, orgId } from "../lib/rbac/context";

const router: IRouter = Router();

// GET /ops/queue/metrics — background job queue health, scoped to the caller's
// organization: counts by status, a per-type breakdown, throughput over the
// last 24h, and the most recent failures. The jobs table is the durable queue.
router.get(
  "/ops/queue/metrics",
  requirePermission("org:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const org = orgId(req);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const statusRows = await db
      .select({ status: jobsTable.status, count: sql<number>`count(*)::int` })
      .from(jobsTable)
      .where(eq(jobsTable.organizationId, org))
      .groupBy(jobsTable.status);
    const byStatus: Record<string, number> = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      canceled: 0,
    };
    for (const r of statusRows) byStatus[r.status] = r.count;

    const typeRows = await db
      .select({
        type: jobsTable.type,
        status: jobsTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(jobsTable)
      .where(eq(jobsTable.organizationId, org))
      .groupBy(jobsTable.type, jobsTable.status);
    const typeMap = new Map<
      string,
      { type: string; pending: number; running: number; completed: number; failed: number }
    >();
    for (const r of typeRows) {
      const entry =
        typeMap.get(r.type) ??
        { type: r.type, pending: 0, running: 0, completed: 0, failed: 0 };
      if (r.status === "pending") entry.pending += r.count;
      else if (r.status === "running") entry.running += r.count;
      else if (r.status === "completed") entry.completed += r.count;
      else if (r.status === "failed") entry.failed += r.count;
      typeMap.set(r.type, entry);
    }

    const [{ count: completed24h } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.organizationId, org),
          eq(jobsTable.status, "completed"),
          gte(jobsTable.updatedAt, dayAgo),
        ),
      );

    const [{ count: failed24h } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.organizationId, org),
          eq(jobsTable.status, "failed"),
          gte(jobsTable.updatedAt, dayAgo),
        ),
      );

    const recentFailures = await db
      .select()
      .from(jobsTable)
      .where(and(eq(jobsTable.organizationId, org), eq(jobsTable.status, "failed")))
      .orderBy(desc(jobsTable.updatedAt))
      .limit(10);

    res.json({
      byStatus,
      backlog: byStatus.pending + byStatus.running,
      completed24h,
      failed24h,
      byType: [...typeMap.values()].sort((a, b) => a.type.localeCompare(b.type)),
      recentFailures: recentFailures.map(mapJob),
    });
  },
);

// GET /ops/system/health — a lightweight liveness view scoped to the caller's
// organization: database connectivity, whether the job worker has claimed work
// recently, and current backlog.
router.get(
  "/ops/system/health",
  requirePermission("org:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const org = orgId(req);
    let dbOk = true;
    try {
      await db.execute(sql`select 1`);
    } catch {
      dbOk = false;
    }

    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
    const [{ count: recentActivity } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobsTable)
      .where(and(eq(jobsTable.organizationId, org), gte(jobsTable.updatedAt, fifteenMinAgo)));

    const [{ count: pending } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobsTable)
      .where(and(eq(jobsTable.organizationId, org), eq(jobsTable.status, "pending")));

    const [{ count: stale } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.organizationId, org),
          eq(jobsTable.status, "running"),
          sql`${jobsTable.lockedAt} < ${fifteenMinAgo.toISOString()}`,
        ),
      );

    const services = [
      { name: "Database", status: dbOk ? "operational" : "down", detail: dbOk ? "Connected" : "Unreachable" },
      {
        name: "Background Worker",
        status: recentActivity > 0 ? "operational" : "idle",
        detail: recentActivity > 0 ? "Processing jobs" : "No recent activity",
      },
      {
        name: "Review Queue",
        status: stale > 0 ? "degraded" : "operational",
        detail: stale > 0 ? `${stale} stalled job(s)` : `${pending} pending`,
      },
    ];

    const overall = services.some((s) => s.status === "down")
      ? "down"
      : services.some((s) => s.status === "degraded")
        ? "degraded"
        : "operational";

    res.json({
      overall,
      checkedAt: new Date().toISOString(),
      services,
      pendingJobs: pending,
      stalledJobs: stale,
    });
  },
);

export default router;
