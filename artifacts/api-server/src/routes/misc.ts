import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  auditEventsTable,
  notificationsTable,
  notificationPreferencesTable,
  notificationStatesTable,
  reportsTable,
} from "@workspace/db";
import { and, desc, eq, gte, ilike, isNull, lte, notInArray, or, type SQL } from "drizzle-orm";
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

// Notifications visible to the caller: org-wide (userId IS NULL) plus their own.
function ownNotificationScope(req: Request): SQL {
  const userId = getAuthContext(req).userId;
  return and(
    eq(notificationsTable.organizationId, orgId(req)),
    or(
      isNull(notificationsTable.userId),
      eq(notificationsTable.userId, userId),
    ),
  )!;
}

// Load a single notification the caller is allowed to see, or undefined. Used to
// authorize per-user state changes without exposing other orgs' rows.
async function loadOwnNotification(req: Request, id: number) {
  const [row] = await db
    .select()
    .from(notificationsTable)
    .where(and(eq(notificationsTable.id, id), ownNotificationScope(req)));
  return row;
}

// Read/archived/deleted flags are stored PER USER in notification_states so that
// acting on an org-wide (userId IS NULL) notification only affects the caller's
// own view — never everyone in the org. The base notifications row keeps the
// initial/legacy flags, used as a fallback when no per-user state row exists yet.
async function setNotificationState(
  req: Request,
  notificationId: number,
  patch: Partial<{ read: boolean; archived: boolean; deleted: boolean }>,
): Promise<void> {
  const userId = getAuthContext(req).userId;
  await db
    .insert(notificationStatesTable)
    .values({
      organizationId: orgId(req),
      notificationId,
      userId,
      ...patch,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        notificationStatesTable.notificationId,
        notificationStatesTable.userId,
      ],
      set: { ...patch, updatedAt: new Date() },
    });
}

// Validate + apply a per-user state change to a single notification, returning
// the notification with the caller's effective flags, or 404 if not visible.
async function mutateOwnNotification(
  req: Request,
  res: Response,
  patch: Partial<{ read: boolean; archived: boolean }>,
): Promise<void> {
  const id = parseId(req.params["id"]);
  const userId = getAuthContext(req).userId;
  const existing = await loadOwnNotification(req, id);
  if (!existing) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  await setNotificationState(req, id, patch);
  const [state] = await db
    .select()
    .from(notificationStatesTable)
    .where(
      and(
        eq(notificationStatesTable.notificationId, id),
        eq(notificationStatesTable.userId, userId),
      ),
    );
  res.json({
    ...mapNotification(existing),
    read: state?.read ?? existing.read,
    archived: state?.archived ?? existing.archived,
  });
}

async function loadMutedTypes(req: Request): Promise<string[]> {
  const userId = getAuthContext(req).userId;
  const [prefs] = await db
    .select()
    .from(notificationPreferencesTable)
    .where(
      and(
        eq(notificationPreferencesTable.organizationId, orgId(req)),
        eq(notificationPreferencesTable.userId, userId),
      ),
    );
  return prefs?.mutedTypes ?? [];
}

router.get(
  "/notifications",
  requirePermission("notifications:read"),
  async (req: Request, res: Response): Promise<void> => {
    // Return org-wide notifications (userId IS NULL) plus those targeted at the
    // signed-in user, excluding any notification types the user has silenced.
    // Read/archived/deleted are overlaid from the caller's per-user state.
    const userId = getAuthContext(req).userId;
    const muted = await loadMutedTypes(req);
    const conds: SQL[] = [ownNotificationScope(req)];
    if (muted.length > 0) {
      conds.push(notInArray(notificationsTable.type, muted));
    }
    const rows = await db
      .select({ n: notificationsTable, s: notificationStatesTable })
      .from(notificationsTable)
      .leftJoin(
        notificationStatesTable,
        and(
          eq(notificationStatesTable.notificationId, notificationsTable.id),
          eq(notificationStatesTable.userId, userId),
        ),
      )
      .where(and(...conds))
      .orderBy(desc(notificationsTable.createdAt));
    res.json(
      rows
        .filter((r) => !(r.s?.deleted ?? false))
        .map((r) => ({
          ...mapNotification(r.n),
          read: r.s?.read ?? r.n.read,
          archived: r.s?.archived ?? r.n.archived,
        })),
    );
  },
);

