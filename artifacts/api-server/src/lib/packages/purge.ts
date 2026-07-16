import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import {
  db,
  packagesTable,
  packageVersionsTable,
  violationsTable,
  reportsTable,
  notificationsTable,
  notificationStatesTable,
  supplierSubmissionsTable,
  reviewAssignmentsTable,
  reviewTasksTable,
  reviewLocksTable,
  reviewerPresenceTable,
  reviewHistoryTable,
  reviewMetricsTable,
  annotationsTable,
  approvalDecisionsTable,
  languageFindingsTable,
  languageReviewsTable,
  claimFindingsTable,
  claimAnalysesTable,
  complianceMemoryTable,
} from "@workspace/db";
import { logger } from "../logger";

// How long a soft-deleted (trashed) package is recoverable before the daily
// maintenance pass hard-purges it. Chosen to give reviewers a comfortable
// window to notice and undo an accidental delete.
export const PACKAGE_RECOVERY_WINDOW_DAYS = 30;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Live/transient operational rows for a package. These drive lists, links and
// review workflow (notifications, assignments, tasks, locks, presence, history,
// metrics) and have no FK/cascade to packages. They are torn down on soft-delete
// so a trashed package leaves no dead "Open review" links or ghost assignments;
// the durable analytical record (versions, findings, analyses, memory, reports,
// approval decisions, annotations) is preserved for restore.
async function teardownLivePackageState(tx: Tx, id: number): Promise<void> {
  // Per-user notification state links by notificationId with no cascade; drop it
  // before the notifications it overlays.
  await tx.delete(notificationStatesTable).where(
    inArray(
      notificationStatesTable.notificationId,
      tx
        .select({ id: notificationsTable.id })
        .from(notificationsTable)
        .where(eq(notificationsTable.packageId, id)),
    ),
  );
  await tx.delete(notificationsTable).where(eq(notificationsTable.packageId, id));
  await tx.delete(reviewAssignmentsTable).where(eq(reviewAssignmentsTable.packageId, id));
  await tx.delete(reviewTasksTable).where(eq(reviewTasksTable.packageId, id));
  await tx.delete(reviewLocksTable).where(eq(reviewLocksTable.packageId, id));
  await tx.delete(reviewerPresenceTable).where(eq(reviewerPresenceTable.packageId, id));
  await tx.delete(reviewHistoryTable).where(eq(reviewHistoryTable.packageId, id));
  await tx.delete(reviewMetricsTable).where(eq(reviewMetricsTable.packageId, id));
}

// Full hard purge of a package and every dependent row. This DESTROYS the
// analytical record too, so it only runs after the recovery window elapses (or
// on an explicit permanent delete). audit_events are preserved as compliance
// history; supplier_submissions are preserved but unlinked so no view renders a
// dead "open package" link. Mirrors the historical inline delete cascade.
export async function purgePackageCascade(tx: Tx, id: number): Promise<void> {
  await teardownLivePackageState(tx, id);
  await tx
    .update(supplierSubmissionsTable)
    .set({ packageId: null })
    .where(eq(supplierSubmissionsTable.packageId, id));
  await tx.delete(annotationsTable).where(eq(annotationsTable.packageId, id));
  await tx.delete(approvalDecisionsTable).where(eq(approvalDecisionsTable.packageId, id));
  await tx.delete(languageFindingsTable).where(eq(languageFindingsTable.packageId, id));
  await tx.delete(languageReviewsTable).where(eq(languageReviewsTable.packageId, id));
  await tx.delete(claimFindingsTable).where(eq(claimFindingsTable.packageId, id));
  await tx.delete(claimAnalysesTable).where(eq(claimAnalysesTable.packageId, id));
  await tx.delete(complianceMemoryTable).where(eq(complianceMemoryTable.packageId, id));
  await tx.delete(reportsTable).where(eq(reportsTable.packageId, id));
  await tx.delete(packageVersionsTable).where(eq(packageVersionsTable.packageId, id));
  await tx.delete(violationsTable).where(eq(violationsTable.packageId, id));
  await tx.delete(packagesTable).where(eq(packagesTable.id, id));
}

// Soft-delete: mark the package as trashed and tear down its live operational
// state. The row and its analytical data remain, so a restore brings the record
// back intact (minus the regenerable review assignments). Returns false when the
// package does not exist or is already trashed.
export async function softDeletePackage(id: number, when: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(packagesTable)
      .set({ deletedAt: when })
      .where(and(eq(packagesTable.id, id), sql`${packagesTable.deletedAt} IS NULL`))
      .returning({ id: packagesTable.id });
    if (!updated) return false;
    await teardownLivePackageState(tx, id);
    return true;
  });
}

// Restore a trashed package back to live. Returns false when the id is not a
// currently-trashed package.
export async function restorePackage(id: number): Promise<boolean> {
  const [updated] = await db
    .update(packagesTable)
    .set({ deletedAt: null })
    .where(and(eq(packagesTable.id, id), isNotNull(packagesTable.deletedAt)))
    .returning({ id: packagesTable.id });
  return !!updated;
}

// Ensure the soft-delete column and its index exist. Idempotent and additive
// (no drizzle push), matching the runtime index-ensure pattern used elsewhere.
// Guarantees the column is present before any query references it.
export async function ensurePackageSoftDeleteColumn(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE packages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_packages_org_deleted ON packages (organization_id, deleted_at);`,
  );
}

// Hard-purge every package trashed longer ago than the recovery window. Runs in
// the daily maintenance pass. Non-fatal and per-package so one failure does not
// abort the rest. Returns the number of packages purged.
export async function purgeExpiredPackages(now: Date): Promise<number> {
  await ensurePackageSoftDeleteColumn();
  const cutoff = new Date(
    now.getTime() - PACKAGE_RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const expired = await db
    .select({ id: packagesTable.id })
    .from(packagesTable)
    .where(and(isNotNull(packagesTable.deletedAt), lt(packagesTable.deletedAt, cutoff)));
  let purged = 0;
  for (const { id } of expired) {
    try {
      // Re-check eligibility INSIDE the transaction under a row lock. A package
      // restored (deletedAt cleared) between the snapshot above and its turn in
      // the loop must NOT be purged — that would break the recovery guarantee.
      const didPurge = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ id: packagesTable.id })
          .from(packagesTable)
          .where(
            and(
              eq(packagesTable.id, id),
              isNotNull(packagesTable.deletedAt),
              lt(packagesTable.deletedAt, cutoff),
            ),
          )
          .for("update");
        if (!row) return false;
        await purgePackageCascade(tx, id);
        return true;
      });
      if (didPurge) purged += 1;
    } catch (err) {
      logger.error({ err, packageId: id }, "Failed to purge expired package");
    }
  }
  return purged;
}
