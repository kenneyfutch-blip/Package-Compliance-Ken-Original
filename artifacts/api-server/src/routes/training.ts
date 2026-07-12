import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  trainingProgressTable,
  supportRequestsTable,
  usersTable,
  type SupportRequestRow,
} from "@workspace/db";
import { getAuthContext, requirePermission } from "../lib/rbac/context";
import { ROLES } from "../lib/rbac/permissions";
import { notifyUsers } from "../lib/reviews/notify";

const router: IRouter = Router();

// Admin recipients for support tickets = anyone who can manage users (platform
// admins + directors). Derived from the taxonomy so it tracks role changes.
const SUPPORT_ADMIN_ROLE_KEYS: string[] = ROLES.filter(
  (r) => r.permissions === "*" || r.permissions.includes("users:write"),
).map((r) => r.key);

const SUPPORT_CATEGORIES = new Set([
  "general",
  "bug",
  "feature",
  "account",
  "billing",
  "training",
  "other",
]);
const SUPPORT_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const SUPPORT_STATUSES = new Set([
  "open",
  "in_progress",
  "resolved",
  "closed",
]);

// ---------------------------------------------------------------------------
// Training progress (all authenticated users; scoped to the caller)
// ---------------------------------------------------------------------------

// List the current user's completed training items.
router.get("/training/progress", async (req, res) => {
  const { userId, organizationId } = getAuthContext(req);
  const rows = await db
    .select({
      itemKey: trainingProgressTable.itemKey,
      itemType: trainingProgressTable.itemType,
      completedAt: trainingProgressTable.completedAt,
    })
    .from(trainingProgressTable)
    .where(
      and(
        eq(trainingProgressTable.organizationId, organizationId),
        eq(trainingProgressTable.userId, userId),
      ),
    )
    .orderBy(desc(trainingProgressTable.completedAt));

  res.json({
    items: rows.map((r) => ({
      itemKey: r.itemKey,
      itemType: r.itemType,
      completedAt: r.completedAt?.toISOString() ?? null,
    })),
  });
});

