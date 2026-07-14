import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  routingRulesTable,
  departmentsTable,
  specialistProfilesTable,
  reviewStagesTable,
  type RoutingRuleRow,
  type RoutingCondition,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { requirePermission, orgId } from "../lib/rbac/context";
import { writeAudit } from "../lib/audit";
import { departmentInOrg, specialistInOrg, reviewStageInOrg } from "../lib/orgRefs";

const router: IRouter = Router();

// Confirms referenced action targets belong to the caller's org.
async function validateRuleRefs(
  organizationId: number,
  values: Record<string, unknown>,
): Promise<string | null> {
  if (
    values["actionDepartmentId"] !== undefined &&
    !(await departmentInOrg(organizationId, values["actionDepartmentId"] as number | null))
  ) {
    return "Department not found";
  }
  if (
    values["actionSpecialistId"] !== undefined &&
    !(await specialistInOrg(organizationId, values["actionSpecialistId"] as number | null))
  ) {
    return "Specialist not found";
  }
  if (
    values["actionStageId"] !== undefined &&
    !(await reviewStageInOrg(organizationId, values["actionStageId"] as number | null))
  ) {
    return "Review stage not found";
  }
  return null;
}

function parseId(raw: string | string[] | undefined): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}
function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function sanitizeConditions(v: unknown): RoutingCondition[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((c) => ({
      field: String((c as RoutingCondition)?.field ?? "").trim(),
      operator: String((c as RoutingCondition)?.operator ?? "equals").trim(),
      value: String((c as RoutingCondition)?.value ?? "").trim(),
    }))
    .filter((c) => c.field);
}

// Evaluates one condition against a fact value. Numeric comparison is used when
// both sides parse as numbers; otherwise string comparison.
function evalCondition(cond: RoutingCondition, factValue: string | undefined): boolean {
  const actual = factValue ?? "";
  const expected = cond.value;
  const an = Number(actual);
  const en = Number(expected);
  const numeric =
    actual !== "" && expected !== "" && !Number.isNaN(an) && !Number.isNaN(en);
  switch (cond.operator) {
    case "equals":
      return actual.toLowerCase() === expected.toLowerCase();
    case "notEquals":
      return actual.toLowerCase() !== expected.toLowerCase();
    case "contains":
      return actual.toLowerCase().includes(expected.toLowerCase());
    case "greaterThan":
      return numeric ? an > en : false;
    case "greaterOrEqual":
      return numeric ? an >= en : false;
    case "lessThan":
      return numeric ? an < en : false;
    case "lessOrEqual":
      return numeric ? an <= en : false;
    default:
      return false;
  }
}

async function nameMaps(organizationId: number) {
  const [depts, specs, stages] = await Promise.all([
    db
      .select({ id: departmentsTable.id, name: departmentsTable.name })
      .from(departmentsTable)
      .where(eq(departmentsTable.organizationId, organizationId)),
    db
      .select({ id: specialistProfilesTable.id, name: specialistProfilesTable.name })
      .from(specialistProfilesTable)
      .where(eq(specialistProfilesTable.organizationId, organizationId)),
    db
      .select({ id: reviewStagesTable.id, name: reviewStagesTable.name })
      .from(reviewStagesTable)
      .where(eq(reviewStagesTable.organizationId, organizationId)),
  ]);
  return {
    dept: new Map(depts.map((d) => [d.id, d.name])),
    spec: new Map(specs.map((s) => [s.id, s.name])),
    stage: new Map(stages.map((s) => [s.id, s.name])),
  };
}

function actionLabel(
  r: RoutingRuleRow,
  maps: { dept: Map<number, string>; spec: Map<number, string>; stage: Map<number, string> },
): string {
  switch (r.actionType) {
    case "department":
      return r.actionDepartmentId
        ? `Route to ${maps.dept.get(r.actionDepartmentId) ?? "department"}`
        : "Route to department";
    case "specialist":
      return r.actionSpecialistId
        ? `Assign to ${maps.spec.get(r.actionSpecialistId) ?? "specialist"}`
        : "Assign to specialist";
    case "stage":
      return r.actionStageId
        ? `Send to stage: ${maps.stage.get(r.actionStageId) ?? "stage"}`
        : "Send to stage";
    case "escalate":
      return `Escalate${r.actionValue ? ` to ${r.actionValue}` : ""}`;
    default:
      return r.actionType;
  }
}

