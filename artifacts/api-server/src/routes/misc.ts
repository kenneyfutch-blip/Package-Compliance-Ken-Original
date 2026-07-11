import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  auditEventsTable,
  notificationsTable,
  reportsTable,
} from "@workspace/db";
import { and, desc, eq, gte, ilike, isNull, lte, or, type SQL } from "drizzle-orm";
import {
  mapAuditEvent,
  mapNotification,
  mapReport,
} from "../lib/mappers";
import { requirePermission, orgId, getAuthContext } from "../lib/rbac/context";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}

function str(raw: string | string[] | undefined): string | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const t = v?.trim();
  return t ? t : undefined;
}

router.get(
  "/audit",
  requirePermission("audit:read"),
  async (req: Request, res: Response): Promise<void> => {
    const q = req.query as Record<string, string | string[] | undefined>;
    const conds: SQL[] = [eq(auditEventsTable.organizationId, orgId(req))];

    const action = str(q["action"]);
    if (action) conds.push(ilike(auditEventsTable.action, `%${action}%`));
    const actor = str(q["actor"]);
    if (actor) conds.push(ilike(auditEventsTable.actor, `%${actor}%`));
    const entityType = str(q["entityType"]);
    if (entityType) conds.push(eq(auditEventsTable.entityType, entityType));
    const search = str(q["q"]);
    if (search) conds.push(ilike(auditEventsTable.detail, `%${search}%`));
    const from = str(q["from"]);
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) conds.push(gte(auditEventsTable.createdAt, d));
    }
    const to = str(q["to"]);
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) conds.push(lte(auditEventsTable.createdAt, d));
    }

    const limitRaw = Number(str(q["limit"]));
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;

    const rows = await db
      .select()
      .from(auditEventsTable)
      .where(and(...conds))
      .orderBy(desc(auditEventsTable.createdAt))
      .limit(limit);
    res.json(rows.map(mapAuditEvent));
  },
);

router.get(
  "/notifications",
  requirePermission("notifications:read"),
  async (req: Request, res: Response): Promise<void> => {
    // Return org-wide notifications (userId IS NULL) plus those targeted at the
    // signed-in user. Per-user rows for other users stay private.
    const userId = getAuthContext(req).userId;
    const rows = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.organizationId, orgId(req)),
          or(
            isNull(notificationsTable.userId),
            eq(notificationsTable.userId, userId),
          ),
        ),
      )
      .orderBy(desc(notificationsTable.createdAt));
    res.json(rows.map(mapNotification));
  },
);

router.patch(
  "/notifications/:id/read",
  requirePermission("notifications:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const userId = getAuthContext(req).userId;
    const [existing] = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.id, id),
          eq(notificationsTable.organizationId, orgId(req)),
          or(
            isNull(notificationsTable.userId),
            eq(notificationsTable.userId, userId),
          ),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    await db
      .update(notificationsTable)
      .set({ read: true })
      .where(eq(notificationsTable.id, id));
    const [updated] = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.id, id));
    res.json(mapNotification(updated!));
  },
);

router.get(
  "/reports",
  requirePermission("reports:read"),
  async (req: Request, res: Response): Promise<void> => {
    const rows = await db
      .select()
      .from(reportsTable)
      .where(eq(reportsTable.organizationId, orgId(req)))
      .orderBy(desc(reportsTable.createdAt));
    res.json(rows.map(mapReport));
  },
);

export default router;
