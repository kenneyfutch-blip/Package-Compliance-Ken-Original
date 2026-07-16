---
name: Package soft-delete & recovery window
description: How package deletion works now — trash, restore, 30-day purge — and the invariants to preserve.
---

DELETE /packages/:id no longer hard-deletes. It sets `packages.deletedAt` and tears down only the LIVE operational rows (notifications+states, review assignments/tasks/locks/presence/history/metrics) so no dead "Open review" links remain; the analytical record (versions, violations, findings, analyses, memory, reports, approval decisions, annotations, supplier_submissions link) is preserved for restore. Daily maintenance hard-purges rows trashed > 30 days via the full old 18-table cascade (shared in the api-server packages/purge lib).

Invariants:
- `packageConds` and `canAccessPackage` both exclude soft-deleted rows — every normal read path hides trash. The trash/restore endpoints (`GET /packages/trash`, `POST /packages/:id/restore`, gated `packages:delete`, org-scoped) deliberately bypass these helpers.
- Purge must re-check eligibility INSIDE the transaction with `SELECT ... FOR UPDATE` (deletedAt not null AND < cutoff) — a snapshot-then-loop purge can hard-delete a package restored mid-loop (TOCTOU; caught in review).
- Authz tests assert packageConds predicate COUNTS: baseline is now 2 (org + hide-soft-deleted), supplier 3. Adding another scope predicate means updating those counts in three test files.
- Column was applied via idempotent runtime `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (ensure fn runs before each purge), NOT drizzle push — push is risky here (see schema-push-data-loss). Schema file remains source of truth; rebuilding lib/db dist is required for the type to propagate (composite refs).
