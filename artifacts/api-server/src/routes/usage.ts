import { Router, type IRouter, type Request, type Response } from "express";
import { db, aiUsageTable, usersTable } from "@workspace/db";
import { and, desc, eq, gte, lt, or, sql, type SQL } from "drizzle-orm";
import { requirePermission, orgId } from "../lib/rbac/context";
import { cachedDashboard } from "../lib/cache/dashboard-cache";
import { parsePagination } from "../lib/pagination";
import {
  EXPORT_COLUMNS,
  EXPORT_PAGE_SIZE,
  csvRow,
  formatExportRow,
  type Cursor,
} from "./usage-export";

const router: IRouter = Router();

// AI usage & cost analytics. Every row is org-scoped and aggregates are computed
// in SQL (never by pulling rows into the app). All endpoints are gated on
// dashboard:read (same as the rest of the admin analytics area) and filter by
// the caller's organization so one tenant can never see another's AI spend.

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 180;

// Parse a YYYY-MM-DD query value into a UTC day boundary. Returns null when the
// value is absent or malformed.
function parseDay(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Resolve the [from, toExclusive) window from the request query, defaulting to
// the last 30 days and clamping the span to MAX_RANGE_DAYS.
function resolveRange(req: Request): {
  from: Date;
  toExclusive: Date;
  fromStr: string;
  toStr: string;
} {
  const todayStart = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    ),
  );
  const toDay = parseDay(req.query["to"]) ?? todayStart;
  let fromDay = parseDay(req.query["from"]) ?? new Date(toDay.getTime() - 29 * DAY_MS);
  if (fromDay.getTime() > toDay.getTime()) fromDay = toDay;
  // Clamp the span so a client can never request an unbounded date fill.
  if (toDay.getTime() - fromDay.getTime() > (MAX_RANGE_DAYS - 1) * DAY_MS) {
    fromDay = new Date(toDay.getTime() - (MAX_RANGE_DAYS - 1) * DAY_MS);
  }
  const toExclusive = new Date(toDay.getTime() + DAY_MS);
  return {
    from: fromDay,
    toExclusive,
    fromStr: toDayStr(fromDay),
    toStr: toDayStr(toDay),
  };
}

