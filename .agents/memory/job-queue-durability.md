---
name: Background job queue durability
description: How stranded "running" jobs are recovered and why terminal writes must be ownership-guarded — the mechanism behind packages stuck in "AI Review".
---

# Background job queue durability

The in-process durable job worker (poll loop + Postgres `jobs` table) backs
package analysis. A package sits in the **"AI Review" holding state** while its
`package.analysis` job is `pending`/`running`; the job's terminal exit (or the
handler's own perm-fail path) releases the package back to "Needs Review". If a
job is left `running`, the package is stranded in "AI Review" and the "Re-run AI"
button is disabled + spinning with **no user recourse**.

## Rules

1. **Stale-job reclaim must run periodically, not only at startup.** A worker
   restart mid-analysis leaves the job `running`; recovering it only at the next
   boot means a stranded job (and the stuck spinner) can persist arbitrarily
   long. The worker requeues `running` jobs whose lock is older than the stale
   window on every poll tick.
   **Why:** a real report of "Re-run AI spins forever" traced to a job stranded
   across restarts, recovered only ~22 min later at the next boot.

2. **Heartbeat while a handler runs.** A long (reasoning-tier) analysis would
   otherwise look abandoned to the periodic reclaim and get double-run. The
   worker refreshes `lockedAt` (owner-scoped) on an interval; the stale window
   must be several heartbeats wide (currently 30s beat / 120s stale) so a live
   or another-instance job is never yanked. This also keeps reclaim multi-instance
   (scale-out) safe.

3. **Terminal writes MUST be ownership-guarded.** `markJobCompleted` /
   `markJobFailed` update only while the row is still `running` AND `lockedBy`
   the current worker, returning whether the write landed. After a reclaim hands
   the job to another worker, a slow/stalled original worker finishing late will
   match 0 rows and must skip (log "lost ownership") instead of clobbering the
   new owner's result (split-brain).
   **Why:** making reclaim periodic increases the window where two workers can
   both finish the same job; without the guard, last-writer-wins corrupts state.

**How to apply:** any change to reclaim timing, heartbeat cadence, or the
terminal-write functions must preserve all three invariants together — they are
interdependent. Handler side effects (e.g. `applyAnalysis`) are NOT yet fully
idempotent across a double-run; the job-row guard limits but does not eliminate
that, so keep the stale window comfortably larger than real job duration.
