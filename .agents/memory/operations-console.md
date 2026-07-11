---
name: Operations Console
description: Admin/management UI (users, teams, roles, workload, audit, queue/health) and its org-scoping + lockout invariants.
---

# Operations Console

Management surface layered on RBAC + the assignment/workload engine + audit + the durable job queue. Backend routes: `users.ts` (GET/POST/PATCH /users, GET /roles), `teams.ts` (GET/POST/PATCH /teams + member add/remove), `ops.ts` (/ops/queue/metrics, /ops/system/health). Frontend pages under `artifacts/compliance/src/pages/operations/`.

## Non-obvious invariants

- **The `jobs` table is org-scoped** (it has an `organization_id` column). Any query that aggregates or reads jobs for display MUST filter `eq(jobsTable.organizationId, orgId(req))`, or one tenant sees another's queue volume, error text, and health signals.
  **Why:** an early version of `/ops/*` read jobs globally and leaked cross-org queue metadata — caught in review.
  **How to apply:** every new jobs read in a request handler composes the org predicate with `and(...)`.

- **Self-lockout guards on PATCH /users/:id:** a caller may not deactivate their own account AND may not change their own `roleKey`. Either path can strip the only admin of their permissions.
  **How to apply:** compare `existing.id === ctx.userId` before applying `active:false` or a differing `roleKey`.

- **Role/permission changes must call `invalidateAuthCache(clerkUserId)`** for the *target* user (auth context is cached ~5 min), or new permissions don't take effect until the cache expires. Skip when the user has no `clerkUserId` yet (invited-but-not-signed-in rows).

- **Invite = pre-created unlinked `users` row** (email + roleKey, `status:"invited"`, null clerkUserId). Provisioning adopts it by email on first sign-in. Enforce unique email at invite time.

- **Roles are code-defined** (`api-server/src/lib/rbac/permissions.ts`); the Role Management screen is read-only. `org:manage` is `platform_admin` only, so Queue & System Health gate on it; other ops screens gate on `users:read`/`teams:read`/`audit:read`. Supplier users hold none of these, so the whole Operations nav group auto-hides for them.
