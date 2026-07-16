import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db, jobsTable } from "@workspace/db";
import { sql, gte } from "drizzle-orm";

const router: IRouter = Router();

// Liveness: static 200. Used by the platform to decide whether to restart the
// process — it must NEVER depend on the database or any other dependency, or a
// transient DB hiccup turns into a restart loop.
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Readiness / deep health: verifies the process can actually serve requests.
// - db: a `select 1` bounded by a short timeout (a hung pool must not hang the
//   health check itself).
// - worker: whether any background job row was touched recently. An idle-but-
//   healthy queue reports "idle", never degrades overall status — only the DB
//   gates the 200/503 decision, since the worker is in-process.
// Deliberately unauthenticated (load balancers can't log in) and deliberately
// minimal in what it reveals.
const DB_PING_TIMEOUT_MS = 2_500;
const WORKER_RECENCY_MS = 15 * 60 * 1000;

router.get("/healthz/deep", async (_req, res) => {
  const startedAt = Date.now();
  let dbOk = false;
  let worker: "active" | "idle" | "unknown" = "unknown";

  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("db ping timeout")), DB_PING_TIMEOUT_MS),
      ),
    ]);
    dbOk = true;
  } catch {
    dbOk = false;
  }

  if (dbOk) {
    try {
      // Existence probe (stops at the first match) rather than count(*), so a
      // frequently-polled health check never scans the whole queue table.
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

  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? "ok" : "degraded",
    db: dbOk ? "up" : "down",
    worker,
    latencyMs: Date.now() - startedAt,
  });
});

export default router;
