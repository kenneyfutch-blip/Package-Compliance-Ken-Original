import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  specialistProfilesTable,
  specialistCertificationsTable,
  departmentsTable,
  reviewAssignmentsTable,
  usersTable,
  type SpecialistProfileRow,
  type SpecialistCertificationRow,
} from "@workspace/db";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { requirePermission, orgId } from "../lib/rbac/context";
import { writeAudit } from "../lib/audit";
import { departmentInOrg, userInOrg } from "../lib/orgRefs";

const router: IRouter = Router();

// Confirms any referenced foreign IDs in a profile write belong to the caller's
// org. Returns an error message when a reference points outside the org.
async function validateProfileRefs(
  organizationId: number,
  values: Record<string, unknown>,
): Promise<string | null> {
  if (
    values["departmentId"] !== undefined &&
    !(await departmentInOrg(organizationId, values["departmentId"] as number | null))
  ) {
    return "Department not found";
  }
  if (
    values["userId"] !== undefined &&
    !(await userInOrg(organizationId, values["userId"] as number | null))
  ) {
    return "User not found";
  }
  return null;
}

const ACTIVE_STATUSES = ["Assigned", "InProgress", "Escalated"];

function parseId(raw: string | string[] | undefined): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

function mapCertification(c: SpecialistCertificationRow) {
  return {
    id: c.id,
    name: c.name,
    issuer: c.issuer ?? null,
    effectiveDate: c.effectiveDate ?? null,
    expirationDate: c.expirationDate ?? null,
    documentObjectPath: c.documentObjectPath ?? null,
    createdAt: iso(c.createdAt)!,
  };
}

function mapSpecialist(
  s: SpecialistProfileRow,
  departmentName: string | null,
  certs: SpecialistCertificationRow[],
  activeReviews: number,
) {
  const availableCapacity = Math.max(0, s.maxActiveReviews - activeReviews);
  return {
    id: s.id,
    userId: s.userId ?? null,
    name: s.name,
    email: s.email ?? null,
    employeeId: s.employeeId ?? null,
    photoUrl: s.photoUrl ?? null,
    jobTitle: s.jobTitle ?? null,
    departmentId: s.departmentId ?? null,
    departmentName,
    managerName: s.managerName ?? null,
    location: s.location ?? null,
    timeZone: s.timeZone ?? null,
    role: s.role,
    status: s.status,
    activeReviewer: s.activeReviewer,
    acceptingAssignments: s.acceptingAssignments,
    routingPriority: s.routingPriority,
    expertiseRating: s.expertiseRating,
    backupReviewer: s.backupReviewer,
    escalationLevel: s.escalationLevel,
    approvalAuthority: s.approvalAuthority,
    maxActiveReviews: s.maxActiveReviews,
    expertise: s.expertise ?? [],
    regions: s.regions ?? [],
    productCategories: s.productCategories ?? [],
    notes: s.notes ?? null,
    activeReviews,
    availableCapacity,
    certifications: certs.map(mapCertification),
    createdAt: iso(s.createdAt)!,
    updatedAt: iso(s.updatedAt)!,
  };
}

// Loads specialists for an org together with department names, certifications and
// live active-review counts, avoiding N+1 across profiles.
async function loadSpecialists(
  organizationId: number,
  opts: { status?: string; departmentId?: number } = {},
) {
  const conds = [eq(specialistProfilesTable.organizationId, organizationId)];
  if (opts.status) conds.push(eq(specialistProfilesTable.status, opts.status));
  if (opts.departmentId)
    conds.push(eq(specialistProfilesTable.departmentId, opts.departmentId));

  const profiles = await db
    .select()
    .from(specialistProfilesTable)
    .where(and(...conds))
    .orderBy(asc(specialistProfilesTable.name));
  if (profiles.length === 0) return [];

  const [departments, certs, workload] = await Promise.all([
    db
      .select({ id: departmentsTable.id, name: departmentsTable.name })
      .from(departmentsTable)
      .where(eq(departmentsTable.organizationId, organizationId)),
    db
      .select()
      .from(specialistCertificationsTable)
      .where(
        and(
          eq(specialistCertificationsTable.organizationId, organizationId),
          inArray(
            specialistCertificationsTable.specialistProfileId,
            profiles.map((p) => p.id),
          ),
        ),
      ),
    db
      .select({
        userId: reviewAssignmentsTable.assigneeUserId,
        count: sql<number>`count(*)::int`,
      })
      .from(reviewAssignmentsTable)
      .where(
        and(
          eq(reviewAssignmentsTable.organizationId, organizationId),
          inArray(reviewAssignmentsTable.status, ACTIVE_STATUSES),
          isNotNull(reviewAssignmentsTable.assigneeUserId),
        ),
      )
      .groupBy(reviewAssignmentsTable.assigneeUserId),
  ]);

  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const certsByProfile = new Map<number, SpecialistCertificationRow[]>();
  for (const c of certs) {
    const list = certsByProfile.get(c.specialistProfileId) ?? [];
    list.push(c);
    certsByProfile.set(c.specialistProfileId, list);
  }
  const activeByUser = new Map(workload.map((w) => [w.userId, w.count]));

  return profiles.map((p) =>
    mapSpecialist(
      p,
      p.departmentId ? (deptName.get(p.departmentId) ?? null) : null,
      certsByProfile.get(p.id) ?? [],
      p.userId ? (activeByUser.get(p.userId) ?? 0) : 0,
    ),
  );
}

