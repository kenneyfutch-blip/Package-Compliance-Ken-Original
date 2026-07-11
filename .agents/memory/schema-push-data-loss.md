---
name: Destructive schema push wiped demo data; seed is the restore path
description: Why packages/violations vanished after an FK-adding task, and how to restore.
---

# Schema push on a table with dependents can cascade-wipe rows

Symptom seen: after a task that added a `supplier_id` FK to `packages`, the app
went "mostly blank" — `packages` dropped to ~0, and its dependents
(`violations`, `package_versions`, review data) went to 0 too, while
independent tables (`suppliers`, `users`, `teams`, `regulations`,
`notifications`) were untouched. That asymmetry is the fingerprint of a
`drizzle-kit push` that recreated a table rather than altering it in place,
cascading deletes to child rows via FK.

**Why:** `drizzle-kit push` will silently drop/recreate a table for some schema
changes (notably certain column/constraint additions), destroying existing rows.
It does not warn like a reviewed migration would.

**How to apply:**
- Before/after any schema change to a table that holds demo or user data
  (especially adding FKs/constraints), check row counts before and after; if a
  table with dependents drops to ~0, suspect a destructive push, not app logic.
- Prefer additive, in-place migrations; treat `push` as capable of data loss.

## Restore path (full demo reset)
`artifacts/api-server/src/seed.ts` is a **standalone full-reset** script (not run
on boot): `clearAll()` truncates every table, then it recreates org, users,
teams, 5 suppliers, regulations, and 6 AI-analyzed packages (with violations).
It configures its own `ai_providers` row, so violations regenerate via the
Replit AI integration. Run it with: build `node seed-build.mjs` then
`node dist/seed.mjs` from `artifacts/api-server`.

**Gotcha:** AI analysis of the 6 packages takes ~1 min; a 4-min ShellExec can
time out and SIGKILL the process near the last package (leaving it "Uploaded",
unanalyzed) even though the rest committed. Run it backgrounded, or verify row
counts afterward rather than trusting the shell exit. Re-seeding deletes and
recreates users with new IDs; Clerk re-links by email on the next request, so
sign-in survives.
