import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { provisionUser, loadTestContextForEmail } from "../lib/rbac/provision";
import { setAuthContext } from "../lib/rbac/context";
import { loadTestIdentity } from "../lib/loadtest";
import { runWithAiUsageContext } from "../lib/ai-usage";
import { classifyAuthGate, isEmailAllowed } from "../lib/auth-gate";

// The domain-gate + 401/503/403 decision now lives in ../lib/auth-gate (pure,
// dependency-free, unit-tested). Re-exported here for callers that historically
// imported isEmailAllowed from this module.
export { isEmailAllowed };

type CacheEntry = {
  email: string | null;
  name: string;
  imageUrl: string | null;
  allowed: boolean;
  expires: number;
};
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();


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
      if (!ctx.email) {
        res.status(401).json({ error: "Unauthorized" });
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

  const now = Date.now();
  let entry = userId ? cache.get(userId) : undefined;
  if (!entry || entry.expires < now) {
    // Delegate the 401 (no session) / 503 (Clerk unreachable) / 403 (wrong
    // domain) / 200 decision to the pure, unit-tested gate. It returns the
    // looked-up identity on both 200 and 403 so we can cache the not-allowed
    // decision too (avoids re-hitting Clerk for a blocked user within the TTL).
    const gate = await classifyAuthGate(userId, async (id) => {
      const user = await clerkClient.users.getUser(id);
      const primary =
        user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ??
        user.emailAddresses[0];
      const email = primary?.emailAddress ?? null;
      const displayName =
        [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
        user.username ||
        (email ? email.split("@")[0] : null) ||
        "Reviewer";
      return { email, name: displayName, imageUrl: user.imageUrl ?? null };
    });

    if (gate.status === 401) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (gate.status === 503) {
      // We could not *reach* Clerk — this is NOT an unauthenticated caller.
      // Returning 401 would surface a transient upstream hiccup as a forced
      // logout mid-work; return a retryable 503 so the client (React Query
      // retries by default) transparently recovers without dropping the session.
      req.log?.error(
        { err: gate.error },
        "Failed to load Clerk user for domain gate",
      );
      res
        .status(503)
        .set("Retry-After", "2")
        .json({
          error:
            "Could not verify your session right now. Please retry in a moment.",
        });
      return;
    }
    entry = {
      email: gate.email,
      name: gate.name,
      imageUrl: gate.imageUrl,
      allowed: gate.status === 200,
      expires: now + CACHE_TTL_MS,
    };
    // userId is guaranteed non-null here (a null userId returns 401 above).
    cache.set(userId as string, entry);
  }

  if (!entry.allowed) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  // An allowed entry is only produced for a non-null userId (a null userId
  // returns 401 from the gate above), so this narrowing is always safe.
  const sessionUserId = userId as string;

  const authed = req as Request & {
    userId?: string;
    userEmail?: string | null;
    userName?: string;
  };
  authed.userId = sessionUserId;
  authed.userEmail = entry.email;
  authed.userName = entry.name;

  // Provision the caller into the database and resolve their organization, role,
  // and effective permissions for downstream authorization + tenant scoping.
  let authCtx;
  try {
    authCtx = await provisionUser(
      sessionUserId,
      entry.email,
      entry.name,
      entry.imageUrl,
    );
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
