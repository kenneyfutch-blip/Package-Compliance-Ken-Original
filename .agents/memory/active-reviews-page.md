---
name: Active Reviews page
description: What /packages/active must show and why it can't be a single package-status filter
---

# Active Reviews page (`/packages/active`)

"Active Reviews" = everything in the review pipeline right now, from TWO independent sources:
1. **AI-analyzing packages** — `package.status === "AI Review"` (via list-packages status filter).
2. **Packages under active specialist review** — assignments in `ACTIVE_STATUSES` = Assigned / InProgress / Escalated (via the review-assignments list endpoint).

**Why it can't be one filter:** an assigned package keeps its *own* status (e.g. "Needs Review", "Needs Revision"), NOT "AI Review". So a package-status filter alone silently omits every package a specialist is actively working. The page must union both sources.

**How to apply:**
- Assignment endpoint filters by a *single* status, so query the three active statuses separately and merge (each has a distinct react-query key — rules-of-hooks safe). Do NOT fetch all-statuses-unfiltered and client-filter: completed assignments would crowd active ones off the paginated result.
- The list endpoints cap at the server MAX_LIMIT (200). A "complete active view" page must request the max AND surface a capped notice if a bucket hits it — never silently drop rows.
- Handle query error explicitly. Without it, a failed fetch ends loading with empty arrays and renders a false "No active reviews" success state.
- Assignment data is already org- + package- + team-scoped server-side, so no extra tenancy guard is needed client-side.
