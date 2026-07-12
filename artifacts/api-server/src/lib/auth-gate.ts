// Pure auth/domain-gate decision logic, deliberately free of heavy imports
// (@clerk/express, db, etc.) so it can be unit-tested without a live Clerk
// session or a bundled runtime. requireAuth wraps this with its short-lived
// cache + user provisioning; the HTTP contract it produces is:
//   - no userId                     -> 401 (genuinely unauthenticated)
//   - user lookup throws (Clerk down / unreachable) -> 503 (retryable; NOT a
//     forced logout — this is the enterprise-stability failure we avoid)
//   - email outside the allowed domains -> 403
//   - otherwise                     -> 200

// Access is restricted to Dollar Tree associates. Enforced on the server so the
// restriction holds in production regardless of any client-side checks.
// Override with a comma-separated ALLOWED_EMAIL_DOMAINS env var if needed.
const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS ?? "dollartree.com")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return ALLOWED_DOMAINS.some((d) => domain === d);
}

export type AuthGateResult =
  | { status: 401 }
  | { status: 503; error?: unknown }
  | { status: 403; email: string | null; name: string }
  | { status: 200; email: string | null; name: string };

/**
 * Classify a single request against the auth/domain gate given the resolved
 * Clerk userId and a user-lookup function. Extracted from requireAuth so the
 * 401/503/403/200 contract is unit-testable. Returns the looked-up identity on
 * both 200 and 403 so the caller can cache the not-allowed decision too
 * (matching the original inline behavior).
 */
export async function classifyAuthGate(
  userId: string | null | undefined,
  lookupUser: (id: string) => Promise<{ email: string | null; name: string }>,
): Promise<AuthGateResult> {
  if (!userId) return { status: 401 };
  let email: string | null;
  let name: string;
  try {
    const u = await lookupUser(userId);
    email = u.email;
    name = u.name;
  } catch (error) {
    return { status: 503, error };
  }
  return isEmailAllowed(email)
    ? { status: 200, email, name }
    : { status: 403, email, name };
}
