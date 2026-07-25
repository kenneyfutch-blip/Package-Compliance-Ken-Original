// Pure auth/domain-gate decision logic, deliberately free of heavy imports
// (@clerk/express, db, etc.) so it can be unit-tested without a live Clerk
// session or a bundled runtime. requireAuth wraps this with its short-lived
// cache + user provisioning; the HTTP contract it produces is:
//   - no userId                     -> 401 (genuinely unauthenticated)
//   - user lookup throws (Clerk down / unreachable) -> 503 (retryable; NOT a
//     forced logout — this is the enterprise-stability failure we avoid)
//   - email outside the allowed domains -> 403
//   - otherwise                     -> 200

// No domain restriction — any authenticated user is allowed.
export function isEmailAllowed(email: string | null | undefined): boolean {
  return !!email;
}

export type AuthGateResult =
  | { status: 401 }
  | { status: 503; error?: unknown }
  | { status: 403; email: string | null; name: string; imageUrl: string | null }
  | { status: 200; email: string | null; name: string; imageUrl: string | null };

/**
 * Classify a single request against the auth/domain gate given the resolved
 * Clerk userId and a user-lookup function. Extracted from requireAuth so the
 * 401/503/403/200 contract is unit-testable. Returns the looked-up identity on
 * both 200 and 403 so the caller can cache the not-allowed decision too
 * (matching the original inline behavior).
 */
export async function classifyAuthGate(
  userId: string | null | undefined,
  lookupUser: (
    id: string,
  ) => Promise<{ email: string | null; name: string; imageUrl?: string | null }>,
): Promise<AuthGateResult> {
  if (!userId) return { status: 401 };
  let email: string | null;
  let name: string;
  let imageUrl: string | null;
  try {
    const u = await lookupUser(userId);
    email = u.email;
    name = u.name;
    imageUrl = u.imageUrl ?? null;
  } catch (error) {
    return { status: 503, error };
  }
  return isEmailAllowed(email)
    ? { status: 200, email, name, imageUrl }
    : { status: 403, email, name, imageUrl };
}
