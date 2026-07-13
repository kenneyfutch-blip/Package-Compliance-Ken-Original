---
name: Tenancy, RBAC & Teams
description: How org-scoping, roles/permissions, Clerk provisioning, and append-only audit work in the Compliance AI backend + frontend.
---

# Tenancy, RBAC & Teams

The enterprise foundation for Packaging Compliance AI: every user belongs to an org + team with one of ten roles, routes enforce granular permissions, core records are org-scoped, and the audit log is append-only.

## Source of truth
- **Roles + permissions are defined in code**, not the DB: `artifacts/api-server/src/lib/rbac/permissions.ts` (26 permissions, 10 roles). The seed populates the `permissions`/`roles`/`role_permissions` tables *from* this file. If you change a role's grants, re-run the seed (or a targeted sync) or the DB drifts from code.
- `users.role` is the human display name; `users.roleKey` is the machine key. **Keep both in sync** — routes/permission logic read `roleKey`, UI shows `role`.

## Provisioning (Clerk -> DB)
- On first authenticated request `provisionUser` (in `rbac/provision.ts`) upserts the caller, resolves org + role, ensures team membership, and caches the `AuthContext` ~5 min.
- **Bootstrap rule:** first user in an org (or any email in `ADMIN_EMAILS`) becomes `platform_admin`, so the system is always administrable. Others default to `compliance_specialist` (`DEFAULT_ROLE_KEY`).
- Single default org `dollar-tree` (name "Dollar Tree"), auto-created on demand.
- Every user must belong to a team: provisioning adds users with no membership to a default "General" team (created on demand). Seed users get explicit teams.

## Scoping
- `rbac/scope.ts` `packageConds(req)` / `canAccessPackage` are the scoping primitives. **supplier_user sees only packages where `packages.supplierId === ctx.supplierId`** (by FK id, NOT vendor name — see supplier-architecture.md for the deny-by-default null rule). All package-derived reads (violations, dashboard, proofs) build from these.
- **Team-scoped ops data:** `AuthContext.teamIds` (from `team_members`, populated in `buildContext`) + `opsTeamScope(req)` in scope.ts gate workload/metrics/assignments to the caller's own teams. `opsTeamScope` returns null (no restriction) for org-wide roles (`platform_admin`, `compliance_director`, `executive_viewer`) and for `supplier_user` (handled by package scope instead); otherwise `{teamIds,userId}`. `reporting.ts` computeWorkload/computeMetrics take `teamIds:number[]|null` (null=org-wide); listAssignments takes a teamScope. `ops.ts` queue/health stays org-wide (already `org:manage`-gated).
- **Self-scoped reads still need org:** even "my own rows" queries (keyed by a globally-unique `userId`) should include `organizationId` in the predicate, not `userId` alone. **Why:** if a user's org affiliation ever changes, userId-only reads/deletes would surface their historical rows from the previous org — a cross-tenant leak. **How to apply:** `and(eq(table.organizationId, ctx.organizationId), eq(table.userId, ctx.userId), ...)` for every self-scoped select/delete.
- **Decision:** `regulations` and `ai_providers` are intentionally GLOBAL (not org-scoped) — permission-gated only. **Why:** regulations are a shared reference library and ai_providers is platform config (write is admin-only); acceptable in a single-org deployment. If the product ever goes true multi-tenant, these need org scoping.

## Audit immutability
- Append-only is enforced two ways: (1) app-side — there is **no** update/delete code path for `audit_events`; (2) a Postgres trigger installed at startup via `ensureAuditImmutability` (in `lib/audit.ts`). The seed's `clearAll` drops the trigger first (`dropAuditImmutability`) and reinstalls after.
- **Decision:** trigger install failure logs but does NOT fail server startup. **Why:** app-side no-mutation is the primary guarantee; the trigger is defense-in-depth. Don't make it fatal without weighing boot-availability tradeoffs.

## Frontend gating
- `artifacts/compliance/src/lib/access.tsx` `requiredPermFor(path)` is the single source mapping a route path -> required permission. **Both** nav filtering (`layout.tsx`) and route gating (`App.tsx`) consult it, so they never drift. Add new gated pages there, not in two places.
- **Mixed-permission pages:** `requiredPermFor` returns ONE perm, but a page (esp. admin/oversight dashboards) often calls several endpoints with *different* backend perms. Gate on the perm that, under the role matrix in `permissions.ts`, implies the rest — i.e. the narrowest/admin-tier perm held only by roles that also hold the others. **Why:** gating on a broad perm (e.g. `packages:read`) lets a lower role pass the route gate then hit 403s on admin-only calls (`users:read`/`teams:read`). **How to apply:** before choosing the gate, list every endpoint the page hits + its perm, then pick the one no role holds without the others (verify against `permissions.ts`); if no such perm exists, split the page or conditionally render sections by permission.

## Per-user permission overrides
- Admins with `users:write` can set per-user permission overrides (stored in `user_permissions`, merged over role baseline by `resolvePermissions`). The editor persists **minimal deltas vs the role baseline**, not the full effective set, so a later role change keeps only genuine deviations.
- **Ceiling rule (security):** the override PUT must reject any *newly granted* permission the caller does not themselves hold — otherwise `users:write` becomes a privilege-escalation vector (grant yourself a peer `org:manage`). Only police NEW grants (perm not already in the target's current effective set); preserving/removing an existing perm the caller lacks is fine (removal = de-escalation). **Why:** without a caller-authority ceiling, key-validation + org-scoping alone still let a lesser admin mint superiors. **How to apply:** compute target's current effective (role + existing overrides), reject `desired \ currentEffective \ caller.permissions` with 403.
- **Audit-must-match-persisted:** if any `ALL_PERMISSION_KEYS` lacks a DB `permissions` row mapping, fail hard (500) rather than silently filtering rows — otherwise the audit `after.overrides` claims deltas that were never written. Self-edit is blocked (self-lockout); `invalidateAuthCache` on the target after write.

## Object download ACL (resolved)
- `GET /storage/objects/*` now enforces per-object ACL: `resolveObjectOwner` maps the path back to its owning package/supplier record and `canAccessObjectOwner` applies org + supplier-id scoping before streaming (deny-by-default → 404 on unknown/out-of-scope). Owner descriptors carry `supplierId`, not vendor.

## Ops notes
- `tsx` is not installed. To run the seed: bundle with esbuild via `artifacts/api-server/seed-build.mjs` (mirrors `build.mjs`, externalizes pino) then `node dist/seed.mjs`. Do NOT use `esbuild-plugin-pino` for the seed bundle — externalize `pino`/`pino-pretty` instead.
- `drizzle-kit push` in this non-TTY env: its interactive truncate prompt fails even with `--force`; `TRUNCATE TABLE users CASCADE` first if it blocks.
- Seed AI analysis (managed `gpt-5.4`, multi-engine per package) is very slow — many minutes per package is normal here, not a hang. It runs after all RBAC rows are already committed, so a slow/failed analysis never blocks the tenancy/RBAC data.
