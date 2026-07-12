import { Router, type IRouter, type Request, type Response } from "express";
import { db, packagesTable, violationsTable } from "@workspace/db";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { requirePermission, orgId } from "../lib/rbac/context";
import { packageConds } from "../lib/rbac/scope";
import { cachedDashboard } from "../lib/cache/dashboard-cache";

const router: IRouter = Router();

// All dashboard aggregates are computed in SQL (GROUP BY / FILTER) rather than by
// pulling every package into the app and reducing in JS. This keeps dashboard
// load time flat as package volume grows and lets the org-scoped indexes do the
// work. On top of that, these hot aggregate reads are cached per caller scope
// for a short TTL (see cachedDashboard) since the dashboard is polled often.

router.get(
  "/dashboard/stats",
  requirePermission("dashboard:read"),
  async (req: Request, res: Response): Promise<void> => {
    const payload = await cachedDashboard(req, "stats", async () => {
        const conds = packageConds(req);
        const [row] = await db
          .select({
            totalPackages: sql<number>`count(*)::int`,
            reviewedToday: sql<number>`count(*) filter (where (${packagesTable.analyzedAt} at time zone 'UTC')::date = (now() at time zone 'UTC')::date)::int`,
            inReview: sql<number>`count(*) filter (where ${packagesTable.status} in ('AI Review','OCR Complete','Uploaded','Resubmitted'))::int`,
            passed: sql<number>`count(*) filter (where ${packagesTable.complianceStatus} = 'Passed')::int`,
            failed: sql<number>`count(*) filter (where ${packagesTable.complianceStatus} = 'Failed')::int`,
            highRisk: sql<number>`count(*) filter (where coalesce(${packagesTable.riskScore}, 0) >= 70)::int`,
            mediumRisk: sql<number>`count(*) filter (where coalesce(${packagesTable.riskScore}, 0) >= 40 and coalesce(${packagesTable.riskScore}, 0) < 70)::int`,
            lowRisk: sql<number>`count(*) filter (where ${packagesTable.riskScore} is not null and ${packagesTable.riskScore} < 40)::int`,
            criticalViolations: sql<number>`coalesce(sum(${packagesTable.criticalCount}), 0)::int`,
            analyzed: sql<number>`count(*) filter (where ${packagesTable.analyzedAt} is not null)::int`,
          })
          .from(packagesTable)
          .where(and(...conds));

        const stats = row!;
        const complianceVelocity =
          stats.analyzed > 0
            ? Math.round((stats.passed / stats.analyzed) * 100)
            : 0;

        return {
          reviewedToday: stats.reviewedToday,
          inReview: stats.inReview,
          passed: stats.passed,
          failed: stats.failed,
          highRisk: stats.highRisk,
          mediumRisk: stats.mediumRisk,
          lowRisk: stats.lowRisk,
          avgReviewMinutes: 3.2,
          complianceVelocity,
          totalPackages: stats.totalPackages,
          criticalViolations: stats.criticalViolations,
        };
      },
    );
    res.json(payload);
  },
);

router.get(
  "/dashboard/trends",
  requirePermission("dashboard:read"),
  async (req: Request, res: Response): Promise<void> => {
    const payload = await cachedDashboard(req, "trends", async () => {
        const conds = packageConds(req);
        const rows = await db
          .select({
            day: sql<string>`to_char((${packagesTable.analyzedAt} at time zone 'UTC')::date, 'YYYY-MM-DD')`,
            volume: sql<number>`count(*)::int`,
            passed: sql<number>`count(*) filter (where ${packagesTable.complianceStatus} = 'Passed')::int`,
            failed: sql<number>`count(*) filter (where ${packagesTable.complianceStatus} = 'Failed')::int`,
            // Match prior JS semantics: treat NULL risk as 0 and divide by the
            // day's total package count (not just scored rows).
            avgRisk: sql<number>`coalesce(round(sum(coalesce(${packagesTable.riskScore}, 0))::numeric / nullif(count(*), 0)), 0)::int`,
          })
          .from(packagesTable)
          .where(
            and(
              ...conds,
              isNotNull(packagesTable.analyzedAt),
              gte(
                packagesTable.analyzedAt,
                sql`(now() at time zone 'UTC')::date - interval '13 days'`,
              ),
            ),
          )
          .groupBy(sql`1`);

        const byDay = new Map(rows.map((r) => [r.day, r]));

        const result: {
          date: string;
          passed: number;
          failed: number;
          reviewVolume: number;
          avgRisk: number;
        }[] = [];
        const now = new Date();
        for (let i = 13; i >= 0; i--) {
          const d = new Date(now);
          d.setUTCDate(now.getUTCDate() - i);
          const key = d.toISOString().slice(0, 10);
          const hit = byDay.get(key);
          result.push({
            date: d.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            }),
            passed: hit?.passed ?? 0,
            failed: hit?.failed ?? 0,
            reviewVolume: hit?.volume ?? 0,
            avgRisk: hit?.avgRisk ?? 0,
          });
        }

        return result;
      },
    );
    res.json(payload);
  },
);

router.get(
  "/dashboard/violation-distribution",
  requirePermission("dashboard:read"),
  async (req: Request, res: Response): Promise<void> => {
    const payload = await cachedDashboard(
      req,
      "violation-distribution",
      async () =>
        db
          .select({
            label: violationsTable.engine,
            count: sql<number>`count(*)::int`,
          })
          .from(violationsTable)
          .where(eq(violationsTable.organizationId, orgId(req)))
          .groupBy(violationsTable.engine)
          .orderBy(sql`count(*) desc`),
    );
    res.json(payload);
  },
);

router.get(
  "/dashboard/category-distribution",
  requirePermission("dashboard:read"),
  async (req: Request, res: Response): Promise<void> => {
    const payload = await cachedDashboard(
      req,
      "category-distribution",
      async () =>
        db
          .select({
            label: packagesTable.category,
            count: sql<number>`count(*)::int`,
          })
          .from(packagesTable)
          .where(and(...packageConds(req)))
          .groupBy(packagesTable.category)
          .orderBy(sql`count(*) desc`),
    );
    res.json(payload);
  },
);

router.get(
  "/dashboard/vendor-performance",
  requirePermission("dashboard:read"),
  async (req: Request, res: Response): Promise<void> => {
    const payload = await cachedDashboard(req, "vendor-performance", async () => {
        const rows = await db
          .select({
            vendor: packagesTable.vendor,
            packages: sql<number>`count(*)::int`,
            failed: sql<number>`count(*) filter (where ${packagesTable.complianceStatus} = 'Failed')::int`,
            scored: sql<number>`count(${packagesTable.riskScore})::int`,
            avgRisk: sql<number>`coalesce(round(avg(${packagesTable.riskScore})), 0)::int`,
          })
          .from(packagesTable)
          .where(and(...packageConds(req)))
          .groupBy(packagesTable.vendor);

        return rows
          .map((e) => ({
            vendor: e.vendor,
            complianceScore: e.scored > 0 ? Math.max(0, 100 - e.avgRisk) : 100,
            packages: e.packages,
            failed: e.failed,
          }))
          .sort((a, b) => b.complianceScore - a.complianceScore);
      },
    );
    res.json(payload);
  },
);

export default router;
