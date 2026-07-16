---
name: Graceful shutdown & health probes
description: api-server shutdown contract and the liveness-vs-deep health split; invariants to keep when touching the worker loop or health routes.
---

Shutdown contract (SIGTERM/SIGINT): stop scheduling background work, `server.close()` + close idle sockets, await BOTH the HTTP drain and the job-worker stop before `process.exit(0)`, bounded by a hard 15s deadline (unref'd) so a stuck socket can never wedge shutdown.

Invariants:
- The worker must track EVERY in-flight tick — poke-triggered ticks included, not just the polling loop's — in one shared set that shutdown awaits. A poke that runs `tick()` untracked reintroduces mid-write job kills (caught in review).
- `/api/healthz` stays a static 200 liveness check with NO dependencies — a DB-dependent liveness probe turns a DB hiccup into a restart loop. Deep readiness lives at `/api/healthz/deep` (DB ping raced vs short timeout → 200/503; worker recency is informational only, never gates status).
- Health probes on polled tables must be existence probes (`... LIMIT 1`) with a supporting index, never `count(*)`.

**Why:** review found exit was gated on worker stop alone (could cut in-flight HTTP) and pokes escaped the awaited set. Jobs queue also gets terminal-row retention pruning (30d, maintenance pass) + claim/reclaim/type-status/updated_at indexes so polling stays flat as volume grows.
