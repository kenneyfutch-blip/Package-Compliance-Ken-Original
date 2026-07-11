---
name: openFDA integration
description: Non-obvious behaviors of the openFDA API and how the compliance app proxies it.
---

# openFDA integration

Server-side proxy powering the "FDA Recalls & Enforcement" feature. Key is server-only (`OPENFDA_API_KEY`), never sent to the browser; the frontend only calls our auth-gated `/api/fda/recalls` proxy.

## Non-obvious openFDA behaviors (external API — not discoverable from our code)
- **Zero matches returns HTTP 404** with `error.code = "NOT_FOUND"`, not an empty 200. Treat this as empty results, NOT an error, or every no-result search looks like a failure.
- **Dates are `YYYYMMDD` strings** (e.g. `20170726`) with no separators. Normalize to `YYYY-MM-DD` for display.
- **Enforcement (recall) datasets are per-category**: `food`, `drug`, `device` each have their own `/{category}/enforcement.json` endpoint. There is no single combined recalls endpoint.
- `meta.results.total` is the true total match count; `results` is only the current page (respect `limit`).

## Decisions
- `limit` is hard-capped 1..50 server-side regardless of client input.
- `search` phrase-matches across product_description / recalling_firm / reason_for_recall with OR.
- Missing key -> `FdaNotConfiguredError` -> 503 (distinct from 502 upstream failures) so the UI can show a "not configured" state vs a transient outage.
- Outbound host is fixed to `https://api.fda.gov`; category is allowlisted so user input can never influence host/path (SSRF-safe).

**Why:** these quirks (404-as-empty, YYYYMMDD dates, per-category endpoints) each caused or would cause visible bugs if handled naively.
