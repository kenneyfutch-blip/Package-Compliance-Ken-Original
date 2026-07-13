---
name: Notifications management & per-user state
description: How the notification inbox handles read/archive/delete and type muting, and why shared notifications use a per-user state overlay.
---

# Notifications management

## Per-user state overlay for shared notifications
Notifications can be **org-wide** (`notifications.userId IS NULL`, one row seen by
everyone in the org) or **per-user** (`userId` set). Read / archived / deleted
flags are tracked in a separate `notification_states` table keyed uniquely by
`(notificationId, userId)`, NOT on the shared `notifications` row.

**Why:** if one user marks-read / archives / deletes an org-wide broadcast by
mutating the shared row, it changes it for *every* user in the tenant. Delete is
especially destructive (removes for all). A per-user overlay makes each user's
inbox private while keeping one shared source notification.

**How to apply:**
- GET `/notifications` left-joins `notification_states` for the caller and
  computes effective flags: `read = state?.read ?? base.read`,
  `archived = state?.archived ?? base.archived`; rows with `state.deleted` are
  excluded. Base row flags are only the fallback/initial value.
- All mutations (`read`/`unread`/`archive`/`unarchive`, `read-all`, `DELETE`)
  upsert the caller's state row via `onConflictDoUpdate` on
  `(notificationId, userId)`. They validate visibility first (org + own/null
  scope) so a user can't seed junk state for another org's notification, but the
  write itself is inherently user-scoped — no shared-row mutation, no TOCTOU on
  shared state.
- **Delete is a per-user soft hide** (`state.deleted = true`), never a hard
  delete of the shared row.

## Muting = server-side filter by `type`
User silences alert categories by `type` (`critical` / `warning` / `success` /
`info` — the only stable field on a notification). Muted types are stored in
`notification_preferences.mutedTypes` (jsonb, unique per org+user) and excluded
by GET `/notifications`, so both the list and the nav unread badge respect
muting automatically. Muting retains data (unmute brings it back).

## Contract note
The API response shape is unchanged by the overlay (still `Notification` with
`read`/`archived`), so the overlay refactor needs **no** openapi/codegen/UI
change — only server semantics moved.
