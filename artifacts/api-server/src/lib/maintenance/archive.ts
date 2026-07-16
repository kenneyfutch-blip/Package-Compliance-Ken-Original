import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger";
import { pruneStaleAiUsageWriteHealth } from "../ai-usage";
import { purgeExpiredPackages } from "../packages/purge";

// ---------------------------------------------------------------------------
// Scalability: partitioning + retention for the highest-volume time-series data.
//
// STRATEGY. The append-only audit trail is the fastest-growing table and, being
// immutable, cannot be pruned with ordinary DELETEs. We keep a small "hot" window
// of recent audit rows in public.audit_events (drizzle-managed, fully indexed)
// and roll everything older into a *yearly range-partitioned* archive that lives
// in a dedicated `archive` schema. Retention is then O(1): DROP an entire year
// partition instead of scanning/deleting rows. Full history stays queryable — the
// per-package audit endpoint unions the hot table with the archive.
//
// WHY a separate schema (not native partitioning of public.audit_events): the
// deploy pipeline runs `drizzle-kit push`, which introspects only the `public`
// schema and will try to DROP any table it doesn't know about (it refuses in a
// non-TTY, breaking the deploy). Partition child tables are exactly such unknown
// tables. Placing the partitioned archive in `archive` keeps it entirely outside
// drizzle's view, so push never touches it and the hot table stays push-managed.
//
// Violations are high-volume too but are read by packageId (well served by the
// packageId index) and are life-cycled with their package, so they need pruning
// of orphans rather than time-partitioning.
// ---------------------------------------------------------------------------

// Rows newer than this stay in the hot table; older rows roll into the archive.
const HOT_WINDOW_DAYS = 180;
// Archive partitions older than this many years are dropped. >5y history is kept.
const RETENTION_YEARS = 7;
// How many empty yearly partitions to pre-create on each side of "now".
const YEARS_BACK = 10;
const YEARS_FORWARD = 1;

const AUDIT_COLUMNS = [
  "id",
  "organization_id",
  "package_id",
  "entity_type",
  "entity_id",
  "actor",
  "actor_id",
  "action",
  "detail",
  "before",
  "after",
  "regulation_refs",
  "created_at",
].join(", ");

// Idempotently create the archive schema, the partitioned parent, its indexes,
// and a spread of yearly partitions plus a DEFAULT catch-all so an INSERT can
// never fail for an out-of-range timestamp.
export async function ensureArchiveInfrastructure(nowYear: number): Promise<void> {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS archive;`);
  // Mirror the live columns without copying the serial default (archived rows
  // carry their original id). Range-partition by the time dimension.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS archive.audit_events
    (LIKE public.audit_events INCLUDING COMMENTS)
    PARTITION BY RANGE (created_at);
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_arch_audit_org_created ON archive.audit_events (organization_id, created_at);`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_arch_audit_package ON archive.audit_events (package_id);`,
  );
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS archive.audit_events_default PARTITION OF archive.audit_events DEFAULT;`,
  );

  for (let y = nowYear - YEARS_BACK; y <= nowYear + YEARS_FORWARD; y++) {
    const start = `${y}-01-01`;
    const end = `${y + 1}-01-01`;
    const name = `audit_events_${y}`;
    await db.execute(
      sql.raw(
        `CREATE TABLE IF NOT EXISTS archive."${name}" PARTITION OF archive.audit_events FOR VALUES FROM ('${start}') TO ('${end}');`,
      ),
    );
  }
}

