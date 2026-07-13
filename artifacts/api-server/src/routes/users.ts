import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  usersTable,
  teamMembersTable,
  teamsTable,
  permissionsTable,
  userPermissionsTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { mapUser } from "../lib/mappers";
import { requirePermission, orgId, getAuthContext } from "../lib/rbac/context";
import { writeAudit } from "../lib/audit";
import {
  getRoleDef,
  ROLES,
  PERMISSIONS,
  ALL_PERMISSION_KEYS,
  permissionsForRole,
} from "../lib/rbac/permissions";
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

// The full permission catalog (key, category, human-readable description).
// Powers the per-user permission editor so an admin can see every grantable
// capability grouped by area.
router.get(
  "/permissions",
  requirePermission("users:read"),
  async (_req: Request, res: Response): Promise<void> => {
    res.json(
      PERMISSIONS.map((p) => ({
        key: p.key,
        category: p.category,
        description: p.description,
      })),
    );
  },
);

// A single user's permission picture: the baseline granted by their role plus
// the effective set once per-user overrides are applied.
async function loadUserPermissions(organizationId: number, id: number) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.id, id), eq(usersTable.organizationId, organizationId)))
    .limit(1);
  if (!user) return null;
  const roleDef = getRoleDef(user.roleKey);
  const rolePermissions = permissionsForRole(user.roleKey);
  const overrides = await db
    .select({ key: permissionsTable.key, granted: userPermissionsTable.granted })
    .from(userPermissionsTable)
    .innerJoin(
      permissionsTable,
      eq(userPermissionsTable.permissionId, permissionsTable.id),
    )
    .where(eq(userPermissionsTable.userId, id));
  const effective = new Set(rolePermissions);
  for (const o of overrides) {
    if (o.granted) effective.add(o.key);
    else effective.delete(o.key);
  }
  return {
    user,
    payload: {
      userId: user.id,
      roleKey: user.roleKey,
      roleName: roleDef?.name ?? user.role,
      rolePermissions,
      effective: ALL_PERMISSION_KEYS.filter((k) => effective.has(k)),
    },
  };
}

router.get(
  "/users/:id/permissions",
  requirePermission("users:read"),
  async (req: Request, res: Response): Promise<void> => {
    const result = await loadUserPermissions(orgId(req), parseId(req.params["id"]));
    if (!result) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(result.payload);
  },
);

// Replace a user's per-permission overrides. The client sends the DESIRED
// effective permission set; we persist only the deltas from the role baseline,
// so a later role change keeps just the genuine, intentional deviations.
router.put(
  "/users/:id/permissions",
  requirePermission("users:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const ctx = getAuthContext(req);
    // An admin editing their own overrides could silently lock themselves out.
    if (id === ctx.userId) {
      res.status(400).json({ error: "You cannot change your own permissions" });
      return;
    }
    const [user] = await db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.organizationId, orgId(req))))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const raw = req.body?.permissions;
    if (!Array.isArray(raw) || raw.some((k) => typeof k !== "string")) {
      res.status(400).json({ error: "permissions must be an array of permission keys" });
      return;
    }
    const desired = new Set(raw as string[]);
    const unknown = [...desired].filter((k) => !ALL_PERMISSION_KEYS.includes(k));
    if (unknown.length > 0) {
      res.status(400).json({ error: `Unknown permission(s): ${unknown.join(", ")}` });
      return;
    }

    const roleSet = new Set(permissionsForRole(user.roleKey));

    // Authorization ceiling: an admin with users:write must not be able to
    // grant a permission they do not themselves hold — otherwise per-user
    // overrides become a privilege-escalation vector. We only police NEW
    // grants (permissions the target does not already have effectively);
    // preserving or removing existing permissions the caller lacks is fine
    // (removal is de-escalation, preservation is not a change).
    const currentOverrides = await db
      .select({ key: permissionsTable.key, granted: userPermissionsTable.granted })
      .from(userPermissionsTable)
      .innerJoin(
        permissionsTable,
        eq(userPermissionsTable.permissionId, permissionsTable.id),
      )
      .where(eq(userPermissionsTable.userId, id));
    const currentEffective = new Set(roleSet);
    for (const o of currentOverrides) {
      if (o.granted) currentEffective.add(o.key);
      else currentEffective.delete(o.key);
    }
    const overreach = [...desired].filter(
      (k) => !currentEffective.has(k) && !ctx.permissions.has(k),
    );
    if (overreach.length > 0) {
      res.status(403).json({
        error: `You cannot grant permission(s) you do not hold yourself: ${overreach.join(", ")}`,
      });
      return;
    }

    // Minimal deltas: grant a non-baseline perm, or deny a baseline perm.
    const deltas: { key: string; granted: boolean }[] = [];
    for (const key of ALL_PERMISSION_KEYS) {
      const want = desired.has(key);
      const base = roleSet.has(key);
      if (want !== base) deltas.push({ key, granted: want });
    }

    const permRows = await db
      .select({ id: permissionsTable.id, key: permissionsTable.key })
      .from(permissionsTable);
    const idByKey = new Map(permRows.map((p) => [p.key, p.id]));
    // If the permission catalog is out of sync with our code-level key list we
    // would silently drop rows and then audit changes we never persisted. Fail
    // hard instead so the audit trail can never lie about what was written.
    const unmapped = ALL_PERMISSION_KEYS.filter((k) => !idByKey.has(k));
    if (unmapped.length > 0) {
      res.status(500).json({
        error: "Permission catalog is out of sync; cannot update permissions",
      });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(userPermissionsTable)
        .where(eq(userPermissionsTable.userId, id));
      const rows = deltas.map((d) => ({
        userId: id,
        permissionId: idByKey.get(d.key)!,
        granted: d.granted,
      }));
      if (rows.length > 0) {
        await tx.insert(userPermissionsTable).values(rows);
      }
    });

    // The target user's effective permissions changed; drop their cached context.
    if (user.clerkUserId) invalidateAuthCache(user.clerkUserId);
    await writeAudit(req, {
      action: "User.Permissions",
      entityType: "user",
      entityId: id,
      detail: `Updated permissions for ${user.name}`,
      after: { overrides: deltas },
    });

    const result = await loadUserPermissions(orgId(req), id);
    res.json(result!.payload);
  },
);

export default router;
