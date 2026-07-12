import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { provisionUser, loadTestContextForEmail } from "../lib/rbac/provision";
import { setAuthContext } from "../lib/rbac/context";
import { loadTestIdentity } from "../lib/loadtest";
import { runWithAiUsageContext } from "../lib/ai-usage";

// Access is restricted to Dollar Tree associates. Enforced here on the server so
// the restriction holds in production regardless of any client-side checks.
// Override with a comma-separated ALLOWED_EMAIL_DOMAINS env var if needed.
const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS ?? "dollartree.com")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

type CacheEntry = {
  email: string | null;
  name: string;
  allowed: boolean;
  expires: number;
};
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return ALLOWED_DOMAINS.some((d) => domain === d);
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Dev-only load-test authentication hook (see lib/loadtest.ts). Hard-disabled
  // in production; only active when NODE_ENV!=="production" AND a load-test secret
  // is configured, AND the request presents that exact secret. Lets the
  // performance harness authenticate as a seeded user without a live Clerk
  // session, reusing that user's real role, permissions, and tenant scope.
  const loadTest = loadTestIdentity(req);
  if (loadTest) {
    try {
      const ctx = await loadTestContextForEmail(loadTest.email);
      if (!ctx) {
        res.status(401).json({ error: "Unknown load-test user" });
        return;
      }
      if (!isEmailAllowed(ctx.email)) {
        res
          .status(403)
          .json({ error: "Access is restricted to Dollar Tree associates." });
        return;
      }
      const authed = req as Request & {
        userId?: string;
        userEmail?: string | null;
        userName?: string;
      };
      authed.userId = ctx.clerkUserId ?? `loadtest:${loadTest.email}`;
      authed.userEmail = ctx.email;
      authed.userName = ctx.name;
      setAuthContext(req, ctx);
      // Carry tenant + user identity for the downstream handler chain so AI
      // usage logging can attribute requests without threading identity through
      // every AI call signature.
      runWithAiUsageContext(
        { organizationId: ctx.organizationId, userId: ctx.userId },
        () => next(),
      );
      return;
    } catch (err) {
      req.log?.error({ err }, "Load-test auth hook failed");
      res.status(500).json({ error: "Failed to establish user session" });
      return;
    }
  }

  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const now = Date.now();
  let entry = cache.get(userId);
  if (!entry || entry.expires < now) {
    try {
      const user = await clerkClient.users.getUser(userId);
      const primary =
        user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ??
        user.emailAddresses[0];
      const email = primary?.emailAddress ?? null;
      const displayName =
        [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
        user.username ||
        (email ? email.split("@")[0] : null) ||
        "Reviewer";
      entry = {
        email,
        name: displayName,
        allowed: isEmailAllowed(email),
        expires: now + CACHE_TTL_MS,
      };
      cache.set(userId, entry);
    } catch (err) {
      // A failure here means we could not *reach* Clerk to look the user up —
      // it does NOT mean the caller is unauthenticated. Returning 401 would
      // surface a transient upstream hiccup as a forced logout mid-work, which
      // is exactly the enterprise-stability failure we want to avoid. Return a
      // retryable 503 instead so the client (React Query retries by default)
      // transparently recovers without tearing down the session. Genuine
      // "no session" cases are already handled by the 401 above.
      req.log?.error({ err }, "Failed to load Clerk user for domain gate");
      res
        .status(503)
        .set("Retry-After", "2")
        .json({
          error:
            "Could not verify your session right now. Please retry in a moment.",
        });
      return;
    }
  }

  if (!entry.allowed) {
    res
      .status(403)
      .json({ error: "Access is restricted to Dollar Tree associates." });
    return;
  }

  const authed = req as Request & {
    userId?: string;
    userEmail?: string | null;
    userName?: string;
  };
  authed.userId = userId;
  authed.userEmail = entry.email;
  authed.userName = entry.name;

  // Provision the caller into the database and resolve their organization, role,
  // and effective permissions for downstream authorization + tenant scoping.
  let authCtx;
  try {
    authCtx = await provisionUser(userId, entry.email, entry.name);
    setAuthContext(req, authCtx);
  } catch (err) {
    req.log?.error({ err }, "Failed to provision user");
    res.status(500).json({ error: "Failed to establish user session" });
    return;
  }

  // Carry tenant + user identity for the downstream handler chain (see above).
  runWithAiUsageContext(
    { organizationId: authCtx.organizationId, userId: authCtx.userId },
    () => next(),
  );
}
