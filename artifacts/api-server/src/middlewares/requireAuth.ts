import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { provisionUser } from "../lib/rbac/provision";
import { setAuthContext } from "../lib/rbac/context";

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
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    // TEMP DEBUG: understand why the Clerk session isn't validating on the API.
    const cookieHeader = req.headers.cookie ?? "";
    const cookieNames = cookieHeader
      .split(";")
      .map((c) => c.split("=")[0]?.trim())
      .filter(Boolean);
    req.log?.warn(
      {
        hasCookieHeader: cookieHeader.length > 0,
        cookieNames,
        hasAuthHeader: Boolean(req.headers.authorization),
        host: req.headers.host,
        xForwardedHost: req.headers["x-forwarded-host"],
        origin: req.headers.origin,
        authReason: (auth as { reason?: string } | null)?.reason,
        authSessionId: (auth as { sessionId?: string } | null)?.sessionId,
      },
      "requireAuth: no userId from getAuth",
    );
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
      req.log?.error({ err }, "Failed to load Clerk user for domain gate");
      res.status(401).json({ error: "Unauthorized" });
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
  try {
    const ctx = await provisionUser(userId, entry.email, entry.name);
    setAuthContext(req, ctx);
  } catch (err) {
    req.log?.error({ err }, "Failed to provision user");
    res.status(500).json({ error: "Failed to establish user session" });
    return;
  }

  next();
}
