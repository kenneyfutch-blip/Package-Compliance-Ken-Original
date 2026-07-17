---
name: Seed reference vs demo split
description: How the api-server seed is split into production-safe reference data vs dev-only demo data, and the go-live safety model.
---

# Seed lifecycle: reference vs demo

The api-server seed (`artifacts/api-server/src/seed.ts`) is split into two exported
functions plus a CLI dispatcher (`node dist/seed.mjs reference|demo|all`, built by
`seed-build.mjs`). Scripts: `seed` (= reference, the safe default), `seed:reference`,
`seed:demo`, `seed:all`.

- **`seedReference()`** — production-safe, idempotent, NEVER deletes. Loads only global
  config: permissions (onConflictDoNothing by unique key), roles (same), role_permissions
  (derived from code, onConflictDoNothing by composite PK), the federal regulations
  baseline (inserts only rules missing by `ruleCode`, leaves eCFR-synced rows alone), and
  the managed AI provider (only when none exists — respects the one-active unique index).
  Additive: if code defines more permissions than the DB has, it syncs them up.
- **`seedDemo()`** — the fictional "Dollar Tree" tenant and all its sample content.
  Calls `seedReference()` first (demo package AI analysis reasons against the regulations,
  which it reads back from the DB), then `clearDemo()`, then inserts the demo tenant.

**Why the split:** to keep production clean at go-live. Demo data must never enter a live
DB. Because all demo content is scoped to one org, and reference data is global, the two
concerns separate cleanly.

**Go-live safety model (defense in depth):**
- Default `pnpm seed` runs reference only — the common/accidental path is safe.
- `seedDemo()` hard-refuses unless `NODE_ENV` is explicitly `development|staging|test`;
  `production` AND unset both count as unsafe.
- Demo scripts use `NODE_ENV="${NODE_ENV:-development}"` so they respect an ambient
  `NODE_ENV=production` (block) but default to dev when unset (ergonomic). Never hardcode
  `NODE_ENV=development` in the script — that would override ambient prod and defeat the guard.

**`clearDemo()` caveat:** it does full-table deletes of tenant-scoped tables (preserving
reference tables), NOT per-org deletes. It can only run via `seedDemo()`, so it can never
touch production. But in a dev/staging env that holds a real (non-demo) org, running the
demo seed WILL wipe that org's data. Keep real data out of environments where you run the
demo seed.

**How to apply:** production go-live runs `seed:reference` only. Dev full reset = `seed:all`
or `seed:demo`. When adding a table that the demo seed writes to, also add it to `clearDemo()`
(the notification_states / notification_preferences overlay tables are already covered) or
reseeds accumulate stale rows / hit FK errors.

## FORCE_DEMO_RESEED wipes user-uploaded data too
The demo reseed guard exists because clearDemo() truncates ALL tenant tables — including packages the user uploaded themselves, not just seeded demo rows. **Why:** July 2026 incident — reseeding to rename demo users deleted the user's real uploaded packages; recovery required a checkpoint rollback. **How to apply:** never pass FORCE_DEMO_RESEED=1 without explicit user consent when the DB may hold user-created rows. To change seeded identities (users/specialists), prefer targeted SQL UPDATEs over a reseed. Also: clearDemo must delete ai/workspace child tables (workspace_action_proposals → ai_conversation_messages → ai_conversations) before organizations.
