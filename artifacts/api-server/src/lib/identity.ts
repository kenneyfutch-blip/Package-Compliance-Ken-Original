import type { Request } from "express";

type AuthedRequest = Request & {
  userId?: string;
  userEmail?: string | null;
  userName?: string;
};

/**
 * Resolves the authenticated actor used for every audit/identity field.
 *
 * Identity is ALWAYS derived from the Clerk session (populated by requireAuth),
 * never from the request body — this is what prevents a signed-in user from
 * impersonating another reviewer in comments, approvals, or audit events.
 */
export function currentUser(req: Request): {
  name: string;
  email: string | null;
} {
  const r = req as AuthedRequest;
  const email = r.userEmail ?? null;
  const name =
    r.userName && r.userName.trim().length > 0
      ? r.userName
      : email
        ? (email.split("@")[0] ?? "Reviewer")
        : "Reviewer";
  return { name, email };
}