router.get(
  "/ai-usage/analytics",
  requirePermission("dashboard:read"),
  async (req: Request, res: Response): Promise<void> => {
    const { from, toExclusive, fromStr, toStr } = resolveRange(req);
    const payload = await cachedDashboard(
      req,
      `ai-usage-analytics|${fromStr}|${toStr}`,
      async () => {
        const conds = and(
          eq(aiUsageTable.organizationId, orgId(req)),
          gte(aiUsageTable.createdAt, from),
          lt(aiUsageTable.createdAt, toExclusive),
        );

        const [summaryRow] = await db
          .select({
            totalRequests: sql<number>`count(*)::int`,
            successCount: sql<number>`count(*) filter (where ${aiUsageTable.success})::int`,
            errorCount: sql<number>`count(*) filter (where not ${aiUsageTable.success})::int`,
            escalationCount: sql<number>`count(*) filter (where ${aiUsageTable.escalated})::int`,
            totalTokens: sql<number>`coalesce(sum(${aiUsageTable.totalTokens}), 0)::float8`,
            totalCostUsd: sql<number>`coalesce(sum(${aiUsageTable.costUsd}), 0)::float8`,
            avgDurationMs: sql<number>`coalesce(avg(${aiUsageTable.durationMs}), 0)::float8`,
          })
          .from(aiUsageTable)
          .where(conds);

        const timeseriesRows = await db
          .select({
            date: sql<string>`to_char((${aiUsageTable.createdAt} at time zone 'UTC')::date, 'YYYY-MM-DD')`,
            requests: sql<number>`count(*)::int`,
            tokens: sql<number>`coalesce(sum(${aiUsageTable.totalTokens}), 0)::float8`,
            costUsd: sql<number>`coalesce(sum(${aiUsageTable.costUsd}), 0)::float8`,
          })
          .from(aiUsageTable)
          .where(conds)
          .groupBy(sql`1`);

        const byModel = await db
          .select({
            model: aiUsageTable.model,
            tier: sql<string>`coalesce(${aiUsageTable.tier}, '')`,
            requests: sql<number>`count(*)::int`,
            tokens: sql<number>`coalesce(sum(${aiUsageTable.totalTokens}), 0)::float8`,
            costUsd: sql<number>`coalesce(sum(${aiUsageTable.costUsd}), 0)::float8`,
          })
          .from(aiUsageTable)
          .where(conds)
          .groupBy(aiUsageTable.model, aiUsageTable.tier)
          .orderBy(sql`count(*) desc`);

        const byOperation = await db
          .select({
            operation: aiUsageTable.workload,
            requests: sql<number>`count(*)::int`,
            tokens: sql<number>`coalesce(sum(${aiUsageTable.totalTokens}), 0)::float8`,
            costUsd: sql<number>`coalesce(sum(${aiUsageTable.costUsd}), 0)::float8`,
            escalations: sql<number>`count(*) filter (where ${aiUsageTable.escalated})::int`,
          })
          .from(aiUsageTable)
          .where(conds)
          .groupBy(aiUsageTable.workload)
          .orderBy(sql`count(*) desc`);

        // Fill every day in the range so the trend chart has no gaps.
        const byDay = new Map(timeseriesRows.map((r) => [r.date, r]));
        const timeseries: {
          date: string;
          requests: number;
          tokens: number;
          costUsd: number;
        }[] = [];
        for (let t = from.getTime(); t < toExclusive.getTime(); t += DAY_MS) {
          const key = toDayStr(new Date(t));
          const row = byDay.get(key);
          timeseries.push({
            date: key,
            requests: row?.requests ?? 0,
            tokens: row?.tokens ?? 0,
            costUsd: row?.costUsd ?? 0,
          });
        }

        const s = summaryRow!;
        const successRate =
          s.totalRequests > 0
            ? Math.round((s.successCount / s.totalRequests) * 100)
            : 0;
        const errorRate =
          s.totalRequests > 0
            ? Math.round((s.errorCount / s.totalRequests) * 100)
            : 0;
        const escalationRate =
          s.totalRequests > 0
            ? Math.round((s.escalationCount / s.totalRequests) * 100)
            : 0;

        return {
          from: fromStr,
          to: toStr,
          summary: {
            totalRequests: s.totalRequests,
            successCount: s.successCount,
            errorCount: s.errorCount,
            escalationCount: s.escalationCount,
            totalTokens: Math.round(s.totalTokens),
            totalCostUsd: Math.round(s.totalCostUsd * 1e6) / 1e6,
            avgDurationMs: Math.round(s.avgDurationMs),
            successRate,
            errorRate,
            escalationRate,
          },
          timeseries,
          byModel,
          byOperation,
        };
      },
    );
    res.json(payload);
  },
);

