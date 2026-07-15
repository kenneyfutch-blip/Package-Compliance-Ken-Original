---
name: Route-level authz tests (bundled handler + mocked db)
description: How to unit-test an express route handler's tenant/permission scoping under the esbuild-bundled test harness, without a live DB.
---

# Testing an express route handler's scoping without a DB

The api-server test harness (`test.mjs`) bundles each `*.test.ts` with esbuild, so
you CANNOT mock imported modules via loaders, and direct function imports (e.g.
`listAssignments`) are inlined and not interceptable. But two seams work reliably:

- **`db` is a singleton object in the bundle.** `mock.method(db, "select", fake)`
  intercepts every query — including those inside helper functions like
  `listAssignments`, because they all funnel through `db.select`.
- **Provider objects are singletons too.** `getActiveAgentProvider()` returns the
  default `openAiAgentProvider`; `mock.method(openAiAgentProvider, "createSession", …)`
  keeps the dashboard's model-resolve call off the network.

**Invoke the real handler** by pulling it out of the Router stack instead of
starting an HTTP server: iterate `router.stack[i].route.stack[j]` and match
`.path` + `.method`, then `await handle(req, res, next)` with a `setAuthContext`-ed
fake req and a `res` stub capturing `.json()`.

**Assert the actual WHERE clause**, not just returned rows: the fake `db.select`
builder records the `.from(table)` identity and the `.where(cond)` SQL and resolves
to `[]` (it's a thenable returning an empty array). Render the recorded predicate
with `new PgDialect().sqlToQuery(cond)` → `{ sql, params }` and assert on column
tokens (`supplier_id`, `team_id`, `organization_id`, `user_id`) + bound param ids.

**Why:** the security guarantee lives in the WHERE predicate. A mocked db ignores
WHERE, so returned rows prove nothing — asserting the rendered predicate + params
proves supplier/team/org/user scoping reached the query. This is how
`workspace-dashboard.authz.test.ts` proves the dashboard never widens access.

**How to apply:** reuse this pattern for any route whose scoping is enforced by
query predicates (packageConds/opsTeamScope) rather than by a pure boolean helper
(those can be tested directly like storage.authz.test.ts's `canAccessObjectOwner`).
