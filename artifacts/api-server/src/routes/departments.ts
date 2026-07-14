import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  departmentsTable,
  specialistProfilesTable,
  usersTable,
  type DepartmentRow,
} from "@workspace/db";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { requirePermission, orgId } from "../lib/rbac/context";
import { writeAudit } from "../lib/audit";
import { userInOrg } from "../lib/orgRefs";

const router: IRouter = Router();

// Confirms referenced leader/escalation-owner users belong to the caller's org.
async function validateDeptRefs(
  organizationId: number,
  values: Record<string, unknown>,
): Promise<string | null> {
  if (
    values["leaderUserId"] !== undefined &&
    !(await userInOrg(organizationId, values["leaderUserId"] as number | null))
  ) {
    return "Leader user not found";
  }
  if (
    values["escalationOwnerUserId"] !== undefined &&
    !(await userInOrg(organizationId, values["escalationOwnerUserId"] as number | null))
  ) {
    return "Escalation owner user not found";
  }
  return null;
}

function parseId(raw: string | string[] | undefined): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}
function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

type Member = { id: number; name: string; role: string };

function mapDepartment(
  d: DepartmentRow,
  leaderName: string | null,
  escalationOwnerName: string | null,
  members: Member[],
) {
  return {
    id: d.id,
    name: d.name,
    description: d.description ?? null,
    leaderUserId: d.leaderUserId ?? null,
    leaderName,
    escalationOwnerUserId: d.escalationOwnerUserId ?? null,
    escalationOwnerName,
    active: d.active,
    memberCount: members.length,
    members,
    createdAt: iso(d.createdAt)!,
  };
}

async function loadDepartments(organizationId: number) {
  const depts = await db
    .select()
    .from(departmentsTable)
    .where(eq(departmentsTable.organizationId, organizationId))
    .orderBy(asc(departmentsTable.name));
  if (depts.length === 0) return [];

  const [users, specialists] = await Promise.all([
    db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.organizationId, organizationId)),
    db
      .select({
        id: specialistProfilesTable.id,
        name: specialistProfilesTable.name,
        role: specialistProfilesTable.role,
        departmentId: specialistProfilesTable.departmentId,
      })
      .from(specialistProfilesTable)
      .where(
        and(
          eq(specialistProfilesTable.organizationId, organizationId),
          ne(specialistProfilesTable.status, "archived"),
        ),
      ),
  ]);

  const userName = new Map(users.map((u) => [u.id, u.name]));
  const membersByDept = new Map<number, Member[]>();
  for (const s of specialists) {
    if (!s.departmentId) continue;
    const list = membersByDept.get(s.departmentId) ?? [];
    list.push({ id: s.id, name: s.name, role: s.role });
    membersByDept.set(s.departmentId, list);
  }

  return depts.map((d) =>
    mapDepartment(
      d,
      d.leaderUserId ? (userName.get(d.leaderUserId) ?? null) : null,
      d.escalationOwnerUserId
        ? (userName.get(d.escalationOwnerUserId) ?? null)
        : null,
      membersByDept.get(d.id) ?? [],
    ),
  );
}

async function loadOne(organizationId: number, id: number) {
  return (await loadDepartments(organizationId)).find((d) => d.id === id) ?? null;
}

async function loadOrgRow(organizationId: number, id: number) {
  const [row] = await db
    .select()
    .from(departmentsTable)
    .where(
      and(
        eq(departmentsTable.id, id),
        eq(departmentsTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

function buildValues(body: Record<string, unknown>) {
  const v: Record<string, unknown> = {};
  if (body["name"] !== undefined) v["name"] = String(body["name"]).trim();
  if (body["description"] !== undefined)
    v["description"] = body["description"]
      ? String(body["description"]).trim()
      : null;
  if (body["leaderUserId"] !== undefined)
    v["leaderUserId"] = body["leaderUserId"] ? Number(body["leaderUserId"]) : null;
  if (body["escalationOwnerUserId"] !== undefined)
    v["escalationOwnerUserId"] = body["escalationOwnerUserId"]
      ? Number(body["escalationOwnerUserId"])
      : null;
  if (body["active"] !== undefined) v["active"] = Boolean(body["active"]);
  return v;
}

router.get(
  "/departments",
  requirePermission("specialists:read"),
  async (req: Request, res: Response): Promise<void> => {
    res.json(await loadDepartments(orgId(req)));
  },
);

router.post(
  "/departments",
  requirePermission("specialists:write"),
  async (req: Request, res: Response): Promise<void> => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) {
      res.status(400).json({ error: "Department name is required" });
      return;
    }
    const values = buildValues(req.body ?? {});
    const refError = await validateDeptRefs(orgId(req), values);
    if (refError) {
      res.status(400).json({ error: refError });
      return;
    }
    const [created] = await db
      .insert(departmentsTable)
      .values({ ...values, name, organizationId: orgId(req) })
      .returning();
    await writeAudit(req, {
      action: "Department.Create",
      entityType: "department",
      entityId: created!.id,
      detail: `Created department "${name}"`,
      after: { name },
    });
    res.status(201).json((await loadOne(orgId(req), created!.id))!);
  },
);

router.patch(
  "/departments/:id",
  requirePermission("specialists:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const existing = await loadOrgRow(orgId(req), id);
    if (!existing) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    const values = buildValues(req.body ?? {});
    if (values["name"] !== undefined && !values["name"]) {
      res.status(400).json({ error: "Department name cannot be empty" });
      return;
    }
    const refError = await validateDeptRefs(orgId(req), values);
    if (refError) {
      res.status(400).json({ error: refError });
      return;
    }
    await db
      .update(departmentsTable)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(departmentsTable.id, id));
    await writeAudit(req, {
      action: "Department.Update",
      entityType: "department",
      entityId: id,
      detail: `Updated department "${existing.name}"`,
      before: { name: existing.name },
      after: values,
    });
    res.json((await loadOne(orgId(req), id))!);
  },
);

router.delete(
  "/departments/:id",
  requirePermission("specialists:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const existing = await loadOrgRow(orgId(req), id);
    if (!existing) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    // Specialists referencing this department have their departmentId set null
    // by the FK; the directory record itself is preserved.
    await db.delete(departmentsTable).where(eq(departmentsTable.id, id));
    await writeAudit(req, {
      action: "Department.Delete",
      entityType: "department",
      entityId: id,
      detail: `Deleted department "${existing.name}"`,
      before: { name: existing.name },
    });
    res.json(await loadDepartments(orgId(req)));
  },
);

export default router;
