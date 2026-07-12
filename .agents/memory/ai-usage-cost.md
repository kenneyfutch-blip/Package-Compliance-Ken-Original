---
name: AI Usage Analytics & Cost Dashboard
description: How AI usage/cost is logged and surfaced; the non-blocking + identity-attribution invariants behind it.
---

# AI Usage Analytics & Cost Dashboard

Per-request AI telemetry ledger (`ai_usage` table) + admin analytics page `/admin/ai-usage` ("AI Cost & Usage", gated on `dashboard:read`, same as `/admin/usage`).

## Invariants (do not break)
- **Only REAL model calls are logged.** Logging lives inside cache-miss `compute` paths (`cachedAiCall`) and inside `runTiered`. Cache hits incur no tokens/cost and are intentionally NOT logged. If you add a new cached AI path, only the compute closure should log.
- **Logging must never break the AI response.** `recordAiUsage` is fire-and-forget (never awaited, swallows sync+async failures). `trackDirectUsage` wraps one non-tiered call: logs success/failure then RETHROWS the original error (preserves existing catch/fallback behavior). Never `await` a usage write in a way that can throw into the AI path.
- **Cost is a rate-card ESTIMATE, not billed spend.** Rates in `ai-usage.ts` MODEL_RATES (per-1M input/output). `real` columns. When a model is added/renamed, add its rate or it falls back to prefix-match then DEFAULT_RATE.

## Identity attribution
- Request org/user is threaded via **AsyncLocalStorage** (`runWithAiUsageContext`/`currentAiUsageIdentity`), set in `requireAuth` around `next()` for BOTH the loadtest and Clerk paths. This avoids adding an identity param to every AI function.
- Prefer passing `organizationId` EXPLICITLY when known from a domain object (e.g. `pkg.organizationId`) — it's authoritative; ALS is the fallback. Seed/unauthenticated calls still log telemetry with null org/user (columns are nullable by design).

## Read endpoints (`routes/usage.ts`)
- `/ai-usage/analytics` — composite aggregates (summary + day-filled timeseries + byModel/tier + byOperation), date-filtered (`from`/`to` YYYY-MM-DD, default last 30d, range clamped to 180d), wrapped in `cachedDashboard` with the date range baked into the widget key so ranges don't collide.
- `/ai-usage/requests` — paginated bare-array, newest-first, left-joins `users` for display name.
- `/ai-usage/export` — request-level CSV, same org scope/gate/date window; streams via `res.write` paging the DB in `EXPORT_PAGE_SIZE` batches (never buffers the whole ledger). NOT cached (`Cache-Control: no-store`).
- Both org-scoped (`eq(organizationId, orgId(req))`) and aggregate in SQL, not JS.

## CSV download client pattern (non-obvious)
- A `text/csv` GET declared in openapi makes orval emit a standalone `exportAiUsage(params)` returning `string` (customFetch `auto` infers text from the response content-type). Call it imperatively on click → `Blob` → anchor download. Do NOT wire the auto-fetching query hook for a download.

## Telemetry write-health signal
- `recordAiUsage` outcomes feed a process-local, in-memory health counter (successes/failures/consecutiveFailures/last*), reset on restart. Failures emit a **rate-limited** `logger.warn` (default level shows it; debug detail kept too). Never awaited — health tracking must stay off the AI path.
- `aiUsageWriteHealthSnapshot()` = THIS process's live counters (fallback + fresh overlay). `GET /ai-usage/health` (dashboard:read, uncached, NOT org-scoped) now returns `aiUsageWriteHealthFleet()`. Dashboard polls it, shows "under-reported" banner when `!healthy && failures>0`.
- **Fleet-wide (multi-instance):** each process heartbeats its counters into `ai_usage_write_health` (one row per `INSTANCE_ID`, drizzle-managed table) via `initAiUsageWriteHealthHeartbeat()` (unref'd 20s timer, started in index.ts listen cb). `aiUsageWriteHealthFleet()` sums successes/failures, takes **max** consecutiveFailures (`healthy = max===0`, so ANY failing instance turns the whole signal unhealthy), most-recent last*/message, `instanceCount`. Reads rows fresher than `INSTANCE_STALE_MS` (90s) and overlays the responding process's live snapshot. **Heartbeat is off the AI path — never add latency to AI writes.** Fleet read is fail-safe (falls back to local snapshot on DB error). `instanceCount` is a required field on `AiUsageHealth` (openapi).
- Stale/dead instance rows are only filtered by freshness, **not pruned** — table grows one row per process lifetime.

## Proactive admin alerting on telemetry failure
- Sustained write failures raise a **critical in-app notification** to admins (not just the warn log + dashboard banner), so an off-hours outage doesn't wait for someone to open the dashboard. Same fire-and-forget invariant as `recordAiUsage` — alerting must never block, slow, or throw into the AI path; all DB work is detached and fully guarded.
- **Once per incident, auto-dismiss on recovery** is the contract to preserve: exactly one notification per admin per outage, and a subsequent successful write must mark those notifications `read` (the notifications schema has no "resolve" state — read == dismissed).
- **Race to watch:** emission is async (admin lookup + insert), so a recovery can land while the emit is still in flight and the success-time resolve then no-ops. `writeHealth.consecutiveFailures` is the source of truth — reconcile at emit completion (0 ⇒ recovered ⇒ dismiss immediately). Any change here needs the "recovery during in-flight emit" test to keep passing.
- Admins are derived from the `ROLES` taxonomy (`users:write` or `*`), not hardcoded, so role edits are picked up automatically.
- Incident state is process-local/in-memory; multi-server dedup & fleet accuracy are owned by separate tasks — do not re-solve them here.

## Out-of-band alerting (webhook)
- `ai-usage-outband.ts` delivers the SAME incident to a configurable webhook (`AI_ALERT_WEBHOOK_URL`; `AI_ALERT_EMAIL_TO` = recipients named in the payload, not emailed — there is no SMTP transport). Unconfigured ⇒ no-op (Document-AI-style gate).
- **DB-independent on purpose.** The telemetry failure is usually the DB itself, so the in-app notification insert may fail. The webhook path never touches the DB, so it must fire even when the in-app emit fails. It therefore runs on its OWN incident state (`outbandActive`/`outbandInFlight`), decoupled from `alertActive`.
- **Why the decoupling matters:** the in-app emit deliberately retries on every failed write while the DB is down; if the webhook shared that gate it would spam on every retry. Its separate `outbandActive` gate makes it fire once per incident and resolve once on recovery regardless of DB state.
- Same fire-and-forget invariants as `maybeFireAlert`: never awaited by the AI path, detached+guarded, time-bounded (`AbortController`, 5s), failed send retries on next failed write. Mirror the "recovery during in-flight send" reconcile in the `finally`.

## Demo data
- Table starts empty (no committed seed step; seed.ts is a full-reset restore, not touched). Synthetic demo rows use `request_id LIKE 'seed-demo-%'` and are regenerated by delete-then-insert (idempotent). Not part of the app runtime.
