---
name: Package delete cascade / orphan cleanup
description: Deleting a package must manually clean dependent rows — most package_id tables have no FK cascade, so they orphan into dead links.
---

# Package deletion orphans dependent rows

**Rule:** `DELETE /packages/:id` must clean up every dependent row it owns inside one
transaction before deleting the package. Only `document_extractions` and `proofs`
have real FK cascades to `packages`; **every other table with a `package_id` is a
plain column with no FK/cascade**, so a naive package delete silently orphans them.

**Why:** The delete handler originally removed only `violations` + the package row.
That left orphaned `notifications` whose "Open review" link pointed at a gone
package → the UI rendered "page does not exist"/"Package not found". It also
orphaned `review_assignments`, `review_tasks`, `annotations` (dozens–hundreds of
rows), etc. This is a data-integrity class bug, not a one-off.

**How to apply:**
- When you add ANY new table with a `package_id`, also add its cleanup to the
  package delete transaction, or it will orphan on delete.
- Delete child-before-parent where a table pair exists (`language_findings`
  before `language_reviews`, `claim_findings` before `claim_analyses`).
- `notification_states` links by `notification_id` (NOT `package_id`) and has no
  cascade — delete its rows for the package's notifications BEFORE deleting the
  notifications, or per-user read/archive state orphans.
- **Preserve `audit_events*`** (append-only compliance record; keep even though it
  references the deleted package).
- `supplier_submissions.package_id` is nullable and is a supplier-owned record —
  preserve the row but SET `package_id = NULL` so no supplier view renders a dead
  "open package" link.
- Defense-in-depth: the `GET /notifications` feed also LEFT JOINs `packages` and
  drops rows where `package_id` is set but the package is missing, so any orphan
  from any source never becomes a dead link.
