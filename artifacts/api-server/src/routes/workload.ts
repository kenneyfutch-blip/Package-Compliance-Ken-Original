import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  specialistProfilesTable,
  departmentsTable,
  reviewAssignmentsTable,
} from "@workspace/db";
import { and, asc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { requirePermission, orgId } from "../lib/rbac/context";

const router: IRouter = Router();

// Per-specialist workload and capacity, computed live from review_assignments.
// Nothing is stored on the profile — this always reflects the current queue.
router.get(
  "/workload",
  requirePermission("specialists:read"),
  async (req: Request, res: Response): Promise<void> => {
    const organizationId = orgId(req);

    const [specialists, departments, agg] = await Promise.all([
      db
        .select()
        .from(specialistProfilesTable)
        .where(
          and(
            eq(specialistProfilesTable.organizationId, organizationId),
            ne(specialistProfilesTable.status, "archived"),
          ),
        )
        .orderBy(asc(specialistProfilesTable.name)),
      db
        .select({ id: departmentsTable.id, name: departmentsTable.name })
        .from(departmentsTable)
        .where(eq(departmentsTable.organizationId, organizationId)),
      db
        .select({
          userId: reviewAssignmentsTable.assigneeUserId,
          active: sql<number>`count(*) filter (where ${reviewAssignmentsTable.status} in ('Assigned','InProgress','Escalated'))::int`,
          pending: sql<number>`count(*) filter (where ${reviewAssignmentsTable.status} = 'Assigned')::int`,
          escalated: sql<number>`count(*) filter (where ${reviewAssignmentsTable.escalationLevel} > 0 and ${reviewAssignmentsTable.status} <> 'Completed')::int`,
          avgHours: sql<
            number | null
          >`avg(extract(epoch from (${reviewAssignmentsTable.completedAt} - ${reviewAssignmentsTable.assignedAt})) / 3600.0) filter (where ${reviewAssignmentsTable.status} = 'Completed' and ${reviewAssignmentsTable.completedAt} is not null and ${reviewAssignmentsTable.assignedAt} is not null)`,
        })
        .from(reviewAssignmentsTable)
        .where(
          and(
            eq(reviewAssignmentsTable.organizationId, organizationId),
            isNotNull(reviewAssignmentsTable.assigneeUserId),
          ),
        )
        .groupBy(reviewAssignmentsTable.assigneeUserId),
    ]);

    const deptName = new Map(departments.map((d) => [d.id, d.name]));
    const byUser = new Map(agg.map((a) => [a.userId, a]));

    const entries = specialists.map((s) => {
      const a = s.userId ? byUser.get(s.userId) : undefined;
      const activeReviews = a?.active ?? 0;
      return {
        specialistId: s.id,
        name: s.name,
        role: s.role,
        departmentName: s.departmentId
          ? (deptName.get(s.departmentId) ?? null)
          : null,
        status: s.status,
        acceptingAssignments: s.acceptingAssignments,
        activeReviews,
        maxActiveReviews: s.maxActiveReviews,
        availableCapacity: Math.max(0, s.maxActiveReviews - activeReviews),
        pendingTasks: a?.pending ?? 0,
        escalatedReviews: a?.escalated ?? 0,
        avgResolutionHours:
          a?.avgHours != null ? Math.round(Number(a.avgHours) * 10) / 10 : null,
      };
    });

    res.json(entries);
  },
);

export default router;
