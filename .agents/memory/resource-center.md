---
name: Resource Center hub & unified search
description: How the compliance Resource Center aggregates reference resources and where reserved sections/search types plug in.
---

# Resource Center (Resources nav group)

Specialist-facing hub that unifies every compliance reference behind one overview + one cross-resource search. Hub page + reserved section pages live under `artifacts/compliance/src/pages/resources/`; backend is `artifacts/api-server/src/routes/resources.ts` (`/resources/overview`, `/resources/search`).

## Non-obvious decisions
- **One table, two result types.** The `regulations` table backs BOTH external regulatory libraries AND the Internal SOP library — split by an agency regex `/internal|sop|dollar tree|brand/i` (kept in sync between the server route and `regulatory-library.tsx`). Search emits `regulation` vs `internal_sop` from the same rows.
- **Reserved search types are intentional no-ops.** `glossary` and `sop_document` are accepted in `/resources/search?types=` and appear as "Coming soon" groups, but return nothing until the follow-on features add their tables/queries. The wiring exists so those tasks only add their own data model + one query block — nav/routing must not be re-worked.
- **Recently-viewed / most-used is client-side by design.** Stored in `localStorage` via `src/lib/recent-resources.ts` (no DB table, no API) — resource views are a personal convenience surface. Views are recorded on click in the hub.
- **Permission gating.** Endpoints use `requireAnyPermission("regulations:read","policies:read")` then filter each source by `hasPermission`. Nav: `/resources` → `regulations:read` (broadly held, incl. suppliers); `/resources/sop` + `/resources/glossary` → `policies:read`.
- **Deep links = detail views.** Regulation results → `/regulatory/<agencyKey>?rule=<id>`; policy results → `/resources/policies?policy=<id>` (both scroll+highlight the target). The hub also honors `?return=&returnLabel=` to render a "Back to <work>" button so a reviewer can jump in and back out.
