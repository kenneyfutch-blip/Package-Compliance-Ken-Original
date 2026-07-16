# Backup & Restore Runbook — Packaging Compliance AI

Last updated: 2026-07-16

## What state exists, and where

| Data | Where it lives | Loss impact |
| --- | --- | --- |
| Application data (packages, findings, reviews, users, jobs, audit) | Replit PostgreSQL (separate **development** and **production** databases) | Critical |
| Cold audit history | Same Postgres, `archive` schema (yearly partitions of `audit_events`) | High (compliance trail) |
| Uploaded artwork / SOP / policy files | Replit App (object) Storage bucket, private dir | Critical (files are referenced by DB rows) |
| Secrets & config | Replit Secrets (workspace + deployment) | Recoverable by re-entering |
| Code | Git history + Replit checkpoints | Recoverable |

Key invariant: **DB rows and object-storage files reference each other.** Restoring one without the other leaves dead links — always treat them as a pair when restoring to a point in time.

## Backups

### Automatic (platform)
- **Checkpoints**: Replit snapshots code **and the development database** at every agent checkpoint. Rolling back a checkpoint restores both. Production DB is NOT part of checkpoints.
- **Production Postgres**: managed by Replit/Neon with point-in-time recovery on the underlying branch. For explicit restore points, take manual dumps (below) before risky changes.

### Manual dump (recommended before schema pushes and bulk deletes)
Run from the workspace shell:

```bash
# Development DB
pg_dump "$DATABASE_URL" --format=custom --file="backup-dev-$(date +%Y%m%d-%H%M).dump"

# Include the audit archive schema explicitly if you filter schemas:
pg_dump "$DATABASE_URL" -n public -n archive --format=custom --file=...
```

For the **production** DB, get its connection string from the deployment's database pane (never hardcode it), and run the same `pg_dump` against it.

Object storage: files are immutable after upload (new versions create new objects), so a periodic sync to a second bucket/local archive is sufficient:

```bash
# List + download via the storage tooling or a small script using the
# object-storage client; keep the same key paths so DB references stay valid.
```

## Restore procedures

### 1. Bad code deploy / broken app, data fine
Roll back via Replit checkpoints (code) and republish. No DB action.

### 2. Development DB damaged (bad push, mass delete)
1. Prefer a checkpoint rollback (restores dev DB + code together).
2. Else restore the latest manual dump:
   ```bash
   pg_restore --clean --if-exists -d "$DATABASE_URL" backup-dev-....dump
   ```
3. Else re-seed: `seed` (reference data, idempotent, prod-safe) and, dev-only, the demo seed. This rebuilds baseline data but NOT user-generated content.

### 3. Production DB damaged
1. Stop writes: temporarily unpublish or scale the deployment down.
2. Restore from the most recent manual dump with `pg_restore` against the production connection string, or contact Replit support for point-in-time recovery of the managed database.
3. Verify referential pairs: spot-check that `packages` artwork paths resolve in object storage (`GET /packages/:id` → file download).
4. Re-run the app; the startup pass re-creates required indexes/partitions idempotently (`ensure*Indexes`, audit archive provisioning, jobs indexes).

### 4. Single package deleted by mistake
Deletion is a **soft delete with a 30-day window**. An admin can restore it in-app (trash) or via `POST /api/packages/:id/restore` (requires `packages:delete`). After 30 days the nightly maintenance purge hard-deletes it — no restore path except a DB dump.

### 5. Audit history queries missing old rows
Old audit rows live in the `archive` schema (yearly partitions), not `public.audit_events`. They are dropped only by the retention policy (whole-year partitions). If a partition was dropped by mistake, restore only that table from a dump: `pg_restore -t 'archive.audit_events_<year>' ...`.

## Known sharp edges (read before touching the schema)
- `drizzle-kit push` can **drop and recreate tables** (cascade-wiping dependents) when it can't reconcile a change. Take a manual dump first; prefer additive `ALTER ... IF NOT EXISTS` applied at runtime for hot tables.
- The `archive` schema is invisible to drizzle push (by design) — never let a "cleanup" remove schemas it doesn't recognize.
- Restores must keep dev/prod separated: never point a restore of one environment's dump at the other's DB without intending a full clone.

## Verification checklist after any restore
- [ ] `/api/healthz/deep` returns `{ status: "ok", db: "up" }`
- [ ] Log in, open a package, download its artwork (DB ↔ storage pair intact)
- [ ] Jobs table draining (`/api/ops/system/health` worker section)
- [ ] Audit endpoint shows both hot and archived history for an old package
- [ ] Row counts of `packages`, `users`, `violations` match expectations
