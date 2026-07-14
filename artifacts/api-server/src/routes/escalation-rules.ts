import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  escalationRulesTable,
  specialistProfilesTable,
  departmentsTable,
  type EscalationRuleRow,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { requirePermission, orgId } from "../lib/rbac/context";
import { writeAudit } from "../lib/audit";
import { specialistInOrg, departmentInOrg } from "../lib/orgRefs";

const router: IRouter = Router();

// Confirms referenced escalation targets belong to the caller's org.
async function validateEscalationRefs(
  organizationId: number,
  values: Record<string, unknown>,
): Promise<string | null> {
  if (
    values["escalateToSpecialistId"] !== undefined &&
    !(await specialistInOrg(organizationId, values["escalateToSpecialistId"] as number | null))
  ) {
    return "Specialist not found";
  }
  if (
    values["escalateToDepartmentId"] !== undefined &&
    !(await departmentInOrg(organizationId, values["escalateToDepartmentId"] as number | null))
  ) {
    return "Department not found";
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
  const [specs, depts] = await Promise.all([
    db
      .select({ id: specialistProfilesTable.id, name: specialistProfilesTable.name })
      .from(specialistProfilesTable)
      .where(eq(specialistProfilesTable.organizationId, organizationId)),
    db
      .select({ id: departmentsTable.id, name: departmentsTable.name })
      .from(departmentsTable)
      .where(eq(departmentsTable.organizationId, organizationId)),
  ]);
  return {
    spec: new Map(specs.map((s) => [s.id, s.name])),
    dept: new Map(depts.map((d) => [d.id, d.name])),
  };
}

function mapRule(
  r: EscalationRuleRow,
  maps: { spec: Map<number, string>; dept: Map<number, string> },
) {
  return {
    id: r.id,
    name: r.name,
    matrixOrder: r.matrixOrder,
    triggerType: r.triggerType,
    triggerOperator: r.triggerOperator,
    triggerValue: r.triggerValue ?? null,
    escalateToLevel: r.escalateToLevel,
    escalateToRole: r.escalateToRole ?? null,
    escalateToSpecialistId: r.escalateToSpecialistId ?? null,
    escalateToSpecialistName: r.escalateToSpecialistId
      ? (maps.spec.get(r.escalateToSpecialistId) ?? null)
      : null,
    escalateToDepartmentId: r.escalateToDepartmentId ?? null,
    escalateToDepartmentName: r.escalateToDepartmentId
      ? (maps.dept.get(r.escalateToDepartmentId) ?? null)
      : null,
    active: r.active,
    createdAt: iso(r.createdAt)!,
    updatedAt: iso(r.updatedAt)!,
  };
}

async function loadRules(organizationId: number) {
  const [rules, maps] = await Promise.all([
    db
      .select()
      .from(escalationRulesTable)
      .where(eq(escalationRulesTable.organizationId, organizationId))
      .orderBy(asc(escalationRulesTable.matrixOrder), asc(escalationRulesTable.id)),
    nameMaps(organizationId),
  ]);
  return rules.map((r) => mapRule(r, maps));
}

async function loadOrgRow(organizationId: number, id: number) {
  const [row] = await db
    .select()
    .from(escalationRulesTable)
    .where(
      and(
        eq(escalationRulesTable.id, id),
        eq(escalationRulesTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

function buildValues(body: Record<string, unknown>) {
  const v: Record<string, unknown> = {};
  if (body["name"] !== undefined) v["name"] = String(body["name"]).trim();
  if (body["matrixOrder"] !== undefined)
    v["matrixOrder"] = Number(body["matrixOrder"]);
  if (body["triggerType"] !== undefined)
    v["triggerType"] = String(body["triggerType"]).trim();
  if (body["triggerOperator"] !== undefined)
    v["triggerOperator"] = String(body["triggerOperator"]).trim();
  if (body["triggerValue"] !== undefined)
    v["triggerValue"] = body["triggerValue"] ? String(body["triggerValue"]).trim() : null;
  if (body["escalateToLevel"] !== undefined)
    v["escalateToLevel"] = Number(body["escalateToLevel"]);
  if (body["escalateToRole"] !== undefined)
    v["escalateToRole"] = body["escalateToRole"]
      ? String(body["escalateToRole"]).trim()
      : null;
  if (body["escalateToSpecialistId"] !== undefined)
    v["escalateToSpecialistId"] = body["escalateToSpecialistId"]
      ? Number(body["escalateToSpecialistId"])
      : null;
  if (body["escalateToDepartmentId"] !== undefined)
    v["escalateToDepartmentId"] = body["escalateToDepartmentId"]
      ? Number(body["escalateToDepartmentId"])
      : null;
  if (body["active"] !== undefined) v["active"] = Boolean(body["active"]);
  return v;
}

router.get(
  "/escalation-rules",
  requirePermission("routing:read"),
  async (req: Request, res: Response): Promise<void> => {
    res.json(await loadRules(orgId(req)));
  },
);

router.post(
  "/escalation-rules",
  requirePermission("routing:write"),
  async (req: Request, res: Response): Promise<void> => {
    const name = String(req.body?.name ?? "").trim();
    const triggerType = String(req.body?.triggerType ?? "").trim();
    if (!name || !triggerType) {
      res.status(400).json({ error: "Rule name and trigger type are required" });
      return;
    }
    const values = buildValues(req.body ?? {});
    const refError = await validateEscalationRefs(orgId(req), values);
    if (refError) {
      res.status(400).json({ error: refError });
      return;
    }
    const [created] = await db
      .insert(escalationRulesTable)
      .values({
        ...values,
        name,
        triggerType,
        organizationId: orgId(req),
      })
      .returning();
    await writeAudit(req, {
      action: "EscalationRule.Create",
      entityType: "escalation_rule",
      entityId: created!.id,
      detail: `Created escalation rule "${name}"`,
      after: { name, triggerType },
    });
    const maps = await nameMaps(orgId(req));
    res.status(201).json(mapRule(created!, maps));
  },
);

router.patch(
  "/escalation-rules/:id",
  requirePermission("routing:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const existing = await loadOrgRow(orgId(req), id);
    if (!existing) {
      res.status(404).json({ error: "Escalation rule not found" });
      return;
    }
    const values = buildValues(req.body ?? {});
    if (values["name"] !== undefined && !values["name"]) {
      res.status(400).json({ error: "Rule name cannot be empty" });
      return;
    }
    const refError = await validateEscalationRefs(orgId(req), values);
    if (refError) {
      res.status(400).json({ error: refError });
      return;
    }
    const [updated] = await db
      .update(escalationRulesTable)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(escalationRulesTable.id, id))
      .returning();
    await writeAudit(req, {
      action: "EscalationRule.Update",
      entityType: "escalation_rule",
      entityId: id,
      detail: `Updated escalation rule "${existing.name}"`,
      after: values,
    });
    const maps = await nameMaps(orgId(req));
    res.json(mapRule(updated!, maps));
  },
);

router.delete(
  "/escalation-rules/:id",
  requirePermission("routing:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const existing = await loadOrgRow(orgId(req), id);
    if (!existing) {
      res.status(404).json({ error: "Escalation rule not found" });
      return;
    }
    await db.delete(escalationRulesTable).where(eq(escalationRulesTable.id, id));
    await writeAudit(req, {
      action: "EscalationRule.Delete",
      entityType: "escalation_rule",
      entityId: id,
      detail: `Deleted escalation rule "${existing.name}"`,
      before: { name: existing.name },
    });
    res.json(await loadRules(orgId(req)));
  },
);

export default router;
