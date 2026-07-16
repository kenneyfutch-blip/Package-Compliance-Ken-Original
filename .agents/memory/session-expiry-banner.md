---
name: Session-expiry recovery without work loss
description: How the web app handles mid-session 401s; rules for auth probes and any future global error handling.
---

The shared fetch layer dispatches a window `CustomEvent("api:unauthorized")` on any 401 (browser only, UI-agnostic). The compliance app's `SessionExpiredWatcher` (App.tsx, inside QueryClientProvider) shows a NON-navigating banner — the page and all typed drafts stay intact — with "Sign in again" opening Clerk's modal (`clerk.openSignIn()`, no redirect) and auto-dismissing via `clerk.addListener` when `session.status === "active"` (then `invalidateQueries`).

Rules:
- Never force a reload/redirect on 401 — that's exactly the work-loss the unsaved-guard exists to prevent.
- Auth probes must check an authed endpoint's HTTP status directly; `queryClient.refetchQueries()` resolves even when queries fail, so its success is NOT an auth signal (review-caught bug).
- Supplier detail joins packages strictly by supplierId — runtime vendor-name fallback was rejected in review (rename/name-reuse mis-association); legacy rows rely on the startup backfill.
