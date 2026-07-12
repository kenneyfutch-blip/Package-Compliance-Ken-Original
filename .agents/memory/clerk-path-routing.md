---
name: Clerk path-routed components with wouter
description: How to render Clerk UserProfile/SignIn/SignUp as full pages (not modals) under this app's base path + router.
---

# Clerk path-routed components with wouter

Clerk components (`<UserProfile>`, `<SignIn>`, `<SignUp>`) rendered inline as pages use `routing="path"` and drive their own internal sub-navigation via the browser history (e.g. `/account`, `/account/security`, `/account/profile`).

## Rules (each caused or would cause a real bug)
- **`path` must include the artifact base path.** Use `import.meta.env.BASE_URL.replace(/\/$/, "") + "/account"`. Mirrors how `SignInPage`/`SignUpPage` pass `path={`${basePath}/sign-in`}`. A root-relative `/account` escapes the artifact prefix.
- **The wouter route must be a nested/catch-all match, not exact.** Register `<Route path="/account" nest component={AccountPage} />` (wouter ≥3 `nest` prop). Without `nest`, an exact `/account` route matches the landing tab but Clerk's deep sub-routes (`/account/security`) fall through to `NotFound`.
- **Route-gate check must not block it.** `requiredPermFor` returns `null` for any path it doesn't map (incl. `/account/*`), so a personal account page is available to any signed-in user by default. Don't add an `/account` entry unless you intend to gate it.

**Why:** converting the account modal (`useClerk().openUserProfile()`) into a dedicated page requires all three or the page 404s on tab switch, breaks under the base path, or gets NoAccess-blocked.

## Admin/settings hub pattern
The account page also hosts permission-gated quick links to existing admin/operations routes. Gate each link by reusing `requiredPermFor(path)` + `usePermissions().has(perm)` so the hub can never drift from the sidebar nav or the route gate (single source of truth).
