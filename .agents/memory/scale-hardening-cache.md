---
name: Scale hardening — pagination & caching
description: Conventions for list pagination and the in-process AI/dashboard caches in the api-server.
---

# Scale hardening: pagination & caching

## Pagination convention
- `lib/pagination.ts` is the single source: `DEFAULT_LIMIT=200`, `MAX_LIMIT=500`, `parsePagination(req)` → `{limit, offset}`.
- **Clamp, never reject** over-large `limit` (mirrors the `violations` reference endpoint). Over-cap requests are capped, not 400'd.
- List endpoints keep **bare-array** response shapes (no `{items,total}` envelope) — avoids OpenAPI/orval/frontend churn. `limit`/`offset` are optional query params only.
- **Why:** several list endpoints previously had silent hard caps (`.limit(300)`, `.limit(500)`) that dropped rows with no way to page past them; `listAssignments` was fully unbounded.
- **How to apply:** any new list endpoint should `parsePagination(req)` and apply `.limit(limit).offset(offset)`; add matching `limit`/`offset` params to its OpenAPI operation and re-run codegen.
- Gotcha: when adding pagination to an endpoint that filtered in JS after the query (e.g. `.filter(p => p.x != null)`), push the predicate into SQL (`isNotNull(...)` in WHERE) first, or offset/limit paginate the wrong (pre-filter) set.

## In-process caches (process-local by design, no external service)
- `lib/cache/ttl-cache.ts`: generic `createTtlCache<T>({ttlMs,maxEntries})` — TTL + LRU + **single-flight** (concurrent identical keys share one in-flight promise). **Only successes are cached**; a failed in-flight entry is removed so retries work.
- `lib/cache/ai-cache.ts` (`cachedAiCall`): 1h TTL. Key = `workload|org=<id>|v=<promptVersion>|m=<label>:<model>|sha256(system+\0+user)`. Org in key blocks cross-tenant leaks; per-workload `*_PROMPT_VERSION` constants invalidate on prompt edits; active model resolved via `resolveAiClientForTier("standard")` so engine swaps miss stale entries. Image OCR/field-extraction excluded (already content-hash cached elsewhere).
  - **Known gap:** the key captures only the *standard*-tier model identity. `analyzePackaging` can escalate to the reasoning tier via `runTiered`; if only a reasoning-tier provider/model is swapped, escalated outputs stay stale until the 1h TTL or a prompt-version bump. Bounded, non-severe. Fix = fold all potentially-used tier model identities into the key.
- `lib/cache/dashboard-cache.ts` (`cachedDashboard`): 30s TTL, key = `widget|org|role|supplier`. **Why role+supplier in key:** `supplier_user` sees a supplier-scoped view via `packageConds`; without those key parts a supplier's narrowed data could be served from an internal user's org-wide entry (or vice versa). Wraps all `routes/dashboard.ts` aggregates + the `dashboard/language-quality` widget in `routes/language.ts`.
- Both dashboard/AI caches are TTL-only (no explicit write invalidation), matching the FDA cache approach — short TTL bounds staleness.
