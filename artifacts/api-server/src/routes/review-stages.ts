import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  reviewStagesTable,
  teamsTable,
  departmentsTable,
  specialistProfilesTable,
  type ReviewStageRow,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { requirePermission, orgId } from "../lib/rbac/context";
import { writeAudit } from "../lib/audit";
import { teamInOrg, departmentInOrg, specialistInOrg } from "../lib/orgRefs";

const router: IRouter = Router();

// Confirms referenced stage assignees belong to the caller's org.
async function validateStageRefs(
  organizationId: number,
  values: Record<string, unknown>,
): Promise<string | null> {
  if (
    values["assignedTeamId"] !== undefined &&
    !(await teamInOrg(organizationId, values["assignedTeamId"] as number | null))
  ) {
    return "Team not found";
  }
  if (
    values["assignedDepartmentId"] !== undefined &&
    !(await departmentInOrg(organizationId, values["assignedDepartmentId"] as number | null))
  ) {
    return "Department not found";
  }
  if (
    values["assignedSpecialistId"] !== undefined &&
    !(await specialistInOrg(organizationId, values["assignedSpecialistId"] as number | null))
  ) {
    return "Specialist not found";
  }
  return null;
}

function parseId(raw: string | string[] | undefined): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}
function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

async function nameMaps(organizationId: number) {
  const [teams, depts, specs] = await Promise.all([
    db
      .select({ id: teamsTable.id, name: teamsTable.name })
      .from(teamsTable)
      .where(eq(teamsTable.organizationId, organizationId)),
    db
      .select({ id: departmentsTable.id, name: departmentsTable.name })
      .from(departmentsTable)
      .where(eq(departmentsTable.organizationId, organizationId)),
    db
      .select({ id: specialistProfilesTable.id, name: specialistProfilesTable.name })
      .from(specialistProfilesTable)
      .where(eq(specialistProfilesTable.organizationId, organizationId)),
  ]);
  return {
    team: new Map(teams.map((t) => [t.id, t.name])),
    dept: new Map(depts.map((d) => [d.id, d.name])),
    spec: new Map(specs.map((s) => [s.id, s.name])),
  };
}

function mapStage(
  s: ReviewStageRow,
  maps: { team: Map<number, string>; dept: Map<number, string>; spec: Map<number, string> },
) {
  return {
    id: s.id,
    name: s.name,
    stageOrder: s.stageOrder,
    assignedTeamId: s.assignedTeamId ?? null,
    assignedTeamName: s.assignedTeamId
      ? (maps.team.get(s.assignedTeamId) ?? null)
      : null,
    assignedDepartmentId: s.assignedDepartmentId ?? null,
    assignedDepartmentName: s.assignedDepartmentId
      ? (maps.dept.get(s.assignedDepartmentId) ?? null)
      : null,
    assignedSpecialistId: s.assignedSpecialistId ?? null,
    assignedSpecialistName: s.assignedSpecialistId
      ? (maps.spec.get(s.assignedSpecialistId) ?? null)
      : null,
    approvalAuthority: s.approvalAuthority ?? null,
    slaHours: s.slaHours,
    escalationPath: s.escalationPath ?? null,
    active: s.active,
    createdAt: iso(s.createdAt)!,
    updatedAt: iso(s.updatedAt)!,
  };
}

async function loadStages(organizationId: number) {
  const [stages, maps] = await Promise.all([
    db
      .select()
      .from(reviewStagesTable)
      .where(eq(reviewStagesTable.organizationId, organizationId))
      .orderBy(asc(reviewStagesTable.stageOrder), asc(reviewStagesTable.id)),
    nameMaps(organizationId),
  ]);
  return stages.map((s) => mapStage(s, maps));
}