async function loadOne(organizationId: number, id: number) {
  const list = await loadSpecialists(organizationId);
  return list.find((s) => s.id === id) ?? null;
}

async function loadOrgProfile(organizationId: number, id: number) {
  const [row] = await db
    .select()
    .from(specialistProfilesTable)
    .where(
      and(
        eq(specialistProfilesTable.id, id),
        eq(specialistProfilesTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

// Builds the column subset to write from a request body. Only keys present in the
// body are set, so PATCH is a partial update.
function buildProfileValues(body: Record<string, unknown>) {
  const v: Record<string, unknown> = {};
  const strFields = [
    "email",
    "employeeId",
    "photoUrl",
    "jobTitle",
    "managerName",
    "location",
    "timeZone",
    "notes",
  ];
  for (const f of strFields) {
    if (body[f] !== undefined)
      v[f] = body[f] ? String(body[f]).trim() : null;
  }
  if (body["name"] !== undefined) v["name"] = String(body["name"]).trim();
  if (body["role"] !== undefined) v["role"] = String(body["role"]).trim();
  if (body["status"] !== undefined) v["status"] = String(body["status"]).trim();
  if (body["departmentId"] !== undefined)
    v["departmentId"] = body["departmentId"] ? Number(body["departmentId"]) : null;
  if (body["userId"] !== undefined)
    v["userId"] = body["userId"] ? Number(body["userId"]) : null;

  const boolFields = [
    "activeReviewer",
    "acceptingAssignments",
    "backupReviewer",
    "approvalAuthority",
  ];
  for (const f of boolFields) {
    if (body[f] !== undefined) v[f] = Boolean(body[f]);
  }
  const intFields = [
    "routingPriority",
    "expertiseRating",
    "escalationLevel",
    "maxActiveReviews",
  ];
  for (const f of intFields) {
    if (body[f] !== undefined) v[f] = Number(body[f]);
  }
  if (body["expertise"] !== undefined) v["expertise"] = strArray(body["expertise"]);
  if (body["regions"] !== undefined) v["regions"] = strArray(body["regions"]);
  if (body["productCategories"] !== undefined)
    v["productCategories"] = strArray(body["productCategories"]);
  return v;
}

router.get(
  "/specialists",
  requirePermission("specialists:read"),
  async (req: Request, res: Response): Promise<void> => {
    const status = req.query["status"] ? String(req.query["status"]) : undefined;
    const departmentId = req.query["departmentId"]
      ? Number(req.query["departmentId"])
      : undefined;
    res.json(await loadSpecialists(orgId(req), { status, departmentId }));
  },
);

// The AI routing knowledge base query: filter + rank specialists for a routing
// decision. Never guesses — returns only specialists whose structured data
// matches the requested expertise/region/category/authority/availability.
router.get(
  "/specialists/directory/query",
  requirePermission("specialists:read"),
  async (req: Request, res: Response): Promise<void> => {
    const q = req.query;
    const expertise = q["expertise"] ? String(q["expertise"]).toLowerCase() : null;
    const region = q["region"] ? String(q["region"]).toLowerCase() : null;
    const productCategory = q["productCategory"]
      ? String(q["productCategory"]).toLowerCase()
      : null;
    const availableOnly = q["availableOnly"] === "true";
    const approvalAuthority = q["approvalAuthority"] === "true";
    const minExpertiseRating = q["minExpertiseRating"]
      ? Number(q["minExpertiseRating"])
      : null;
    const escalationLevel = q["escalationLevel"]
      ? Number(q["escalationLevel"])
      : null;

    let list = await loadSpecialists(orgId(req));
    // Only active directory records participate in routing.
    list = list.filter((s) => s.status === "active");
    if (expertise)
      list = list.filter((s) =>
        s.expertise.some((e) => e.toLowerCase().includes(expertise)),
      );
    if (region)
      list = list.filter((s) =>
        s.regions.some((r) => r.toLowerCase().includes(region)),
      );
    if (productCategory)
      list = list.filter((s) =>
        s.productCategories.some((c) => c.toLowerCase().includes(productCategory)),
      );
    if (approvalAuthority) list = list.filter((s) => s.approvalAuthority);
    if (minExpertiseRating !== null)
      list = list.filter((s) => s.expertiseRating >= minExpertiseRating);
    if (escalationLevel !== null)
      list = list.filter((s) => s.escalationLevel >= escalationLevel);
    if (availableOnly)
      list = list.filter(
        (s) =>
          s.activeReviewer &&
          s.acceptingAssignments &&
          s.availableCapacity > 0,
      );

    // Rank: prefer higher routing priority, then higher expertise, then more
    // available capacity.
    list.sort(
      (a, b) =>
        b.routingPriority - a.routingPriority ||
        b.expertiseRating - a.expertiseRating ||
        b.availableCapacity - a.availableCapacity,
    );
    res.json(list);
  },
);

// GET /specialists/linkable-users — active org user accounts a specialist
// profile can be linked to (so reviews assigned to that specialist route to a
// real login). Gated on specialists:write — the same permission the link edit
// needs — so managing the directory doesn't also require admin users:read.
// Declared before "/specialists/:id" so the literal path isn't captured by :id.
router.get(
  "/specialists/linkable-users",
  requirePermission("specialists:write"),
  async (req: Request, res: Response): Promise<void> => {
    const org = orgId(req);
    const users = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
      })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.organizationId, org),
          eq(usersTable.active, true),
          isNull(usersTable.supplierId),
        ),
      )
      .orderBy(asc(usersTable.name));
    res.json(users);
  },
);

