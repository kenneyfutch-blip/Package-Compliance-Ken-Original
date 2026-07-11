import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  packagesTable,
  teamsTable,
  usersTable,
  type PackageRow,
  type ReviewAssignmentRow,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { AssignPackageReviewBody } from "@workspace/api-zod";
import { requirePermission, orgId, getAuthContext } from "../lib/rbac/context";
import { packageConds, canAccessPackage, opsTeamScope } from "../lib/rbac/scope";
import { writeAudit } from "../lib/audit";
import { mapReviewAssignment, mapReviewHistory } from "../lib/mappers";
import { assignReview, autoAssignReview, getPackageAssignment } from "../lib/reviews/engine";
import { matchTeamName } from "../lib/reviews/routing";
import {
  computeMetrics,
  computeWorkload,
  listAssignments,
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
  let assigneeName: string | null = null;
  if (assignment?.teamId) {
    const [t] = await db
      .select({ name: teamsTable.name })
      .from(teamsTable)
      .where(eq(teamsTable.id, assignment.teamId))
      .limit(1);
    teamName = t?.name ?? null;
  }
  if (assignment?.assigneeUserId) {
    const [u] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, assignment.assigneeUserId))
      .limit(1);
    assigneeName = u?.name ?? null;
  }
  return {
    packageId: pkg.id,
    packageName: pkg.name,
    assignment: assignment
      ? mapReviewAssignment(assignment, { teamName, assigneeName })
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
    if (data.assigneeUserId !== undefined && data.assigneeUserId !== null) {
      const [user] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.id, data.assigneeUserId),
            eq(usersTable.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!user) {
        res.status(400).json({ error: "Assignee not found in your organization" });
        return;
      }
    }

    const ctx = getAuthContext(req);
    const row: ReviewAssignmentRow = await assignReview({
      organizationId,
      packageId: pkg.id,
      teamId: data.teamId,
      assigneeUserId: data.assigneeUserId,
      priority: data.priority,
      slaHours: data.slaHours,
      actorUserId: ctx.userId,
      actorName: ctx.name || ctx.email || "Unknown",
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
