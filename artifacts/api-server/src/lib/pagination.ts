import type { Request } from "express";

// Shared list-pagination bounds. Every list endpoint clamps `limit` to at most
// MAX_LIMIT so a client can never request an unbounded page and force the server
// to materialize an entire table. Matches the reference /violations endpoint.
export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 500;

// Parse a non-negative integer query value, falling back when absent/invalid.
export function toInt(value: unknown, fallback: number): number {
  const n =
    typeof value === "string"
      ? parseInt(value, 10)
      : typeof value === "number"
        ? value
        : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
}

export interface Pagination {
  limit: number;
  offset: number;
}

// Resolve `limit`/`offset` from the request query, clamping `limit` to
// [0, MAX_LIMIT] (over-large requests are clamped, not rejected, so existing
// clients keep working) and defaulting `offset` to 0.
export function parsePagination(
  req: Request,
  defaultLimit: number = DEFAULT_LIMIT,
  maxLimit: number = MAX_LIMIT,
): Pagination {
  return {
    limit: Math.min(toInt(req.query["limit"], defaultLimit), maxLimit),
    offset: toInt(req.query["offset"], 0),
  };
}