// CSV export of the request-level AI usage ledger for the selected range. Same
// org scope, permission gate, and date window as /ai-usage/requests, but streams
// the rows page-by-page straight to the response so finance can pull an
// arbitrarily large range without the server buffering the whole table.
//
// Paging uses a keyset (seek) cursor ordered by (createdAt DESC, id DESC), not
// OFFSET: id is a unique tie-breaker so rows sharing a timestamp are never
// skipped or duplicated across pages, and rows inserted during the export can't
// shift the window (which would silently drop or double-count rows under OFFSET).
router.get(
  "/ai-usage/export",
  requirePermission("dashboard:read"),
  async (req: Request, res: Response): Promise<void> => {
    const { from, toExclusive, fromStr, toStr } = resolveRange(req);
    const org = orgId(req);

    res.status(200);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ai-usage_${fromStr}_to_${toStr}.csv"`,
    );
    // Prevent any intermediary from caching a tenant's spend export.
    res.setHeader("Cache-Control", "no-store");

    // Fetch one keyset page. Extracted so the cursor never appears in its own
    // query's inferred type (which would trip circular type inference).
    const fetchPage = (cursor: Cursor | null) => {
      const keyset: SQL | undefined = cursor
        ? or(
            lt(aiUsageTable.createdAt, cursor.createdAt),
            and(
              eq(aiUsageTable.createdAt, cursor.createdAt),
              lt(aiUsageTable.id, cursor.id),
            ),
          )
        : undefined;
      return db
        .select({
          id: aiUsageTable.id,
          userName: usersTable.name,
          workload: aiUsageTable.workload,
          reviewType: aiUsageTable.reviewType,
          model: aiUsageTable.model,
          tier: aiUsageTable.tier,
          promptTokens: aiUsageTable.promptTokens,
          completionTokens: aiUsageTable.completionTokens,
          totalTokens: aiUsageTable.totalTokens,
          costUsd: aiUsageTable.costUsd,
          durationMs: aiUsageTable.durationMs,
          success: aiUsageTable.success,
          errorMessage: aiUsageTable.errorMessage,
          riskScore: aiUsageTable.riskScore,
          confidence: aiUsageTable.confidence,
          escalated: aiUsageTable.escalated,
          requestId: aiUsageTable.requestId,
          createdAt: aiUsageTable.createdAt,
        })
        .from(aiUsageTable)
        .leftJoin(usersTable, eq(usersTable.id, aiUsageTable.userId))
        .where(
          and(
            eq(aiUsageTable.organizationId, org),
            gte(aiUsageTable.createdAt, from),
            lt(aiUsageTable.createdAt, toExclusive),
            keyset,
          ),
        )
        .orderBy(desc(aiUsageTable.createdAt), desc(aiUsageTable.id))
        .limit(EXPORT_PAGE_SIZE);
    };

    // Header row.
    res.write(csvRow(EXPORT_COLUMNS));

    let cursor: Cursor | null = null;
    for (;;) {
      const rows = await fetchPage(cursor);
      for (const r of rows) {
        res.write(csvRow(formatExportRow(r)));
      }
      if (rows.length < EXPORT_PAGE_SIZE) break;
      const last = rows[rows.length - 1]!;
      cursor = { createdAt: last.createdAt, id: last.id };
    }

    res.end();
  },
);

router.get(
  "/ai-usage/requests",
  requirePermission("dashboard:read"),
  async (req: Request, res: Response): Promise<void> => {
    const { from, toExclusive } = resolveRange(req);
    const { limit, offset } = parsePagination(req);
    const rows = await db
      .select({
        id: aiUsageTable.id,
        requestId: aiUsageTable.requestId,
        userId: aiUsageTable.userId,
        userName: usersTable.name,
        workload: aiUsageTable.workload,
        reviewType: aiUsageTable.reviewType,
        model: aiUsageTable.model,
        tier: aiUsageTable.tier,
        promptTokens: aiUsageTable.promptTokens,
        completionTokens: aiUsageTable.completionTokens,
        totalTokens: aiUsageTable.totalTokens,
        costUsd: aiUsageTable.costUsd,
        durationMs: aiUsageTable.durationMs,
        success: aiUsageTable.success,
        errorMessage: aiUsageTable.errorMessage,
        riskScore: aiUsageTable.riskScore,
        confidence: aiUsageTable.confidence,
        escalated: aiUsageTable.escalated,
        createdAt: aiUsageTable.createdAt,
      })
      .from(aiUsageTable)
      .leftJoin(usersTable, eq(usersTable.id, aiUsageTable.userId))
      .where(
        and(
          eq(aiUsageTable.organizationId, orgId(req)),
          gte(aiUsageTable.createdAt, from),
          lt(aiUsageTable.createdAt, toExclusive),
        ),
      )
      .orderBy(desc(aiUsageTable.createdAt))
      .limit(limit)
      .offset(offset);
    res.json(rows);
  },
);

export default router;
