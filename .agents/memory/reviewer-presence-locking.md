---
name: Reviewer Presence & Advisory Locking
description: Live reviewer presence + soft review locks — expiry-on-read design, why locks are advisory, and the client heartbeat/idle model.
---

# Reviewer Presence & Advisory Locking

Live "who's online / who's reviewing what" presence plus a soft lock warning that
a package review is already in progress.

## Core design decisions

- **Expiry-on-read is authoritative, the sweep is only housekeeping.** Presence
  and locks live in dedicated tables kept fresh by a client heartbeat. Read paths
  filter by staleness thresholds (presence: idle after ~90s, gone after ~5m;
  locks: TTL ~2m). A recurring `presence.sweep` job (same self-rescheduling
  pattern as the escalation sweep) only prunes aged rows to bound table growth —
  correctness never depends on it running.
  **Why:** locks are advisory, so a missed sweep must never leave a stale lock
  hard-blocking anyone; making reads staleness-aware means the DB is self-healing.

- **Locks are soft/advisory — they warn, never block.** Acquiring a lock held by
  a live *other* user returns `heldByOther: true` and does NOT steal it; an
  expired lock is taken over (startedAt reset). Release only deletes the caller's
  own row. There is no server-side write gate on the package — the UI just warns.
  **Why:** the task explicitly scoped this as advisory to avoid a parallel
  hard-status system on top of the existing assignment lifecycle.

- **"offline" and "idle" are derived, never stored.** The client reports
  online/reviewing/approving/commenting (and reports "idle" itself after ~60s of
  no pointer/keyboard activity, since a steady heartbeat would otherwise never
  look idle). The server maps staleness → idle/offline at read time.

- **Supplier users are fully excluded** from presence + locks (server:
  `blockSupplierUsers`; client: gated on `roleKey !== "supplier_user"`).
  **Why:** presence/lock lists are org-wide internal-staff data — a vendor must
  never enumerate staff or other vendors.

## How to apply

- Reuse existing perms: reads/writes gate on `packages:read`; every query is
  org-scoped via `orgId(req)`. Lock endpoints load the package through the same
  ownership check as other review routes before acting.
- Client heartbeat lives in a top-level `PresenceProvider` (inside
  PermissionProvider). Pages call `usePresence().setFocus(state, packageId)` to
  enrich presence; the review workspace uses `useReviewLock(packageId)` to
  acquire on mount / heartbeat on interval / release on unmount, and reads the
  live holder from the polled lock list (poll ~10s) rather than the acquire
  response so it reflects other reviewers too.
- Presence/lock DTOs are shaped directly in the engine lib (like reporting.ts),
  not via mappers.ts — names are joined in-query.
