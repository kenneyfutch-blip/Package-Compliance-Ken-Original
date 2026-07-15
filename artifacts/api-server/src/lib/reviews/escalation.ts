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

// The escalation ladder labels, keyed by level. Shared by the time-based sweep
// and the on-demand escalate action so both speak the same tier vocabulary.
export const ESCALATION_TIER_LABELS: Record<number, string> = {
  1: "Manager",
  2: "Director",
  3: "Leadership",
};
export const MAX_ESCALATION_LEVEL = 3;

export type EscalateNowResult =
  | { escalated: true; level: number; label: string }
  | { escalated: false; reason: "no_active_assignment" | "already_max" };

// On-demand, single-review escalation triggered by a user (e.g. via the AI
// Workspace with confirmation) rather than by the time-based sweep. Bumps the
// active assignment for a package up ONE tier, monotonically, and mirrors the
// sweep's side effects: status → Escalated, targeted notifications, and a
// review_history entry. The atomic monotonic guard means a concurrent sweep and
// a manual escalate can never double-apply the same tier.
export async function escalateReviewNow(p: {
  organizationId: number;
  packageId: number;
  actorUserId?: number | null;
  actorName: string;
  reason?: string | null;
}): Promise<EscalateNowResult> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [a] = await tx
      .select()
      .from(reviewAssignmentsTable)
      .where(
        and(
          eq(reviewAssignmentsTable.packageId, p.packageId),
          eq(reviewAssignmentsTable.organizationId, p.organizationId),
          inArray(reviewAssignmentsTable.status, ACTIVE_STATUSES),
        ),
      )
      .limit(1)
      .for("update");
    if (!a) return { escalated: false, reason: "no_active_assignment" };

    const nextLevel = a.escalationLevel + 1;
    if (nextLevel > MAX_ESCALATION_LEVEL)
      return { escalated: false, reason: "already_max" };
    const label = ESCALATION_TIER_LABELS[nextLevel] ?? `Level ${nextLevel}`;

    const [updated] = await tx
      .update(reviewAssignmentsTable)
      .set({
        escalationLevel: nextLevel,
        lastEscalatedAt: now,
        status: "Escalated",
      })
      .where(
        and(
          eq(reviewAssignmentsTable.id, a.id),
          lt(reviewAssignmentsTable.escalationLevel, nextLevel),
        ),
      )
      .returning({ id: reviewAssignmentsTable.id });
    if (!updated) return { escalated: false, reason: "already_max" };

    const [pkg] = await tx
      .select({ name: packagesTable.name })
      .from(packagesTable)
      .where(eq(packagesTable.id, p.packageId))
      .limit(1);
    const packageName = pkg?.name ?? `Package #${p.packageId}`;
    const title = `Review escalated to ${label}`;
    const message = `"${packageName}" was manually escalated to ${label} by ${p.actorName}.${
      p.reason ? ` Reason: ${p.reason}` : ""
    }`;

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
      actorUserId: p.actorUserId ?? null,
      actorName: p.actorName,
      escalationLevel: nextLevel,
      detail: p.reason
        ? `Manually escalated to ${label}: ${p.reason}`
        : `Manually escalated to ${label}`,
    });
    return { escalated: true, level: nextLevel, label };
  });
}

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
