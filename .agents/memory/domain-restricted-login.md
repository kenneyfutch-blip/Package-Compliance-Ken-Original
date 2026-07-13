---
name: Employees-only login (domain restriction)
description: How "Dollar Tree employees only" login is enforced given Replit-managed Clerk has no sign-up domain allowlist.
---

# Employees-only login enforcement

The compliance app must let ONLY `@dollartree.com` emails log in. Enforcement is
layered because **Replit-managed Clerk exposes no sign-up domain allowlist/restriction**
(no Clerk dashboard access; confirmed absent in Replit docs + the clerk-auth setup
reference). So account *creation* cannot be blocked at the identity-provider level.

Layers (server is authoritative):
1. **Server 403 gate** — `auth-gate.ts` `isEmailAllowed()` (exact domain match, case-
   insensitive; overridable via `ALLOWED_EMAIL_DOMAINS`). `requireAuth` returns 403 for
   any non-allowed email, so outside accounts can touch zero data. This is the real
   security boundary.
2. **Account purge on detection** — on the fresh-lookup 403 path, `requireAuth` deletes
   the Clerk account (`clerkClient.users.deleteUser`) so no usable outside login persists.
3. **Client `DomainGate`** — UX only (AccessRestricted screen + sign-out).

**Why purge instead of a Clerk-level allowlist:** the managed setup can't restrict sign-up,
and removing self-serve sign-up would break onboarding (new associates must self-sign-up to
create their Clerk login before the app can provision/link them — there is no admin-side
Clerk invite in the managed setup). Delete-on-detect gets the "outside emails can't log in"
outcome without breaking associate onboarding.

**Critical safety invariant for the purge:** only delete when the email is POSITIVELY
confirmed non-allowed. Deletion is gated on `gate.status === 403` AND re-checked inside the
purge helper (`if (!email || isEmailAllowed(email)) return;`). Never delete on:
- a null/undefined email (transient lookup gap) — returns 403 but must not delete,
- the 503 "Clerk unreachable" path — never reaches the 403 branch,
- the dev-only load-test auth path (synthetic userId).
**Why:** a bug that deletes on an unconfirmed email would wipe legitimate associate accounts.

**How to apply:** if you touch the auth gate, preserve the 401/503/403/200 contract and the
"confirmed-email-only" deletion guard. The purge is fire-and-forget (try/catch, logged) so
it never blocks or changes the 403 response.