async function loadOrgRow(organizationId: number, id: number) {
  const [row] = await db
    .select()
    .from(reviewStagesTable)
    .where(
      and(
        eq(reviewStagesTable.id, id),
        eq(reviewStagesTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

function buildValues(body: Record<string, unknown>) {
  const v: Record<string, unknown> = {};
  if (body["name"] !== undefined) v["name"] = String(body["name"]).trim();
  if (body["stageOrder"] !== undefined) v["stageOrder"] = Number(body["stageOrder"]);
  if (body["assignedTeamId"] !== undefined)
    v["assignedTeamId"] = body["assignedTeamId"] ? Number(body["assignedTeamId"]) : null;
  if (body["assignedDepartmentId"] !== undefined)
    v["assignedDepartmentId"] = body["assignedDepartmentId"]
      ? Number(body["assignedDepartmentId"])
      : null;
  if (body["assignedSpecialistId"] !== undefined)
    v["assignedSpecialistId"] = body["assignedSpecialistId"]
      ? Number(body["assignedSpecialistId"])
      : null;
  if (body["approvalAuthority"] !== undefined)
    v["approvalAuthority"] = body["approvalAuthority"]
      ? String(body["approvalAuthority"]).trim()
      : null;
  if (body["slaHours"] !== undefined) v["slaHours"] = Number(body["slaHours"]);
  if (body["escalationPath"] !== undefined)
    v["escalationPath"] = body["escalationPath"]
      ? String(body["escalationPath"]).trim()
      : null;
  if (body["active"] !== undefined) v["active"] = Boolean(body["active"]);
  return v;
}

router.get(
  "/review-stages",
  requirePermission("routing:read"),
  async (req: Request, res: Response): Promise<void> => {
    res.json(await loadStages(orgId(req)));
  },
);

router.post(
  "/review-stages",
  requirePermission("routing:write"),
  async (req: Request, res: Response): Promise<void> => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) {
      res.status(400).json({ error: "Stage name is required" });
      return;
    }
    const values = buildValues(req.body ?? {});
    const refError = await validateStageRefs(orgId(req), values);
    if (refError) {
      res.status(400).json({ error: refError });
      return;
    }
    const [created] = await db
      .insert(reviewStagesTable)
      .values({ ...values, name, organizationId: orgId(req) })
      .returning();
    await writeAudit(req, {
      action: "ReviewStage.Create",
      entityType: "review_stage",
      entityId: created!.id,
      detail: `Created review stage "${name}"`,
      after: { name },
    });
    const maps = await nameMaps(orgId(req));
    res.status(201).json(mapStage(created!, maps));
  },
);

router.patch(
  "/review-stages/:id",
  requirePermission("routing:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const existing = await loadOrgRow(orgId(req), id);
    if (!existing) {
      res.status(404).json({ error: "Review stage not found" });
      return;
    }
    const values = buildValues(req.body ?? {});
    if (values["name"] !== undefined && !values["name"]) {
      res.status(400).json({ error: "Stage name cannot be empty" });
      return;
    }
    const refError = await validateStageRefs(orgId(req), values);
    if (refError) {
      res.status(400).json({ error: refError });
      return;
    }
    const [updated] = await db
      .update(reviewStagesTable)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(reviewStagesTable.id, id))
      .returning();
    await writeAudit(req, {
      action: "ReviewStage.Update",
      entityType: "review_stage",
      entityId: id,
      detail: `Updated review stage "${existing.name}"`,
      after: values,
    });
    const maps = await nameMaps(orgId(req));
    res.json(mapStage(updated!, maps));
  },
);

router.delete(
  "/review-stages/:id",
  requirePermission("routing:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const existing = await loadOrgRow(orgId(req), id);
    if (!existing) {
      res.status(404).json({ error: "Review stage not found" });
      return;
    }
    await db.delete(reviewStagesTable).where(eq(reviewStagesTable.id, id));
    await writeAudit(req, {
      action: "ReviewStage.Delete",
      entityType: "review_stage",
      entityId: id,
      detail: `Deleted review stage "${existing.name}"`,
      before: { name: existing.name },
    });
    res.json(await loadStages(orgId(req)));
  },
);

export default router;
