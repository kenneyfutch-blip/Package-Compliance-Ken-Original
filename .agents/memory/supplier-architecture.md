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
- Packages still link to suppliers by `vendor` name string (legacy), not
  supplierId; submission-spawned packages set `vendor = supplier.name`.
