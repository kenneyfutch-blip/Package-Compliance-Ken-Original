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
  name: string | null;
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
      const name =
        [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
        user.username ||
        null;
      entry = {
        email,
        name,
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

  (req as Request & { userId?: string; userEmail?: string | null }).userId =
    userId;
  (req as Request & { userId?: string; userEmail?: string | null }).userEmail =
    entry.email;

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
