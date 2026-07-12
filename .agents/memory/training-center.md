---
name: Training Center / Knowledge Base
description: In-app Training & Help hub (10 pages) — content model, progress, live tours, support tickets, and the access decisions behind them.
---

# Training Center

An in-platform learning hub for the Packaging Compliance AI app: a "Training & Help"
nav section with 10 pages — Getting Started, User Guide, Interactive Walkthroughs,
Video Tutorials, Best Practices, Compliance Academy, FAQ, Release Notes, Platform
Glossary, Contact Support.

## Access model
- Training pages are intentionally visible to **all signed-in users, including
  suppliers**. This works because `requiredPermFor` returns `null` for unknown
  paths, so `/training/*` routes need **no** permission entry. Do not add one
  unless you actually want to restrict a page.
- Support **admin** endpoints gate on `users:read`; the admin-inbox tab in the UI
  shows only when `has("users:read")`.
- Admin recipients for new support tickets are derived from the role taxonomy
  (roles carrying `"*"` or `users:write`), mirroring the AI-cost-alert recipient
  pattern.

## Content is data-driven
- All copy lives in `lib/training/content-*.ts` (`content-types`, `content-learning`,
  `content-guide`, `content-reference`). Pages are thin renderers over that data plus
  a shared `components/training/kit.tsx`. Add/edit content in the data modules, not
  the pages.
- **Why:** keeps 10 pages consistent and small; a new FAQ/glossary/course is a data
  edit, not a component change.

## Progress
- Server-saved per user via `training_progress` table (row presence = completed;
  unique index on `(userId, itemKey)`). PUT upserts on complete, **deletes** the row
  on `completed:false`. Client wrapper: `lib/training/progress.ts` (`useTrainingProgress`).
- Self-scoped reads/deletes include **both** `organizationId` and `userId` predicates
  (not userId alone) — see tenancy-rbac.md for the rule.

## Live tours
- Uses **driver.js** (`lib/training/tours.ts`). Tours anchor to stable `data-tour`
  attributes on the **persistent chrome** (sidebar `[data-tour="sidebar"]`, top-bar
  search/favorites/notifications) so a tour works from any page.
- `startTour(id)` filters out steps whose anchor is absent (`document.querySelector`)
  before driving, so permission-hidden elements don't produce empty spotlights.
- **Why:** cross-page/route-navigating tours are brittle in driver.js; anchoring to
  always-present chrome is reliable. Illustrated step-guides (data in
  `WALKTHROUGHS`) cover flow-specific content that isn't a live tour.

## Support tickets
- `support_requests` table; endpoints in `routes/training.ts`. Requester sees own
  requests; admins list/patch org-wide and the requester is notified on update.
- Enums (keep client selects in lockstep with the server Sets): categories
  general|bug|feature|account|billing|training|other; priorities low|normal|high|urgent;
  statuses open|in_progress|resolved|closed.
