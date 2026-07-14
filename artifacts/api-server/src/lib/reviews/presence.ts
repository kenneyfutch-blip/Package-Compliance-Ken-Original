import {
  db,
  reviewerPresenceTable,
  reviewLocksTable,
  usersTable,
  packagesTable,
} from "@workspace/db";
import { and, eq, gte, lt } from "drizzle-orm";

// -----------------------------------------------------------------------------
// Live reviewer presence + advisory review locking.
//
// Both presence and locks are ephemeral live state kept fresh by a client
// heartbeat. Correctness is enforced at READ time by staleness thresholds (a
// client that stops beating simply ages out); a periodic sweep only prunes the
// stale rows so the tables don't grow unbounded.
// -----------------------------------------------------------------------------

// Client-reported activity states. "offline" and "idle" are derived from
// staleness at read time and never stored.
export const REPORTABLE_PRESENCE_STATES = [
  "online",
  "reviewing",
  "approving",
  "commenting",
  "idle",
] as const;
export type PresenceState =
  | (typeof REPORTABLE_PRESENCE_STATES)[number]
  | "offline";

// A presence heartbeat older than this reads as "idle"; older than the offline
// threshold it disappears entirely (treated as offline / logged out).
export const PRESENCE_IDLE_MS = 90_000; // 1.5 min
export const PRESENCE_OFFLINE_MS = 5 * 60_000; // 5 min

// A review lock whose heartbeat is older than this is considered abandoned and
// is available to be taken over (and is pruned by the sweep).
export const LOCK_TTL_MS = 2 * 60_000; // 2 min

// Recurring housekeeping sweep that prunes aged-out presence + locks.
export const PRESENCE_SWEEP_TYPE = "presence.sweep";
export const PRESENCE_SWEEP_INTERVAL_MS = 60_000; // 1 min

function isReportableState(s: string): s is (typeof REPORTABLE_PRESENCE_STATES)[number] {
  return (REPORTABLE_PRESENCE_STATES as readonly string[]).includes(s);
}

// Resolve the effective, displayable presence state from what the client last
// reported and how long ago it beat.
function effectivePresenceState(
  reported: string,
  lastSeen: Date,
  now: Date,
): PresenceState {
  const age = now.getTime() - new Date(lastSeen).getTime();
  if (age >= PRESENCE_OFFLINE_MS) return "offline";
  if (age >= PRESENCE_IDLE_MS) return "idle";
  return isReportableState(reported) ? reported : "online";
}

export interface PresenceDTO {
  userId: number;
  name: string;
  role: string;
  imageUrl: string | null;
  state: PresenceState;
  packageId: number | null;
  packageName: string | null;
  lastSeenAt: string;
}

export interface ReviewLockDTO {
  packageId: number;
  packageName: string | null;
  userId: number;
  userName: string | null;
  startedAt: string;
  lastHeartbeatAt: string;
}

// Upsert the caller's presence (one row per user). Records the reported activity
// state, the package they are focused on (if any), and refreshes lastSeenAt.
export async function heartbeatPresence(p: {
  organizationId: number;
  userId: number;
  state: string;
  packageId?: number | null;
}): Promise<void> {
  const state = isReportableState(p.state) ? p.state : "online";
  const now = new Date();
  await db
    .insert(reviewerPresenceTable)
    .values({
      organizationId: p.organizationId,
      userId: p.userId,
      state,
      packageId: p.packageId ?? null,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: reviewerPresenceTable.userId,
      set: {
        organizationId: p.organizationId,
        state,
        packageId: p.packageId ?? null,
        lastSeenAt: now,
      },
    });
}

