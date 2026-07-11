import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  packagesTable,
  teamsTable,
  usersTable,
  type PackageRow,
  type ReviewAssignmentRow,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { AssignPackageReviewBody, BulkAssignReviewsBody } from "@workspace/api-zod";
import { requirePermission, orgId, getAuthContext } from "../lib/rbac/context";
import { packageConds, canAccessPackage, opsTeamScope } from "../lib/rbac/scope";
import { writeAudit } from "../lib/audit";
import { mapReviewAssignment, mapReviewHistory } from "../lib/mappers";
import { assignReview, autoAssignReview, getPackageAssignment } from "../lib/reviews/engine";
import { matchTeamName } from "../lib/reviews/routing";
import {
  computeMetrics,
  computeMyWork,
  computeOversight,
  computeWorkload,
  listAssignments,
  recommendAssignee,
} from "../lib/reviews/reporting";

const router: IRouter = Router();

function requireId(
  raw: string | string[] | undefined,
  res: Response,
): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  return id;
}

async function loadOwnedPackage(
  req: Request,
  res: Response,
  id: number,
): Promise<PackageRow | null> {
  const [pkg] = await db.select().from(packagesTable).where(eq(packagesTable.id, id));
  if (!pkg || !canAccessPackage(req, pkg)) {
    res.status(404).json({ error: "Package not found" });
    return null;
  }
  return pkg;
}

// Resolve the display names referenced by an assignment for the response DTO.
async function assignmentDetail(
  organizationId: number,
  pkg: PackageRow,
): Promise<{
  packageId: number;
  packageName: string;
  assignment: ReturnType<typeof mapReviewAssignment> | null;
  history: ReturnType<typeof mapReviewHistory>[];
}> {
  const { assignment, history } = await getPackageAssignment(organizationId, pkg.id);
  let teamName: string | null = null;
  if (assignment?.teamId) {
    const [t] = await db
      .select({ name: teamsTable.name })
      .from(teamsTable)
      .where(eq(teamsTable.id, assignment.teamId))
      .limit(1);
    teamName = t?.name ?? null;
  }
  const nameFor = async (userId: number | null | undefined): Promise<string | null> => {
    if (!userId) return null;
    const [u] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    return u?.name ?? null;
  };
  const [assigneeName, backupName, managerName] = await Promise.all([
    nameFor(assignment?.assigneeUserId),
    nameFor(assignment?.backupUserId),
    nameFor(assignment?.managerUserId),
  ]);
  return {
    packageId: pkg.id,
    packageName: pkg.name,
    assignment: assignment
      ? mapReviewAssignment(assignment, { teamName, assigneeName, backupName, managerName })
      : null,
    history: history.map(mapReviewHistory),
  };
}

// Supplier users are scoped to their own vendor's packages and must never see
// org-wide internal staff workload / performance data.
function blockSupplierUsers(req: Request, res: Response): boolean {
  if (getAuthContext(req).roleKey === "supplier_user") {
    res.status(403).json({ error: "Not authorized to view internal review operations" });
    return true;
  }
  return false;
}

// GET /reviews/workload — per-team and per-member capacity, utilization, average
// review time, and rebalancing recommendations. Internal reviewers/managers only.
router.get(
  "/reviews/workload",
  requirePermission("packages:read"),
  async (req: Request, res: Response): Promise<void> => {
    if (blockSupplierUsers(req, res)) return;
    // Team-scoped roles see only their own teams' workload; org-wide oversight
    // roles (admin/director/executive) see the whole organization.
    const scope = opsTeamScope(req);
    res.json(await computeWorkload(orgId(req), scope ? scope.teamIds : null));
  },
);

// GET /reviews/metrics — SLA performance and review-time metrics for reporting.
router.get(
  "/reviews/metrics",
  requirePermission("reports:read"),
  async (req: Request, res: Response): Promise<void> => {
    if (blockSupplierUsers(req, res)) return;
    const scope = opsTeamScope(req);
    res.json(await computeMetrics(orgId(req), scope ? scope.teamIds : null));
  },
);

// GET /reviews/assignments — list assignments, filterable by status/team/assignee.
router.get(
  "/reviews/assignments",
  requirePermission("packages:read"),
  async (req: Request, res: Response): Promise<void> => {
    const { status, teamId, assigneeUserId } = req.query;
    const filters: {
      status?: string;
      teamId?: number;
      assigneeUserId?: number;
    } = {};
    if (typeof status === "string" && status) filters.status = status;
    if (typeof teamId === "string" && teamId && Number.isInteger(Number(teamId)))
      filters.teamId = Number(teamId);
    if (
      typeof assigneeUserId === "string" &&
      assigneeUserId &&
      Number.isInteger(Number(assigneeUserId))
    )
      filters.assigneeUserId = Number(assigneeUserId);

    // Scope to packages the caller may access (supplier users see only their own
    // supplier's packages); packageConds targets the joined packages table.
    // Additionally, team-scoped internal roles see only their own teams' (and
    // their own) assignments; org-wide roles and supplier users are unrestricted
    // here (the latter are already constrained by packageConds).
    const rows = await listAssignments(
      orgId(req),
      filters,
      packageConds(req),
      opsTeamScope(req),
    );
    res.json(
      rows.map((r) => ({
        assignment: mapReviewAssignment(r.assignment, {
          teamName: r.teamName,
          assigneeName: r.assigneeName,
        }),
        packageName: r.packageName,
        packageSku: r.packageSku,
        category: r.category,
        criticalCount: r.criticalCount,
        complianceStatus: r.complianceStatus,
      })),
    );
  },
);

