---
name: Package duplicate prevention
description: Why packages allow duplicate SKU/UPC at the DB level and how the soft guard + client warning work.
---

# Package duplicate prevention

Packages are protected against *accidental* duplicate creation without a hard uniqueness constraint.

## The rule
- `packages.sku` / `packages.upc` are intentionally **NOT unique** in the DB schema. Do not add a unique constraint without an explicit user decision + a pre-check for existing duplicate rows (drizzle push can drop/recreate and cascade-wipe — see schema-push-data-loss.md).
- **Why:** legitimate reasons exist to have two records with the same SKU/UPC (re-review of a repackaged product, multiple suppliers, historical versions), and a single-org deployment shouldn't hard-block them. Prevention is a *soft guard*, not a database invariant.

## How it works (three layers)
1. **Lookup endpoint** `GET /packages/duplicates?sku&upc` — returns existing matches (SKU case-insensitive, UPC exact), scoped with `packageConds(req)` so it never leaks cross-org / cross-supplier rows.
2. **Server guard** in `POST /packages` — if a duplicate exists and the body does not set `allowDuplicate:true`, it returns **409** with the colliding packages. This protects API/bulk callers, not just the upload form.
3. **Client (upload form)** — debounced proactive check shows a warning banner; the submit button becomes "Upload Anyway" which sends `allowDuplicate:true`; a 409 backstop surfaces server-detected matches.

## Non-obvious gotcha (fixed once, keep it)
- The client must only send `allowDuplicate:true` when the identifiers the duplicate check ran against **exactly match** the identifiers being submitted (trimmed). Deriving the override purely from the debounced result lets a user edit SKU/UPC and submit within the debounce window, sending a *stale* `allowDuplicate:true` that bypasses the server guard for the new values.
- **How to apply:** any "confirm/override" flow driven by a debounced query must gate the override on exact-equality between the checked inputs and the submitted inputs; otherwise the server-side re-check (409) must be allowed to run.