// Mark a training item complete or incomplete (idempotent upsert / delete).
router.put("/training/progress", async (req, res) => {
  const { userId, organizationId } = getAuthContext(req);
  const body = (req.body ?? {}) as {
    itemKey?: unknown;
    itemType?: unknown;
    completed?: unknown;
  };
  const itemKey =
    typeof body.itemKey === "string" ? body.itemKey.trim() : "";
  if (!itemKey || itemKey.length > 200) {
    res.status(400).json({ error: "A valid itemKey is required." });
    return;
  }
  const itemType =
    typeof body.itemType === "string" && body.itemType.trim()
      ? body.itemType.trim().slice(0, 40)
      : "guide";
  const completed = body.completed !== false; // default true

  if (!completed) {
    await db
      .delete(trainingProgressTable)
      .where(
        and(
          eq(trainingProgressTable.organizationId, organizationId),
          eq(trainingProgressTable.userId, userId),
          eq(trainingProgressTable.itemKey, itemKey),
        ),
      );
    res.json({ itemKey, itemType, completed: false, completedAt: null });
    return;
  }

  const now = new Date();
  const [row] = await db
    .insert(trainingProgressTable)
    .values({
      organizationId,
      userId,
      itemKey,
      itemType,
      status: "completed",
      completedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [trainingProgressTable.userId, trainingProgressTable.itemKey],
      set: { itemType, status: "completed", updatedAt: now },
    })
    .returning({
      itemKey: trainingProgressTable.itemKey,
      itemType: trainingProgressTable.itemType,
      completedAt: trainingProgressTable.completedAt,
    });

  res.json({
    itemKey: row?.itemKey ?? itemKey,
    itemType: row?.itemType ?? itemType,
    completed: true,
    completedAt: (row?.completedAt ?? now).toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Support requests
// ---------------------------------------------------------------------------

function mapSupportRequest(
  r: SupportRequestRow,
  requester?: { name: string | null; email: string | null },
) {
  return {
    id: r.id,
    subject: r.subject,
    category: r.category,
    priority: r.priority,
    message: r.message,
    status: r.status,
    pageContext: r.pageContext ?? null,
    adminResponse: r.adminResponse ?? null,
    requesterUserId: r.userId,
    requesterName: requester?.name ?? null,
    requesterEmail: requester?.email ?? null,
    resolvedByUserId: r.resolvedByUserId ?? null,
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// File a support request. Any signed-in user; notifies org admins in-app.
router.post("/support/requests", async (req, res) => {
  const { userId, organizationId, name, email } = getAuthContext(req);
  const body = (req.body ?? {}) as Record<string, unknown>;

  const subject =
    typeof body.subject === "string" ? body.subject.trim() : "";
  const message =
    typeof body.message === "string" ? body.message.trim() : "";
  if (!subject || subject.length > 200) {
    res.status(400).json({ error: "A subject (max 200 chars) is required." });
    return;
  }
  if (!message || message.length > 5000) {
    res.status(400).json({ error: "A message (max 5000 chars) is required." });
    return;
  }
  const category =
    typeof body.category === "string" && SUPPORT_CATEGORIES.has(body.category)
      ? body.category
      : "general";
  const priority =
    typeof body.priority === "string" && SUPPORT_PRIORITIES.has(body.priority)
      ? body.priority
      : "normal";
  const pageContext =
    typeof body.pageContext === "string" && body.pageContext.trim()
      ? body.pageContext.trim().slice(0, 300)
      : null;

  const now = new Date();
  const [created] = await db
    .insert(supportRequestsTable)
    .values({
      organizationId,
      userId,
      subject,
      category,
      priority,
      message,
      status: "open",
      pageContext,
      updatedAt: now,
    })
    .returning();

  // Notify admins after the write commits — best-effort, never blocks the reply.
  try {
    const admins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.organizationId, organizationId),
          eq(usersTable.active, true),
          inArray(usersTable.roleKey, SUPPORT_ADMIN_ROLE_KEYS),
        ),
      );
    await notifyUsers({
      organizationId,
      userIds: admins.map((a) => a.id),
      title: `New support request: ${subject}`,
      message: `${name || email || "A user"} submitted a ${priority} ${category} request.`,
      type: priority === "urgent" ? "critical" : "info",
    });
  } catch {
    // Notification failure must not fail the request submission.
  }

  res.status(201).json(mapSupportRequest(created, { name, email }));
});

// The caller's own support requests.
router.get("/support/requests", async (req, res) => {
  const { userId, organizationId, name, email } = getAuthContext(req);
  const rows = await db
    .select()
    .from(supportRequestsTable)
    .where(
      and(
        eq(supportRequestsTable.organizationId, organizationId),
        eq(supportRequestsTable.userId, userId),
      ),
    )
    .orderBy(desc(supportRequestsTable.createdAt));
  res.json({ items: rows.map((r) => mapSupportRequest(r, { name, email })) });
});

// Admin inbox: every request in the org, with requester identity.
router.get(
  "/support/admin/requests",
  requirePermission("users:read"),
  async (req, res) => {
    const { organizationId } = getAuthContext(req);
    const statusFilter =
      typeof req.query.status === "string" &&
      SUPPORT_STATUSES.has(req.query.status)
        ? req.query.status
        : null;

    const rows = await db
      .select({
        request: supportRequestsTable,
        requesterName: usersTable.name,
        requesterEmail: usersTable.email,
      })
      .from(supportRequestsTable)
      .leftJoin(usersTable, eq(usersTable.id, supportRequestsTable.userId))
      .where(
        statusFilter
          ? and(
              eq(supportRequestsTable.organizationId, organizationId),
              eq(supportRequestsTable.status, statusFilter),
            )
          : eq(supportRequestsTable.organizationId, organizationId),
      )
      .orderBy(desc(supportRequestsTable.createdAt));

    res.json({
      items: rows.map((r) =>
        mapSupportRequest(r.request, {
          name: r.requesterName,
          email: r.requesterEmail,
        }),
      ),
    });
  },
);

// Admin update: change status and/or leave a response. Notifies the requester.
router.patch(
  "/support/admin/requests/:id",
  requirePermission("users:read"),
  async (req, res) => {
    const { userId, organizationId } = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid request id." });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const status =
      typeof body.status === "string" && SUPPORT_STATUSES.has(body.status)
        ? body.status
        : null;
    const adminResponse =
      typeof body.adminResponse === "string"
        ? body.adminResponse.trim().slice(0, 5000)
        : undefined;
    if (!status && adminResponse === undefined) {
      res.status(400).json({ error: "Nothing to update." });
      return;
    }

    const [existing] = await db
      .select()
      .from(supportRequestsTable)
      .where(
        and(
          eq(supportRequestsTable.id, id),
          eq(supportRequestsTable.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Support request not found." });
      return;
    }

    const now = new Date();
    const resolving = status === "resolved" || status === "closed";
    const [updated] = await db
      .update(supportRequestsTable)
      .set({
        status: status ?? existing.status,
        adminResponse:
          adminResponse !== undefined ? adminResponse : existing.adminResponse,
        resolvedByUserId: resolving ? userId : existing.resolvedByUserId,
        resolvedAt: resolving ? now : existing.resolvedAt,
        updatedAt: now,
      })
      .where(eq(supportRequestsTable.id, id))
      .returning();

    try {
      await notifyUsers({
        organizationId,
        userIds: [existing.userId],
        title: `Support request updated: ${existing.subject}`,
        message: status
          ? `Your request is now "${status.replace("_", " ")}".`
          : "An administrator responded to your request.",
        type: "info",
      });
    } catch {
      // non-fatal
    }

    const [requester] = await db
      .select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, existing.userId))
      .limit(1);

    res.json(mapSupportRequest(updated, requester));
  },
);

export default router;