// GET /reviews/my-work — the signed-in reviewer's personal queue + workload.
router.get(
  "/reviews/my-work",
  requirePermission("packages:read"),
  async (req: Request, res: Response): Promise<void> => {
    if (blockSupplierUsers(req, res)) return;
    const ctx = getAuthContext(req);
    res.json(await computeMyWork(orgId(req), ctx.userId));
  },
);

// GET /reviews/oversight — per-member and per-team ownership + SLA for managers.
router.get(
  "/reviews/oversight",
  requirePermission("packages:read"),
  async (req: Request, res: Response): Promise<void> => {
    if (blockSupplierUsers(req, res)) return;
    const scope = opsTeamScope(req);
    res.json(await computeOversight(orgId(req), scope ? scope.teamIds : null));
  },
);

// GET /reviews/recommend — suggest a better-balanced assignee.
router.get(
  "/reviews/recommend",
  requirePermission("packages:read"),
  async (req: Request, res: Response): Promise<void> => {
    if (blockSupplierUsers(req, res)) return;
    const opts: { assigneeUserId?: number; teamId?: number } = {};
    const a = req.query["assigneeUserId"];
    const t = req.query["teamId"];
    if (typeof a === "string" && a && Number.isInteger(Number(a)))
      opts.assigneeUserId = Number(a);
    if (typeof t === "string" && t && Number.isInteger(Number(t)))
      opts.teamId = Number(t);
    const scope = opsTeamScope(req);
    res.json(await recommendAssignee(orgId(req), opts, scope ? scope.teamIds : null));
  },
);

// GET /reviews/assignable — minimal people + teams list to populate the
// assignment picker. Gated on packages:write (the same permission the assign
// action itself requires) so any reviewer who can assign work can load it,
// without granting admin-tier users:read / teams:read. Returns ids + names
// only, org-scoped, and excludes external supplier accounts.
router.get(
  "/reviews/assignable",
  requirePermission("packages:write"),
  async (req: Request, res: Response): Promise<void> => {
    if (blockSupplierUsers(req, res)) return;
    const org = orgId(req);
    const [users, teams] = await Promise.all([
      db
        .select({ id: usersTable.id, name: usersTable.name })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.organizationId, org),
            eq(usersTable.active, true),
            isNull(usersTable.supplierId),
          ),
        ),
      db
        .select({ id: teamsTable.id, name: teamsTable.name })
        .from(teamsTable)
        .where(eq(teamsTable.organizationId, org)),
    ]);
    res.json({ users, teams });
  },
);

// POST /reviews/bulk-assign — assign / reassign many reviews at once.
router.post(
  "/reviews/bulk-assign",
  requirePermission("packages:write"),
  async (req: Request, res: Response): Promise<void> => {
    if (blockSupplierUsers(req, res)) return;
    const parsed = BulkAssignReviewsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const data = parsed.data;
    const organizationId = orgId(req);
    const ctx = getAuthContext(req);

    // Validate referenced team/users up front so a bad id fails the whole batch
    // rather than partially assigning.
    if (data.teamId !== undefined && data.teamId !== null) {
      const [team] = await db
        .select({ id: teamsTable.id })
        .from(teamsTable)
        .where(and(eq(teamsTable.id, data.teamId), eq(teamsTable.organizationId, organizationId)))
        .limit(1);
      if (!team) {
        res.status(400).json({ error: "Team not found in your organization" });
        return;
      }
    }
    const userChecks: [string, number | null | undefined][] = [
      ["Assignee", data.assigneeUserId],
      ["Backup reviewer", data.backupUserId],
      ["Manager", data.managerUserId],
    ];
    for (const [label, uid] of userChecks) {
      if (uid === undefined || uid === null) continue;
      const [user] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.id, uid),
            eq(usersTable.organizationId, organizationId),
            eq(usersTable.active, true),
            isNull(usersTable.supplierId),
          ),
        )
        .limit(1);
      if (!user) {
        res.status(400).json({ error: `${label} must be an active member of your organization` });
        return;
      }
    }

    const failed: { packageId: number; error: string }[] = [];
    let assigned = 0;
    for (const packageId of data.packageIds) {
      const [pkg] = await db.select().from(packagesTable).where(eq(packagesTable.id, packageId));
      if (!pkg || !canAccessPackage(req, pkg)) {
        failed.push({ packageId, error: "Package not found or not accessible" });
        continue;
      }
      try {
        const row = await assignReview({
          organizationId,
          packageId,
          teamId: data.teamId,
          assigneeUserId: data.assigneeUserId,
          backupUserId: data.backupUserId,
          managerUserId: data.managerUserId,
          priority: data.priority,
          slaHours: data.slaHours,
          reason: data.reason ?? "Bulk assignment",
          comments: data.comments ?? null,
          actorUserId: ctx.userId,
          actorName: ctx.name || ctx.email || "Unknown",
          packageName: pkg.name,
        });
        await writeAudit(req, {
          action: "Review bulk-assigned",
          entityType: "review_assignment",
          entityId: row.id,
          packageId,
          detail: `Bulk assignment updated for ${pkg.name}.`,
          after: { teamId: row.teamId, assigneeUserId: row.assigneeUserId, status: row.status },
        });
        assigned += 1;
      } catch {
        failed.push({ packageId, error: "Assignment failed" });
      }
    }

    res.json({ assigned, failed });
  },
);

