import type { Request, Response, NextFunction } from "express";

// The resolved identity + authorization state for the current request, attached
// by the provisioning step in requireAuth.
export interface AuthContext {
  userId: number;
  clerkUserId: string;
  email: string | null;
  name: string;
  organizationId: number;
  roleKey: string;
  roleName: string;
  permissions: Set<string>;
  supplierId: number | null;
  supplierName: string | null;
}

type WithAuth = Request & { authContext?: AuthContext };

export function getAuthContext(req: Request): AuthContext {
  const ctx = (req as WithAuth).authContext;
  if (!ctx) {
    // requireAuth always runs first, so this indicates a wiring bug.
    throw new Error("Auth context missing; requireAuth must run first");
  }
  return ctx;
}

export function setAuthContext(req: Request, ctx: AuthContext): void {
  (req as WithAuth).authContext = ctx;
}

// Organization id of the caller — used to scope every tenant query.
export function orgId(req: Request): number {
  return getAuthContext(req).organizationId;
}

export function hasPermission(req: Request, key: string): boolean {
  return getAuthContext(req).permissions.has(key);
}

// Route guard: requires the caller to hold ALL of the given permission keys.
export function requirePermission(...required: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ctx = (req as WithAuth).authContext;
    if (!ctx) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const missing = required.filter((k) => !ctx.permissions.has(k));
    if (missing.length > 0) {
      res.status(403).json({
        error: "You do not have permission to perform this action.",
        missing,
      });
      return;
    }
    next();
  };
}

// Route guard: requires the caller to hold AT LEAST ONE of the given keys.
export function requireAnyPermission(...anyOf: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ctx = (req as WithAuth).authContext;
    if (!ctx) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!anyOf.some((k) => ctx.permissions.has(k))) {
      res.status(403).json({
        error: "You do not have permission to perform this action.",
        requiresAnyOf: anyOf,
      });
      return;
    }
    next();
  };
}