// Current (non-offline) presence for everyone in the organization, with the
// reviewer's name/role and any package they are focused on.
export async function getPresence(
  organizationId: number,
  now: Date = new Date(),
): Promise<PresenceDTO[]> {
  const cutoff = new Date(now.getTime() - PRESENCE_OFFLINE_MS);
  const rows = await db
    .select({
      userId: reviewerPresenceTable.userId,
      state: reviewerPresenceTable.state,
      packageId: reviewerPresenceTable.packageId,
      lastSeenAt: reviewerPresenceTable.lastSeenAt,
      name: usersTable.name,
      role: usersTable.role,
      imageUrl: usersTable.imageUrl,
      packageName: packagesTable.name,
    })
    .from(reviewerPresenceTable)
    .innerJoin(usersTable, eq(reviewerPresenceTable.userId, usersTable.id))
    .leftJoin(packagesTable, eq(reviewerPresenceTable.packageId, packagesTable.id))
    .where(
      and(
        eq(reviewerPresenceTable.organizationId, organizationId),
        gte(reviewerPresenceTable.lastSeenAt, cutoff),
      ),
    );
  return rows
    .map((r) => ({
      userId: r.userId,
      name: r.name,
      role: r.role,
      imageUrl: r.imageUrl ?? null,
      state: effectivePresenceState(r.state, r.lastSeenAt, now),
      packageId: r.packageId,
      packageName: r.packageName ?? null,
      lastSeenAt: new Date(r.lastSeenAt).toISOString(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mapLockRow(r: {
  packageId: number;
  userId: number;
  startedAt: Date;
  lastHeartbeatAt: Date;
  userName: string | null;
  packageName: string | null;
}): ReviewLockDTO {
  return {
    packageId: r.packageId,
    packageName: r.packageName ?? null,
    userId: r.userId,
    userName: r.userName ?? null,
    startedAt: new Date(r.startedAt).toISOString(),
    lastHeartbeatAt: new Date(r.lastHeartbeatAt).toISOString(),
  };
}

// All active (non-expired) review locks in the organization.
export async function getLocks(
  organizationId: number,
  now: Date = new Date(),
): Promise<ReviewLockDTO[]> {
  const cutoff = new Date(now.getTime() - LOCK_TTL_MS);
  const rows = await db
    .select({
      packageId: reviewLocksTable.packageId,
      userId: reviewLocksTable.userId,
      startedAt: reviewLocksTable.startedAt,
      lastHeartbeatAt: reviewLocksTable.lastHeartbeatAt,
      userName: usersTable.name,
      packageName: packagesTable.name,
    })
    .from(reviewLocksTable)
    .leftJoin(usersTable, eq(reviewLocksTable.userId, usersTable.id))
    .leftJoin(packagesTable, eq(reviewLocksTable.packageId, packagesTable.id))
    .where(
      and(
        eq(reviewLocksTable.organizationId, organizationId),
        gte(reviewLocksTable.lastHeartbeatAt, cutoff),
      ),
    );
  return rows.map(mapLockRow);
}

export interface AcquireLockResult {
  // Whether the caller now holds the lock.
  acquired: boolean;
  // Whether the lock is actively held by someone else (duplicate-work warning).
  heldByOther: boolean;
  // The current holder's lock (either the caller's, after acquiring, or the
  // other person's active lock when heldByOther).
  lock: ReviewLockDTO;
}

// Acquire or refresh the advisory lock on a package. If a live lock is held by
// another user, the caller does NOT take it over and heldByOther is true so the
// UI can warn about duplicate work. An expired lock (stale heartbeat) is taken
// over, resetting startedAt to now.
export async function acquireLock(p: {
  organizationId: number;
  packageId: number;
  userId: number;
}): Promise<AcquireLockResult> {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - LOCK_TTL_MS);

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(reviewLocksTable)
      .where(
        and(
          eq(reviewLocksTable.packageId, p.packageId),
          eq(reviewLocksTable.organizationId, p.organizationId),
        ),
      )
      .limit(1)
      .for("update");

    const existingLive =
      existing &&
      new Date(existing.lastHeartbeatAt).getTime() >= staleCutoff.getTime();

    // Someone else is actively working it — do not steal the lock.
    if (existingLive && existing!.userId !== p.userId) {
      return {
        acquired: false,
        heldByOther: true,
        row: existing!,
      };
    }

    if (existing) {
      // Refresh (same user) or take over an abandoned lock. Reset startedAt when
      // taking over from a different user or a previously expired session.
      const startedAt =
        existing.userId === p.userId && existingLive ? existing.startedAt : now;
      const [updated] = await tx
        .update(reviewLocksTable)
        .set({
          userId: p.userId,
          organizationId: p.organizationId,
          startedAt,
          lastHeartbeatAt: now,
        })
        .where(eq(reviewLocksTable.id, existing.id))
        .returning();
      return { acquired: true, heldByOther: false, row: updated! };
    }

    const [inserted] = await tx
      .insert(reviewLocksTable)
      .values({
        organizationId: p.organizationId,
        packageId: p.packageId,
        userId: p.userId,
        startedAt: now,
        lastHeartbeatAt: now,
      })
      .returning();
    return { acquired: true, heldByOther: false, row: inserted! };
  });

  // Resolve display names for the current holder + package.
  const [holder] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, result.row.userId))
    .limit(1);
  const [pkg] = await db
    .select({ name: packagesTable.name })
    .from(packagesTable)
    .where(eq(packagesTable.id, result.row.packageId))
    .limit(1);

  return {
    acquired: result.acquired,
    heldByOther: result.heldByOther,
    lock: mapLockRow({
      packageId: result.row.packageId,
      userId: result.row.userId,
      startedAt: result.row.startedAt,
      lastHeartbeatAt: result.row.lastHeartbeatAt,
      userName: holder?.name ?? null,
      packageName: pkg?.name ?? null,
    }),
  };
}

// Release the caller's lock on a package. Only the holder may release it, so a
// stale/other lock is left untouched.
export async function releaseLock(p: {
  organizationId: number;
  packageId: number;
  userId: number;
}): Promise<void> {
  await db
    .delete(reviewLocksTable)
    .where(
      and(
        eq(reviewLocksTable.organizationId, p.organizationId),
        eq(reviewLocksTable.packageId, p.packageId),
        eq(reviewLocksTable.userId, p.userId),
      ),
    );
}

// Housekeeping: delete aged-out presence rows and expired locks. Read paths are
// already staleness-guarded, so this only bounds table growth.
export async function sweepPresenceAndLocks(): Promise<Record<string, unknown>> {
  const now = new Date();
  const presenceCutoff = new Date(now.getTime() - PRESENCE_OFFLINE_MS);
  const lockCutoff = new Date(now.getTime() - LOCK_TTL_MS);

  const prunedPresence = await db
    .delete(reviewerPresenceTable)
    .where(lt(reviewerPresenceTable.lastSeenAt, presenceCutoff))
    .returning({ id: reviewerPresenceTable.id });
  const prunedLocks = await db
    .delete(reviewLocksTable)
    .where(lt(reviewLocksTable.lastHeartbeatAt, lockCutoff))
    .returning({ id: reviewLocksTable.id });

  return {
    prunedPresence: prunedPresence.length,
    prunedLocks: prunedLocks.length,
    at: now.toISOString(),
  };
}