// GET /packages/:id/assignment — current assignment + ownership history.
router.get(
  "/packages/:id/assignment",
  requirePermission("packages:read"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const pkg = await loadOwnedPackage(req, res, id);
    if (!pkg) return;
    res.json(await assignmentDetail(orgId(req), pkg));
  },
);

// POST /packages/:id/assign — manual assignment / reassignment.
router.post(
  "/packages/:id/assign",
  requirePermission("packages:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const parsed = AssignPackageReviewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const pkg = await loadOwnedPackage(req, res, id);
    if (!pkg) return;
    const organizationId = orgId(req);
    const data = parsed.data;

    // Validate referenced team/assignee belong to this org before assigning.
    if (data.teamId !== undefined && data.teamId !== null) {
      const [team] = await db
        .select({ id: teamsTable.id })
        .from(teamsTable)
        .where(and(eq(teamsTable.id, data.teamId), eq(teamsTable.organizationId, organizationId)))
        .limit(1);
      if (!team) {
        res.status(400).json({ error: "Team not found in your organization" });
        return;
      }
    }
    // Validate every referenced user (assignee, backup, manager) belongs to org.
    const userFields: [string, number | null | undefined][] = [
      ["Assignee", data.assigneeUserId],
      ["Backup reviewer", data.backupUserId],
      ["Manager", data.managerUserId],
    ];
    for (const [label, uid] of userFields) {
      if (uid === undefined || uid === null) continue;
      const [user] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.id, uid),
            eq(usersTable.organizationId, organizationId),
            eq(usersTable.active, true),
            isNull(usersTable.supplierId),
          ),
        )
        .limit(1);
      if (!user) {
        res.status(400).json({ error: `${label} must be an active member of your organization` });
        return;
      }
    }

    const ctx = getAuthContext(req);
    const row: ReviewAssignmentRow = await assignReview({
      organizationId,
      packageId: pkg.id,
      teamId: data.teamId,
      assigneeUserId: data.assigneeUserId,
      backupUserId: data.backupUserId,
      managerUserId: data.managerUserId,
      priority: data.priority,
      slaHours: data.slaHours,
      reason: data.reason ?? null,
      comments: data.comments ?? null,
      actorUserId: ctx.userId,
      actorName: ctx.name || ctx.email || "Unknown",
      packageName: pkg.name,
    });

    await writeAudit(req, {
      action: "Review reassigned",
      entityType: "review_assignment",
      entityId: row.id,
      packageId: pkg.id,
      detail: `Review assignment updated for ${pkg.name}.`,
      after: {
        teamId: row.teamId,
        assigneeUserId: row.assigneeUserId,
        status: row.status,
      },
    });

    res.json(await assignmentDetail(organizationId, pkg));
  },
);

// POST /packages/:id/auto-assign — route by category and load-balance onto a member.
router.post(
  "/packages/:id/auto-assign",
  requirePermission("packages:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const pkg = await loadOwnedPackage(req, res, id);
    if (!pkg) return;
    const organizationId = orgId(req);
    const ctx = getAuthContext(req);
    const row = await autoAssignReview({
      organizationId,
      packageId: pkg.id,
      category: pkg.category,
      teamName: matchTeamName(pkg.category),
      priority: (pkg.criticalCount ?? 0) > 0 ? "critical" : "normal",
      actorUserId: ctx.userId,
      actorName: ctx.name || ctx.email || "Unknown",
      packageName: pkg.name,
    });

    await writeAudit(req, {
      action: "Review auto-assigned",
      entityType: "review_assignment",
      entityId: row.id,
      packageId: pkg.id,
      detail: `Auto-routed ${pkg.name} by category "${pkg.category}".`,
      after: { teamId: row.teamId, assigneeUserId: row.assigneeUserId },
    });

    res.json(await assignmentDetail(organizationId, pkg));
  },
);

export default router;
