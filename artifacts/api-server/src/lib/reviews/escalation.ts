import {
  db,
  reviewAssignmentsTable,
  reviewHistoryTable,
  notificationsTable,
  packagesTable,
} from "@workspace/db";
import { and, eq, gt, inArray, isNotNull, lt } from "drizzle-orm";
import { ACTIVE_STATUSES } from "./engine";

export const ESCALATION_SWEEP_TYPE = "escalation.sweep";
export const SWEEP_INTERVAL_MS = 15 * 60_000;

// Escalation ladder for unaddressed critical violations. Checked highest-first so
// a badly overdue review jumps straight to the right tier. escalationLevel is
// monotonic, so each tier only ever fires once per review.
const TIERS = [
  { level: 3, hours: 72, label: "Leadership" },
  { level: 2, hours: 48, label: "Director" },
  { level: 1, hours: 24, label: "Manager" },
] as const;

// Scan assigned reviews that still carry open critical violations and escalate
// any that have blown past a tier threshold without being resolved. The clock
// runs from when the review was assigned to a member. Notifications are
// org-scoped (the notifications table has no per-user targeting); tiering is
// conveyed in the notification title.
export async function runEscalationSweep(): Promise<Record<string, unknown>> {
  const now = new Date();
  const rows = await db
    .select({
      assignment: reviewAssignmentsTable,
      criticalCount: packagesTable.criticalCount,
      packageName: packagesTable.name,
    })
    .from(reviewAssignmentsTable)
    .innerJoin(packagesTable, eq(reviewAssignmentsTable.packageId, packagesTable.id))
    .where(
      and(
        inArray(reviewAssignmentsTable.status, ACTIVE_STATUSES),
        isNotNull(reviewAssignmentsTable.assignedAt),
        gt(packagesTable.criticalCount, 0),
      ),
    );

  let escalated = 0;
  for (const { assignment: a, packageName } of rows) {
    if (!a.assignedAt) continue;
    const hoursOpen = (now.getTime() - new Date(a.assignedAt).getTime()) / 3_600_000;
    const tier = TIERS.find((t) => hoursOpen >= t.hours && a.escalationLevel < t.level);
    if (!tier) continue;

    const didEscalate = await db.transaction(async (tx) => {
      // Atomic monotonic guard: only escalate if still below this tier. If a
      // concurrent/replayed sweep already raised the level, the predicate matches
      // no row and we skip the duplicate notification + history entry.
      const [updated] = await tx
        .update(reviewAssignmentsTable)
        .set({
          escalationLevel: tier.level,
          lastEscalatedAt: now,
          status: "Escalated",
        })
        .where(
          and(
            eq(reviewAssignmentsTable.id, a.id),
            lt(reviewAssignmentsTable.escalationLevel, tier.level),
          ),
        )
        .returning({ id: reviewAssignmentsTable.id });
      if (!updated) return false;

      const title = `Critical review overdue — escalated to ${tier.label}`;
      const message = `"${packageName}" has unresolved critical violations ${Math.floor(
        hoursOpen,
      )}h after assignment. Escalated to ${tier.label} for immediate attention.`;
      // Target the accountable people directly (assignee + responsible manager);
      // fall back to an org-wide notice when neither is set.
      const targets = Array.from(
        new Set(
          [a.assigneeUserId, a.managerUserId].filter(
            (id): id is number => typeof id === "number",
          ),
        ),
      );
      if (targets.length > 0) {
        await tx.insert(notificationsTable).values(
          targets.map((userId) => ({
            organizationId: a.organizationId ?? undefined,
            userId,
            packageId: a.packageId,
            title,
            message,
            type: "critical",
          })),
        );
      } else {
        await tx.insert(notificationsTable).values({
          organizationId: a.organizationId ?? undefined,
          packageId: a.packageId,
          title,
          message,
          type: "critical",
        });
      }

      await tx.insert(reviewHistoryTable).values({
        organizationId: a.organizationId,
        packageId: a.packageId,
        assignmentId: a.id,
        action: "escalated",
        actorName: "System",
        escalationLevel: tier.level,
        detail: `Escalated to ${tier.label} after ${Math.floor(hoursOpen)}h with open critical violations`,
      });
      return true;
    });
    if (didEscalate) escalated++;
  }

  return { scanned: rows.length, escalated, at: now.toISOString() };
}
