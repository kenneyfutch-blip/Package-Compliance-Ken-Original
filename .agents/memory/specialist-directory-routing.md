---
name: Specialist Directory & Routing Engine
description: Directory of reviewer expertise + routing/escalation/stage config; org-scoping, cross-entity FK validation, preview evaluator, and seed placement rules.
---

# Specialist Directory & Routing Engine

Infrastructure layer (not the AI agent itself) for reviewer expertise, approval
authority, routing rules, escalation matrix, review stages, and live workload.
Six org-scoped modules on existing infra (users, teams, review_assignments, RBAC,
audit). New perms: `specialists:read/write`, `routing:read/write`. Specialists are
directory-only profiles with a nullable `userId` (seeded names differ from demo
Clerk login users); workload is computed live from active review_assignments.

## Cross-entity FK references must be org-validated on write
These entities use **global serial IDs, not composite org FKs**, so a write
handler that accepts a referenced foreign ID (department/specialist/stage/team/
user) must confirm it belongs to the caller's org before persisting — otherwise a
caller who guesses an ID stitches in another tenant's row (silent tenant leak).
Shared guards live in `artifacts/api-server/src/lib/orgRefs.ts`
(`departmentInOrg`, `specialistInOrg`, `reviewStageInOrg`, `teamInOrg`,
`userInOrg`); null/undefined is always allowed (clears the link).
**Why:** primary-row org scoping alone does NOT protect referenced FKs.
**How to apply:** any new mutation that stores a foreign ID on these tables must
call the matching guard and 400 on failure. Add a guard when introducing a new
referenced table.

## Routing preview: empty conditions = catch-all (matches)
In the routing-rules preview evaluator, a rule with **zero conditions is an
unconditional catch-all** and must match (used for the default/fallback rule at
the lowest priority). Conditions are ANDed; a conditioned rule matches only when
all pass. Do NOT gate matching on `conditions.length > 0` — that made the seeded
priority-100 default rule unable to ever win. First match wins in priority order.

## Org-scoped feature defaults belong in seedDemo, not seedReference
`seedReference` runs with **no organization context**, so org-scoped tables
(departments, specialists, review_stages, routing/escalation rules) cannot be
seeded there — all their demo rows go in `seedDemo` (dev-only, scoped to the demo
org). Permissions are the exception: they're derived from code
(`PERMISSIONS`/`permissionsForRole`), so new grants apply automatically via
`seedReference` with no data seeding needed.

## clearDemo must clear non-cascade org-FK tables before deleting the org
`clearDemo` deletes `organizations`, but a few tables have a **non-cascade org
FK** and will raise a FK violation if not cleared first. Confirmed set via
`information_schema`: `ai_usage`, `audit_events`, `users`. Delete those (at least
`ai_usage`; the other two are already cleared elsewhere) before the org delete.
**How to apply:** when adding a table with an org FK, decide cascade vs not; if
non-cascade, add it to clearDemo's pre-org delete list.
