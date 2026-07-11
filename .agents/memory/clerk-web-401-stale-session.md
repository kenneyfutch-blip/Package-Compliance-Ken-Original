---
name: Clerk web 401 with cookie present (Replit dev preview)
description: Diagnosing/curing "No access" where the API returns 401 even though the browser is signed in.
---

# Clerk web 401 in dev preview — stale session token, not a code bug

Symptom: web app renders as if signed-in (Clerk client shows a session, the
signed-in shell mounts), but every API call returns 401 → permissions come back
empty → the app gates everything to a "No access"/blank page. Fallback UI text
(e.g. "Signed in" / "Member") shows because the `/api/me` fetch failed.

## How to diagnose (fast, deterministic)
1. Log inside `requireAuth` on the `!userId` branch: does the request carry a
   `__session` cookie, and what does `getAuth(req)` return? If `hasCookieHeader`
   is true and `__session` is present but `userId` is null, the cookie reached
   the server but failed verification — it is NOT a cookie-transport or CORS
   problem, and NOT the missing-`credentials:"include"` red herring (same-origin
   fetches send cookies by default).
2. Rule out key mismatch: compute the Clerk cookie suffix
   `sha1(publishableKey)` → base64url → first 8 chars, for both
   `CLERK_PUBLISHABLE_KEY` (backend) and `VITE_CLERK_PUBLISHABLE_KEY` (frontend)
   and compare to the `__session_<suffix>` cookie name. Run it in a `node -e`
   shell against `process.env` so no secret value is printed — only the suffix
   (already public in cookie names) and an equality boolean. Matching suffix +
   same decoded instance host (`pk_test_<base64(host)>`) ⇒ keys are fine.

## Cure
If keys match and cookies are present, the `__session` JWT is simply stale
(Clerk refreshes it client-side every ~50s; it can drift, and leftover duplicate
`__session` cookies from earlier runs make it worse). A full page reload makes
Clerk mint a fresh token and the backend verifies it → 200s return. Restarting
the client (web) workflow forces that reload via Vite. No code change needed.

**Why:** the wiring here (`app.ts` clerkMiddleware, `App.tsx` ClerkProvider,
custom-fetch) already matches the clerk-auth canonical snippets; the failure was
runtime session state, not divergence.

**How to apply:** don't "fix" this by adding `setAuthTokenGetter`/Bearer tokens
to web calls or hand-editing Clerk secrets — both are dangerous per the skill.
Verify cookie presence + key suffix match first; if both hold, reload/restart.