router.get(
  "/specialists/:id",
  requirePermission("specialists:read"),
  async (req: Request, res: Response): Promise<void> => {
    const s = await loadOne(orgId(req), parseId(req.params["id"]));
    if (!s) {
      res.status(404).json({ error: "Specialist not found" });
      return;
    }
    res.json(s);
  },
);

router.post(
  "/specialists",
  requirePermission("specialists:write"),
  async (req: Request, res: Response): Promise<void> => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) {
      res.status(400).json({ error: "Specialist name is required" });
      return;
    }
    const values = buildProfileValues(req.body ?? {});
    const refError = await validateProfileRefs(orgId(req), values);
    if (refError) {
      res.status(400).json({ error: refError });
      return;
    }
    const [created] = await db
      .insert(specialistProfilesTable)
      .values({ ...values, name, organizationId: orgId(req) })
      .returning();
    await writeAudit(req, {
      action: "Specialist.Create",
      entityType: "specialist",
      entityId: created!.id,
      detail: `Created specialist "${name}"`,
      after: { name, role: created!.role },
    });
    res.status(201).json((await loadOne(orgId(req), created!.id))!);
  },
);

router.patch(
  "/specialists/:id",
  requirePermission("specialists:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const existing = await loadOrgProfile(orgId(req), id);
    if (!existing) {
      res.status(404).json({ error: "Specialist not found" });
      return;
    }
    const values = buildProfileValues(req.body ?? {});
    if (values["name"] !== undefined && !values["name"]) {
      res.status(400).json({ error: "Specialist name cannot be empty" });
      return;
    }
    const refError = await validateProfileRefs(orgId(req), values);
    if (refError) {
      res.status(400).json({ error: refError });
      return;
    }
    await db
      .update(specialistProfilesTable)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(specialistProfilesTable.id, id));
    await writeAudit(req, {
      action:
        values["status"] && values["status"] !== existing.status
          ? "Specialist.StatusChange"
          : "Specialist.Update",
      entityType: "specialist",
      entityId: id,
      detail:
        values["status"] && values["status"] !== existing.status
          ? `Specialist "${existing.name}" -> ${values["status"]}`
          : `Updated specialist "${existing.name}"`,
      before: { status: existing.status, role: existing.role },
      after: values,
    });
    res.json((await loadOne(orgId(req), id))!);
  },
);

router.post(
  "/specialists/:id/certifications",
  requirePermission("specialists:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const profile = await loadOrgProfile(orgId(req), id);
    if (!profile) {
      res.status(404).json({ error: "Specialist not found" });
      return;
    }
    const name = String(req.body?.name ?? "").trim();
    if (!name) {
      res.status(400).json({ error: "Certification name is required" });
      return;
    }
    await db.insert(specialistCertificationsTable).values({
      organizationId: orgId(req),
      specialistProfileId: id,
      name,
      issuer: req.body?.issuer ? String(req.body.issuer).trim() : null,
      effectiveDate: req.body?.effectiveDate
        ? String(req.body.effectiveDate)
        : null,
      expirationDate: req.body?.expirationDate
        ? String(req.body.expirationDate)
        : null,
      documentObjectPath: req.body?.documentObjectPath
        ? String(req.body.documentObjectPath)
        : null,
    });
    await writeAudit(req, {
      action: "Specialist.AddCertification",
      entityType: "specialist",
      entityId: id,
      detail: `Added certification "${name}" to ${profile.name}`,
      after: { name },
    });
    res.status(201).json((await loadOne(orgId(req), id))!);
  },
);

router.delete(
  "/specialists/:id/certifications/:certId",
  requirePermission("specialists:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const certId = parseId(req.params["certId"]);
    const profile = await loadOrgProfile(orgId(req), id);
    if (!profile) {
      res.status(404).json({ error: "Specialist not found" });
      return;
    }
    await db
      .delete(specialistCertificationsTable)
      .where(
        and(
          eq(specialistCertificationsTable.id, certId),
          eq(specialistCertificationsTable.specialistProfileId, id),
          eq(specialistCertificationsTable.organizationId, orgId(req)),
        ),
      );
    await writeAudit(req, {
      action: "Specialist.RemoveCertification",
      entityType: "specialist",
      entityId: id,
      detail: `Removed a certification from ${profile.name}`,
      before: { certId },
    });
    res.json((await loadOne(orgId(req), id))!);
  },
);

export default router;
