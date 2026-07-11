---
name: Supplier Architecture & Access Control
description: Supplier domain model (contacts, submissions, scorecards, lifecycle) and the strict supplier_user isolation rules.
---

# Supplier Architecture & Access Control

Extends a flat suppliers table into a full domain: `supplier_contacts`,
`supplier_submissions`, `supplier_scorecards`, `supplier_status_history`, plus a
`status` lifecycle (Prospective|Active|Suspended|Offboarded) and reserved
external master-data linkage fields (`externalSource`/`externalId`/
`externalSyncedAt`) — linkage only, no external CIA sync is built.

## Isolation rule (critical)
**Rule:** every supplier/submission read AND write must apply org scoping, and
for `roleKey === "supplier_user"` an additional own-supplier predicate.
- Supplier reads go through `supplierConds(req)`; submission reads through
  `submissionConds(req)` — both append `eq(..., ctx.supplierId ?? -1)` for
  supplier users. The `?? -1` guarantees an unlinked supplier user matches
  nothing rather than everything.
- On POST submission, a supplier user's target `supplierId` is forced to
  `ctx.supplierId`; the client-supplied `supplierId` is ignored (anti-spoof).
  Internal roles may pass `supplierId` in the body.
- `submissions:review` is the review gate; supplier_user does NOT have it, so
  external users can never record review decisions.

**Why:** supplier users are external; leaking another supplier's submissions,
feedback, scorecards, or status is the core risk of this feature.
**How to apply:** when adding any new supplier-scoped query/mutation, reuse the
existing `*Conds` helpers — do not hand-roll org-only filters.

## Other conventions
- Submission + its spawned package are inserted in one `db.transaction` so a
  submission never exists without its linked package.
- Latest scorecard's `overallScore` is mirrored onto `suppliers.complianceScore`
  for fast list rendering.
- Status transitions and submission reviews are value-validated but NOT
  state-machine constrained (any allowed target from any state) — deferred.

## Package↔supplier linkage is by ID, not vendor name (critical)
- `packages.supplierId` and `compliance_memory.supplierId` are the authoritative
  FK to the master supplier record. `vendor` text is kept for **display only** and
  can drift (rename); never scope/join on it. Both columns are nullable + were
  added push-safe with a boot-time backfill (`lib/suppliers/link.ts`).
- **Deny-by-default row checks (do not regress):** for `supplier_user`,
  `canAccessPackage`/`canAccessObjectOwner` must require `ctx.supplierId != null
  && row.supplierId === ctx.supplierId`. A bare `!==` is a leak because
  `null !== null` is false → an unlinked supplier would reach null-linked rows.
  List paths use `eq(..., ctx.supplierId ?? -1)` which is already deny-safe.
- **Why no UNIQUE(org,name) on suppliers:** duplicate supplier rows may already
  exist, so adding the constraint would make `drizzle-kit push` fail. Instead
  `resolveSupplierId` and the backfill find-or-create deterministically via
  `ORDER BY id ASC LIMIT 1`, so linking is stable even with dupes. A rare race
  can create a dup supplier, but the asc(id) pick keeps identity consistent.
- Backfill only touches `supplier_id IS NULL` rows → idempotent, safe on every
  boot, non-fatal. Memory rows link from their source package first, then by
  (org, vendor). Create paths (packages.ts, supplier-submissions.ts) set it
  directly (submissions use the submission's own `supplier.id`).