// Move audit rows older than the hot window into the archive, then drop archive
// partitions beyond the retention horizon. Runs in one transaction with the
// immutability trigger's governed-delete bypass enabled.
export async function runAuditArchival(now: Date): Promise<{
  moved: number;
  droppedPartitions: string[];
}> {
  const nowYear = now.getUTCFullYear();
  await ensureArchiveInfrastructure(nowYear);

  const cutoff = new Date(now.getTime() - HOT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();

  const moved = await db.transaction(async (tx) => {
    // Authorize the archival DELETE past the append-only trigger, for this
    // transaction only.
    await tx.execute(sql`SET LOCAL app.audit_archival = 'on';`);
    await tx.execute(
      sql.raw(
        `INSERT INTO archive.audit_events (${AUDIT_COLUMNS}) SELECT ${AUDIT_COLUMNS} FROM public.audit_events WHERE created_at < '${cutoffIso}' ON CONFLICT DO NOTHING;`,
      ),
    );
    const del = await tx.execute(
      sql`DELETE FROM public.audit_events WHERE created_at < ${cutoffIso};`,
    );
    return (del as unknown as { rowCount?: number }).rowCount ?? 0;
  });

  // Retention: drop whole year partitions older than the horizon.
  const dropBeforeYear = nowYear - RETENTION_YEARS;
  const droppedPartitions: string[] = [];
  for (let y = nowYear - YEARS_BACK - 5; y < dropBeforeYear; y++) {
    const name = `audit_events_${y}`;
    const existed = await db.execute(
      sql.raw(`SELECT to_regclass('archive.${name}') AS r;`),
    );
    const r = (existed as unknown as { rows: { r: string | null }[] }).rows?.[0]?.r;
    if (r) {
      await db.execute(sql.raw(`DROP TABLE IF EXISTS archive."${name}";`));
      droppedPartitions.push(name);
    }
  }

  return { moved, droppedPartitions };
}

// Safety-net pruning for violations: remove rows whose parent package no longer
// exists (defends against any path that deletes a package without its findings).
export async function runViolationRetention(): Promise<{ pruned: number }> {
  const res = await db.execute(sql`
    DELETE FROM violations v
    WHERE NOT EXISTS (SELECT 1 FROM packages p WHERE p.id = v.package_id);
  `);
  return { pruned: (res as unknown as { rowCount?: number }).rowCount ?? 0 };
}

// Read a package's archived audit rows so the audit endpoint can present full
// history. Returns [] if the archive is not yet provisioned.
export async function readArchivedAuditForPackage(
  organizationId: number,
  packageId: number,
): Promise<Record<string, unknown>[]> {
  try {
    const exists = await db.execute(
      sql`SELECT to_regclass('archive.audit_events') AS r;`,
    );
    const r = (exists as unknown as { rows: { r: string | null }[] }).rows?.[0]?.r;
    if (!r) return [];
    const result = await db.execute(sql`
      SELECT id, organization_id, package_id, entity_type, entity_id, actor,
             actor_id, action, detail, before, after, regulation_refs, created_at
      FROM archive.audit_events
      WHERE package_id = ${packageId} AND organization_id = ${organizationId}
      ORDER BY created_at DESC
    `);
    return (result as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
  } catch (err) {
    logger.error({ err }, "Failed to read archived audit");
    return [];
  }
}

let maintenanceTimer: NodeJS.Timeout | null = null;

// Run the full maintenance pass (archival + retention + orphan pruning) and log
// the outcome. Non-fatal: maintenance failures must not affect request serving.
export async function runMaintenance(now: Date): Promise<void> {
  try {
    const audit = await runAuditArchival(now);
    const violations = await runViolationRetention();
    const staleHealthRows = await pruneStaleAiUsageWriteHealth(now);
    const purgedPackages = await purgeExpiredPackages(now);
    logger.info(
      {
        auditMoved: audit.moved,
        droppedPartitions: audit.droppedPartitions,
        violationsPruned: violations.pruned,
        staleHealthRowsPruned: staleHealthRows,
        purgedPackages,
      },
      "Data maintenance pass complete",
    );
  } catch (err) {
    logger.error({ err }, "Data maintenance pass failed");
  }
}

// Schedule maintenance at startup and daily thereafter.
export function initMaintenance(): void {
  if (maintenanceTimer) return;
  void runMaintenance(new Date());
  maintenanceTimer = setInterval(
    () => void runMaintenance(new Date()),
    24 * 60 * 60 * 1000,
  );
  // Do not keep the event loop alive solely for maintenance.
  if (typeof maintenanceTimer.unref === "function") maintenanceTimer.unref();
}
