import { Router, type IRouter, type Request, type Response } from "express";
import { db, teamsTable, teamMembersTable, usersTable } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { mapTeam } from "../lib/mappers";
import { requirePermission, orgId } from "../lib/rbac/context";
import { writeAudit } from "../lib/audit";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}

// Loads teams for the org together with their members in a single follow-up
// query, avoiding an N+1 across teams.
async function loadTeamsWithMembers(organizationId: number) {
  const teams = await db
    .select()
    .from(teamsTable)
    .where(eq(teamsTable.organizationId, organizationId))
    .orderBy(asc(teamsTable.name));
  if (teams.length === 0) return [];

  const memberRows = await db
    .select({
      teamId: teamMembersTable.teamId,
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      roleKey: usersTable.roleKey,
    })
    .from(teamMembersTable)
    .innerJoin(usersTable, eq(teamMembersTable.userId, usersTable.id))
    .where(
      inArray(
        teamMembersTable.teamId,
        teams.map((t) => t.id),
      ),
    );

  const byTeam = new Map<number, typeof memberRows>();
  for (const m of memberRows) {
    const list = byTeam.get(m.teamId) ?? [];
    list.push(m);
    byTeam.set(m.teamId, list);
  }
  return teams.map((t) =>
    mapTeam(
      t,
      (byTeam.get(t.id) ?? []).map(({ teamId: _teamId, ...rest }) => rest),
    ),
  );
}

// Resolves a team row that belongs to the caller's org, or null.
async function loadOrgTeam(organizationId: number, teamId: number) {
  const [team] = await db
    .select()
    .from(teamsTable)
    .where(and(eq(teamsTable.id, teamId), eq(teamsTable.organizationId, organizationId)))
    .limit(1);
  return team ?? null;
}

router.get(
  "/teams",
  requirePermission("teams:read"),
  async (req: Request, res: Response): Promise<void> => {
    res.json(await loadTeamsWithMembers(orgId(req)));
  },
);

router.post(
  "/teams",
  requirePermission("teams:write"),
  async (req: Request, res: Response): Promise<void> => {
    const name = String(req.body?.name ?? "").trim();
    const description = req.body?.description ? String(req.body.description).trim() : null;
    if (!name) {
      res.status(400).json({ error: "Team name is required" });
      return;
    }
    const [created] = await db
      .insert(teamsTable)
      .values({ organizationId: orgId(req), name, description })
      .returning();
    await writeAudit(req, {
      action: "Team.Create",
      entityType: "team",
      entityId: created!.id,
      detail: `Created team "${name}"`,
      after: { name, description },
    });
    res.status(201).json(mapTeam(created!, []));
  },
);

router.patch(
  "/teams/:id",
  requirePermission("teams:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const existing = await loadOrgTeam(orgId(req), id);
    if (!existing) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    const update: { name?: string; description?: string | null } = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) {
        res.status(400).json({ error: "Team name cannot be empty" });
        return;
      }
      update.name = name;
    }
    if (req.body?.description !== undefined) {
      update.description = req.body.description ? String(req.body.description).trim() : null;
    }
    const [updated] = await db
      .update(teamsTable)
      .set(update)
      .where(eq(teamsTable.id, id))
      .returning();
    await writeAudit(req, {
      action: "Team.Update",
      entityType: "team",
      entityId: id,
      detail: `Updated team "${updated!.name}"`,
      before: { name: existing.name, description: existing.description },
      after: { name: updated!.name, description: updated!.description },
    });
    res.json(mapTeam(updated!, []));
  },
);

router.post(
  "/teams/:id/members",
  requirePermission("teams:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const userId = Number(req.body?.userId);
    const team = await loadOrgTeam(orgId(req), id);
    if (!team) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    // Only users in the same org may be added to a team.
    const [user] = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(and(eq(usersTable.id, userId), eq(usersTable.organizationId, orgId(req))))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    await db
      .insert(teamMembersTable)
      .values({ teamId: id, userId })
      .onConflictDoNothing();
    await writeAudit(req, {
      action: "Team.AddMember",
      entityType: "team",
      entityId: id,
      detail: `Added ${user.name} to "${team.name}"`,
      after: { userId },
    });
    res.status(201).json(await loadTeamsWithMembers(orgId(req)));
  },
);

router.delete(
  "/teams/:id/members/:userId",
  requirePermission("teams:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const userId = parseId(req.params["userId"]);
    const team = await loadOrgTeam(orgId(req), id);
    if (!team) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    await db
      .delete(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, id), eq(teamMembersTable.userId, userId)));
    await writeAudit(req, {
      action: "Team.RemoveMember",
      entityType: "team",
      entityId: id,
      detail: `Removed member from "${team.name}"`,
      before: { userId },
    });
    res.json(await loadTeamsWithMembers(orgId(req)));
  },
);

export default router;
