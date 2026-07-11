---
name: openFDA integration
description: Non-obvious behaviors of the openFDA API and how the compliance app proxies it.
---

# openFDA integration

Server-side proxy + intelligence layer. Key is server-only (`OPENFDA_API_KEY`), never sent to the browser; the frontend only calls our auth-gated `/api/fda/*` routes. Service layer lives in `artifacts/api-server/src/lib/fda/` (`client` = low-level fetch/cache, `datasets` = per-dataset queries, `router` = category→source mapping, `intelligence` = per-package aggregator). Routes: `/fda/recalls`, `/fda/intelligence?packageId=`, `/fda/status` (admin catalog + reachability).

## Non-obvious openFDA behaviors (external API — not discoverable from our code)
- **Zero matches returns HTTP 404** with `error.code = "NOT_FOUND"`, not an empty 200. Treat this as empty results, NOT an error, or every no-result search looks like a failure.
- **Dates are `YYYYMMDD` strings** (e.g. `20170726`) with no separators. Normalize to `YYYY-MM-DD` for display.
- **Enforcement (recall) datasets are per-category**: `food`, `drug`, `device` each have their own `/{category}/enforcement.json` endpoint. There is no single combined recalls endpoint.
- `meta.results.total` is the true total match count; `results` is only the current page (respect `limit`).
- **There is NO cosmetic dataset.** Cosmetic adverse events ride the FOOD CAERS endpoint (`/food/event.json`) filtered by `products.industry_name:"Cosmetics"`. Don't look for `/cosmetic/*`.
- `/food/event.json` (CAERS) covers foods, dietary supplements, AND cosmetics; use `count=reactions.exact` for a top-reactions facet and a separate `limit=1` call for the true total.
- `search` expressions must be pre-URL-encoded and appended raw (openFDA operators `+AND+`/`+OR+`/`:` must stay literal); only the phrase terms get `encodeURIComponent`.

## Decisions
- `limit` is hard-capped 1..50 server-side regardless of client input.
- `search` phrase-matches across product_description / recalling_firm / reason_for_recall with OR.
- Missing key -> `FdaNotConfiguredError` -> 503 (distinct from 502 upstream failures) so the UI can show a "not configured" state vs a transient outage.
- Outbound host is fixed to `https://api.fda.gov`; category is allowlisted so user input can never influence host/path (SSRF-safe).
- **Per-package "FDA Intelligence"** auto-detects category from package fields + OCR keywords (no manual dataset picking) and aggregates applicable datasets via `Promise.allSettled` so a single source outage degrades gracefully (`degraded`/`available`/`message` flags) — a review NEVER breaks on an FDA outage.
- **In-process response cache** (default 10min TTL, LRU-capped): cache key deliberately EXCLUDES `api_key`; success and 404/NOT_FOUND-empty are cached, but failures/`FdaUnavailableError` are NOT (a transient outage must not be pinned for the TTL).
- All openFDA fetches use an AbortController timeout (default 8s) so a slow upstream can't hang a request.

**Why:** these quirks (404-as-empty, YYYYMMDD dates, per-category endpoints, no cosmetic dataset, raw search encoding) each caused or would cause visible bugs if handled naively.