function mapRule(
  r: RoutingRuleRow,
  maps: { dept: Map<number, string>; spec: Map<number, string>; stage: Map<number, string> },
) {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    priority: r.priority,
    active: r.active,
    conditions: r.conditions ?? [],
    actionType: r.actionType,
    actionDepartmentId: r.actionDepartmentId ?? null,
    actionSpecialistId: r.actionSpecialistId ?? null,
    actionStageId: r.actionStageId ?? null,
    actionValue: r.actionValue ?? null,
    actionLabel: actionLabel(r, maps),
    createdAt: iso(r.createdAt)!,
    updatedAt: iso(r.updatedAt)!,
  };
}

async function loadRules(organizationId: number) {
  const [rules, maps] = await Promise.all([
    db
      .select()
      .from(routingRulesTable)
      .where(eq(routingRulesTable.organizationId, organizationId))
      .orderBy(asc(routingRulesTable.priority), asc(routingRulesTable.id)),
    nameMaps(organizationId),
  ]);
  return rules.map((r) => mapRule(r, maps));
}

async function loadOrgRow(organizationId: number, id: number) {
  const [row] = await db
    .select()
    .from(routingRulesTable)
    .where(
      and(
        eq(routingRulesTable.id, id),
        eq(routingRulesTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

function buildValues(body: Record<string, unknown>) {
  const v: Record<string, unknown> = {};
  if (body["name"] !== undefined) v["name"] = String(body["name"]).trim();
  if (body["description"] !== undefined)
    v["description"] = body["description"] ? String(body["description"]).trim() : null;
  if (body["priority"] !== undefined) v["priority"] = Number(body["priority"]);
  if (body["active"] !== undefined) v["active"] = Boolean(body["active"]);
  if (body["conditions"] !== undefined)
    v["conditions"] = sanitizeConditions(body["conditions"]);
  if (body["actionType"] !== undefined)
    v["actionType"] = String(body["actionType"]).trim();
  if (body["actionDepartmentId"] !== undefined)
    v["actionDepartmentId"] = body["actionDepartmentId"]
      ? Number(body["actionDepartmentId"])
      : null;
  if (body["actionSpecialistId"] !== undefined)
    v["actionSpecialistId"] = body["actionSpecialistId"]
      ? Number(body["actionSpecialistId"])
      : null;
  if (body["actionStageId"] !== undefined)
    v["actionStageId"] = body["actionStageId"] ? Number(body["actionStageId"]) : null;
  if (body["actionValue"] !== undefined)
    v["actionValue"] = body["actionValue"] ? String(body["actionValue"]).trim() : null;
  return v;
}

router.get(
  "/routing-rules",
  requirePermission("routing:read"),
  async (req: Request, res: Response): Promise<void> => {
    res.json(await loadRules(orgId(req)));
  },
);

router.post(
  "/routing-rules",
  requirePermission("routing:write"),
  async (req: Request, res: Response): Promise<void> => {
    const name = String(req.body?.name ?? "").trim();
    const actionType = String(req.body?.actionType ?? "").trim();
    if (!name || !actionType) {
      res.status(400).json({ error: "Rule name and action type are required" });
      return;
    }
    const values = buildValues(req.body ?? {});
    const refError = await validateRuleRefs(orgId(req), values);
    if (refError) {
      res.status(400).json({ error: refError });
      return;
    }
    const [created] = await db
      .insert(routingRulesTable)
      .values({
        ...values,
        name,
        actionType,
        organizationId: orgId(req),
      })
      .returning();
    await writeAudit(req, {
      action: "RoutingRule.Create",
      entityType: "routing_rule",
      entityId: created!.id,
      detail: `Created routing rule "${name}"`,
      after: { name, actionType },
    });
    const maps = await nameMaps(orgId(req));
    res.status(201).json(mapRule(created!, maps));
  },
);

// Deterministic preview: evaluate active rules in priority order against the
// provided facts and return the first match plus a full trace, so admins can see
// exactly why a rule did or did not fire.
router.post(
  "/routing-rules/preview",
  requirePermission("routing:read"),
  async (req: Request, res: Response): Promise<void> => {
    const facts: { field: string; value: string }[] = Array.isArray(
      req.body?.facts,
    )
      ? req.body.facts.map((f: { field?: unknown; value?: unknown }) => ({
          field: String(f?.field ?? "").trim(),
          value: String(f?.value ?? "").trim(),
        }))
      : [];
    const factMap = new Map(facts.map((f) => [f.field.toLowerCase(), f.value]));

    const rules = await db
      .select()
      .from(routingRulesTable)
      .where(
        and(
          eq(routingRulesTable.organizationId, orgId(req)),
          eq(routingRulesTable.active, true),
        ),
      )
      .orderBy(asc(routingRulesTable.priority), asc(routingRulesTable.id));
    const maps = await nameMaps(orgId(req));

    const trace: {
      ruleId: number;
      ruleName: string;
      matched: boolean;
      reason: string;
    }[] = [];
    let winner: RoutingRuleRow | null = null;
    for (const r of rules) {
      const conds = r.conditions ?? [];
      const failing = conds.filter(
        (c) => !evalCondition(c, factMap.get(c.field.toLowerCase())),
      );
      // A rule with no conditions is an unconditional catch-all (used for the
      // default fallback), so it matches. Rules with conditions match only when
      // every condition passes (conditions are ANDed).
      const matched = failing.length === 0;
      trace.push({
        ruleId: r.id,
        ruleName: r.name,
        matched,
        reason:
          conds.length === 0
            ? "No conditions — matches all (catch-all)"
            : matched
              ? "All conditions met"
              : `Failed: ${failing
                  .map((c) => `${c.field} ${c.operator} ${c.value}`)
                  .join(", ")}`,
      });
      if (matched && !winner) winner = r;
    }

    res.json({
      matched: winner !== null,
      ruleId: winner?.id ?? null,
      ruleName: winner?.name ?? null,
      actionType: winner?.actionType ?? null,
      actionLabel: winner ? actionLabel(winner, maps) : null,
      trace,
    });
  },
);

router.patch(
  "/routing-rules/:id",
  requirePermission("routing:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const existing = await loadOrgRow(orgId(req), id);
    if (!existing) {
      res.status(404).json({ error: "Routing rule not found" });
      return;
    }
    const values = buildValues(req.body ?? {});
    if (values["name"] !== undefined && !values["name"]) {
      res.status(400).json({ error: "Rule name cannot be empty" });
      return;
    }
    const refError = await validateRuleRefs(orgId(req), values);
    if (refError) {
      res.status(400).json({ error: refError });
      return;
    }
    const [updated] = await db
      .update(routingRulesTable)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(routingRulesTable.id, id))
      .returning();
    await writeAudit(req, {
      action: "RoutingRule.Update",
      entityType: "routing_rule",
      entityId: id,
      detail: `Updated routing rule "${existing.name}"`,
      after: values,
    });
    const maps = await nameMaps(orgId(req));
    res.json(mapRule(updated!, maps));
  },
);

router.delete(
  "/routing-rules/:id",
  requirePermission("routing:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const existing = await loadOrgRow(orgId(req), id);
    if (!existing) {
      res.status(404).json({ error: "Routing rule not found" });
      return;
    }
    await db.delete(routingRulesTable).where(eq(routingRulesTable.id, id));
    await writeAudit(req, {
      action: "RoutingRule.Delete",
      entityType: "routing_rule",
      entityId: id,
      detail: `Deleted routing rule "${existing.name}"`,
      before: { name: existing.name },
    });
    res.json(await loadRules(orgId(req)));
  },
);

export default router;