// --- Preferences (silence specific notification types) -----------------------
// Registered before the "/notifications/:id/..." routes so "preferences" is
// never mistaken for an id.

router.get(
  "/notifications/preferences",
  requirePermission("notifications:read"),
  async (req: Request, res: Response): Promise<void> => {
    res.json({ mutedTypes: await loadMutedTypes(req) });
  },
);

router.put(
  "/notifications/preferences",
  requirePermission("notifications:read"),
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuthContext(req).userId;
    const body = (req.body ?? {}) as { mutedTypes?: unknown };
    const mutedTypes = Array.isArray(body.mutedTypes)
      ? Array.from(
          new Set(
            body.mutedTypes.filter((t): t is string => typeof t === "string"),
          ),
        )
      : [];
    await db
      .insert(notificationPreferencesTable)
      .values({ organizationId: orgId(req), userId, mutedTypes, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [
          notificationPreferencesTable.organizationId,
          notificationPreferencesTable.userId,
        ],
        set: { mutedTypes, updatedAt: new Date() },
      });
    res.json({ mutedTypes });
  },
);

router.post(
  "/notifications/read-all",
  requirePermission("notifications:read"),
  async (req: Request, res: Response): Promise<void> => {
    // Mark every currently-unread notification read for THIS user only, by
    // writing per-user state rows (never touching the shared base rows).
    const userId = getAuthContext(req).userId;
    const muted = await loadMutedTypes(req);
    const conds: SQL[] = [ownNotificationScope(req)];
    if (muted.length > 0) {
      conds.push(notInArray(notificationsTable.type, muted));
    }
    const rows = await db
      .select({
        id: notificationsTable.id,
        baseRead: notificationsTable.read,
        sRead: notificationStatesTable.read,
        sDeleted: notificationStatesTable.deleted,
      })
      .from(notificationsTable)
      .leftJoin(
        notificationStatesTable,
        and(
          eq(notificationStatesTable.notificationId, notificationsTable.id),
          eq(notificationStatesTable.userId, userId),
        ),
      )
      .where(and(...conds));
    const toMark = rows.filter(
      (r) => !(r.sDeleted ?? false) && !(r.sRead ?? r.baseRead),
    );
    await Promise.all(
      toMark.map((r) => setNotificationState(req, r.id, { read: true })),
    );
    res.json({ success: true });
  },
);

router.patch(
  "/notifications/:id/read",
  requirePermission("notifications:read"),
  async (req: Request, res: Response): Promise<void> => {
    await mutateOwnNotification(req, res, { read: true });
  },
);

router.patch(
  "/notifications/:id/unread",
  requirePermission("notifications:read"),
  async (req: Request, res: Response): Promise<void> => {
    await mutateOwnNotification(req, res, { read: false });
  },
);

router.post(
  "/notifications/:id/archive",
  requirePermission("notifications:read"),
  async (req: Request, res: Response): Promise<void> => {
    await mutateOwnNotification(req, res, { archived: true, read: true });
  },
);

router.post(
  "/notifications/:id/unarchive",
  requirePermission("notifications:read"),
  async (req: Request, res: Response): Promise<void> => {
    await mutateOwnNotification(req, res, { archived: false });
  },
);

router.delete(
  "/notifications/:id",
  requirePermission("notifications:read"),
  async (req: Request, res: Response): Promise<void> => {
    // Soft, per-user delete: hide from the caller only. Org-wide broadcasts must
    // never be hard-deleted for the whole tenant by one user's action.
    const id = parseId(req.params["id"]);
    const existing = await loadOwnNotification(req, id);
    if (!existing) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    await setNotificationState(req, id, { deleted: true });
    res.json({ success: true });
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
