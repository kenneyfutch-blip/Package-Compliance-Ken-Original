---
name: Favorite tools navigation
description: Per-user starred nav tools — storage scoping and the persist-race gotcha
---

# Favorite tools (compliance web nav)

Users can star tools in the left sidebar. Starred tools appear in a pinned
"Favorites" sidebar section and a Favorites dropdown in the top header.

## Decisions / constraints

- **Favorites localStorage is scoped per signed-in user** (`compliance-favorite-tools-v1:<userId>`), unlike the older browser-global nav state (`compliance-nav-sections-v1`) and recently-viewed resources. **Why:** on a shared browser / account switch, a global key leaks one account's stars into another. New per-user UI state should follow this scoping.
- **Persist write-through in `toggle()`, never from a `useEffect` keyed on `[key, favorites]`.** **Why:** when the user (and thus the key) changes, an effect ordering race writes the *previous* user's list under the *new* user's key. On user change, an effect only *reloads*; writes happen only on explicit toggle.
- Favorites store bare hrefs; they're resolved to `{name, icon}` via a flat `ALL_ITEMS` lookup and re-filtered through `requiredPermFor + has`, so a user never sees a starred tool they lack permission for, and stale/removed hrefs are dropped at render.
- `Me.id` from `usePermissions()` is a **number**, not a string.
- The star toggle is a **sibling** of the row's `<Link>` (wouter renders an anchor), never nested inside it — nesting a button in an anchor is invalid markup.
