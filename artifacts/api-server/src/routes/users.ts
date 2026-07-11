import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, teamMembersTable, teamsTable } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { mapUser } from "../lib/mappers";
import { requirePermission, orgId, getAuthContext } from "../lib/rbac/context";
import { writeAudit } from "../lib/audit";
import { getRoleDef, ROLES } from "../lib/rbac/permissions";
import { invalidateAuthCache } from "../lib/rbac/provision";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}

// Users for the org, each enriched with the teams they belong to.
async function loadUsersWithTeams(organizationId: number) {
  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.organizationId, organizationId))
    .orderBy(desc(usersTable.createdAt));
  if (users.length === 0) return [];

  const memberships = await db
    .select({
      userId: teamMembersTable.userId,
      teamId: teamsTable.id,
      teamName: teamsTable.name,
    })
    .from(teamMembersTable)
    .innerJoin(teamsTable, eq(teamMembersTable.teamId, teamsTable.id))
    .where(
      inArray(
        teamMembersTable.userId,
        users.map((u) => u.id),
      ),
    );

  const byUser = new Map<number, { id: number; name: string }[]>();
  for (const m of memberships) {
    const list = byUser.get(m.userId) ?? [];
    list.push({ id: m.teamId, name: m.teamName });
    byUser.set(m.userId, list);
  }

  return users.map((u) => ({ ...mapUser(u), teams: byUser.get(u.id) ?? [] }));
}

router.get(
  "/users",
  requirePermission("users:read"),
  async (req: Request, res: Response): Promise<void> => {
    res.json(await loadUsersWithTeams(orgId(req)));
  },
);

// Invite a user by pre-creating their row. On their first authenticated request
// the provisioning step adopts this row by matching email, so they arrive with
// the role already assigned.
router.post(
  "/users",
  requirePermission("users:write"),
  async (req: Request, res: Response): Promise<void> => {
    const name = String(req.body?.name ?? "").trim();
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const roleKey = String(req.body?.roleKey ?? "").trim();
    if (!name || !email) {
      res.status(400).json({ error: "Name and email are required" });
      return;
    }
    const roleDef = getRoleDef(roleKey);
    if (!roleDef) {
      res.status(400).json({ error: "Unknown role" });
      return;
    }
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "A user with that email already exists" });
      return;
    }
    const [created] = await db
      .insert(usersTable)
      .values({
        organizationId: orgId(req),
        name,
        email,
        roleKey,
        role: roleDef.name,
        status: "invited",
        active: true,
      })
      .returning();
    await writeAudit(req, {
      action: "User.Invite",
      entityType: "user",
      entityId: created!.id,
      detail: `Invited ${name} (${email}) as ${roleDef.name}`,
      after: { email, roleKey },
    });
    res.status(201).json(mapUser(created!));
  },
);

// Change a user's role and/or active status. Role changes keep the human label
// in sync and invalidate the cached auth context so new permissions take effect.
router.patch(
  "/users/:id",
  requirePermission("users:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const [existing] = await db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.organizationId, orgId(req))))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const ctx = getAuthContext(req);
    const update: {
      roleKey?: string;
      role?: string;
      active?: boolean;
      status?: string;
    } = {};

    if (req.body?.roleKey !== undefined) {
      const roleKey = String(req.body.roleKey);
      const roleDef = getRoleDef(roleKey);
      if (!roleDef) {
        res.status(400).json({ error: "Unknown role" });
        return;
      }
      // Prevent an admin from demoting themselves out of their own permissions.
      if (existing.id === ctx.userId && roleKey !== existing.roleKey) {
        res.status(400).json({ error: "You cannot change your own role" });
        return;
      }
      update.roleKey = roleKey;
      update.role = roleDef.name;
    }

    if (req.body?.active !== undefined) {
      const active = Boolean(req.body.active);
      // Prevent an admin from locking themselves out of the platform.
      if (!active && existing.id === ctx.userId) {
        res.status(400).json({ error: "You cannot deactivate your own account" });
        return;
      }
      update.active = active;
      update.status = active ? "active" : "inactive";
    }

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }

    const [updated] = await db
      .update(usersTable)
      .set(update)
      .where(eq(usersTable.id, id))
      .returning();

    // The target user's permissions may have changed; drop their cached context.
    if (existing.clerkUserId) invalidateAuthCache(existing.clerkUserId);

    await writeAudit(req, {
      action: "User.Update",
      entityType: "user",
      entityId: id,
      detail: `Updated ${updated!.name}`,
      before: { roleKey: existing.roleKey, active: existing.active },
      after: { roleKey: updated!.roleKey, active: updated!.active },
    });
    res.json(mapUser(updated!));
  },
);

// The role catalog: every role with its human label, rank, description, and the
// permission keys it grants. Powers the read-only Role Management screen.
router.get(
  "/roles",
  requirePermission("users:read"),
  async (_req: Request, res: Response): Promise<void> => {
    res.json(
      ROLES.map((r) => ({
        key: r.key,
        name: r.name,
        rank: r.rank,
        description: r.description,
        permissions:
          r.permissions === "*" ? ["*"] : [...r.permissions],
      })),
    );
  },
);

export default router;
