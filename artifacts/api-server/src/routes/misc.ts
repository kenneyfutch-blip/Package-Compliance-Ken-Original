import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  auditEventsTable,
  notificationsTable,
  reportsTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  mapAuditEvent,
  mapNotification,
  mapReport,
  mapUser,
} from "../lib/mappers";
import { requirePermission, orgId } from "../lib/rbac/context";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}

router.get(
  "/audit",
  requirePermission("audit:read"),
  async (req: Request, res: Response): Promise<void> => {
    const rows = await db
      .select()
      .from(auditEventsTable)
      .where(eq(auditEventsTable.organizationId, orgId(req)))
      .orderBy(desc(auditEventsTable.createdAt))
      .limit(200);
    res.json(rows.map(mapAuditEvent));
  },
);

router.get(
  "/notifications",
  requirePermission("notifications:read"),
  async (req: Request, res: Response): Promise<void> => {
    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.organizationId, orgId(req)))
      .orderBy(desc(notificationsTable.createdAt));
    res.json(rows.map(mapNotification));
  },
);

router.patch(
  "/notifications/:id/read",
  requirePermission("notifications:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const [existing] = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.id, id),
          eq(notificationsTable.organizationId, orgId(req)),
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

router.get(
  "/users",
  requirePermission("users:read"),
  async (req: Request, res: Response): Promise<void> => {
    const rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.organizationId, orgId(req)))
      .orderBy(desc(usersTable.createdAt));
    res.json(rows.map(mapUser));
  },
);

export default router;
