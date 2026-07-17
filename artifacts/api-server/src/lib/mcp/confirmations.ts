import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { lt } from "drizzle-orm";
import { db, mcpConfirmationsUsedTable } from "@workspace/db";

// ---------------------------------------------------------------------------
// Stateless confirmation tokens for sensitive (state-changing) MCP actions.
//
// External MCP clients have no confirm-card UI like the in-app AI Workspace,
// so the gateway enforces a two-step flow instead:
//
//   1. First tools/call WITHOUT a confirmationToken → nothing executes. The
//      server validates the args, returns a human-readable preview of exactly
//      what would happen, plus a short-lived confirmation token.
//   2. The client shows the preview to the human. Only after explicit approval
//      does it re-call the SAME action with the SAME arguments plus the token.
//
// The token is an HMAC over (user id, action name, canonical args hash,
// expiry), so it:
//   * cannot be forged or guessed,
//   * is bound to one user — a token minted for one account never confirms
//     another's call,
//   * is bound to the exact arguments — changing any argument after preview
//     invalidates it (no bait-and-switch),
//   * expires quickly (10 minutes) — stale approvals die on their own.
//
// Stateless by design: no DB table to leak or clean up, and the gateway stays
// horizontally scalable.
// ---------------------------------------------------------------------------

const TTL_MS = 10 * 60 * 1000;

function secret(): string {
  const s = process.env["SESSION_SECRET"];
  if (!s) throw new Error("SESSION_SECRET is required for MCP confirmations");
  return s;
}

// Canonical, key-order-independent JSON of the action arguments (the
// confirmationToken itself is excluded — it is transport, not payload).
// Deep-sorts nested objects so future actions with structured arguments
// cannot suffer brittle token mismatches from key ordering.
function deepCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepCanonical);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, deepCanonical(v)]);
  }
  return value;
}

export function canonicalArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
    .filter(([k]) => k !== "confirmationToken")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => [k, deepCanonical(v)]);
  return JSON.stringify(entries);
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function issueConfirmationToken(
  userId: number,
  action: string,
  args: Record<string, unknown>,
  now = Date.now(),
): string {
  const expiresAt = now + TTL_MS;
  const payload = `${userId}\u0000${action}\u0000${canonicalArgs(args)}\u0000${expiresAt}`;
  return `confirm_${expiresAt}_${sign(payload)}`;
}

export function verifyConfirmationToken(
  token: unknown,
  userId: number,
  action: string,
  args: Record<string, unknown>,
  now = Date.now(),
): boolean {
  if (typeof token !== "string") return false;
  const match = /^confirm_(\d+)_([0-9a-f]{64})$/.exec(token);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isFinite(expiresAt) || expiresAt < now) return false;
  const payload = `${userId}\u0000${action}\u0000${canonicalArgs(args)}\u0000${expiresAt}`;
  const expected = Buffer.from(sign(payload), "hex");
  const presented = Buffer.from(match[2]!, "hex");
  return (
    expected.length === presented.length && timingSafeEqual(expected, presented)
  );
}

// Single-use enforcement: atomically consume a (verified) token before
// executing. The unique index on token_hash makes the insert the arbiter — a
// replayed token conflicts, inserts zero rows, and the action is refused.
// Returns true exactly once per token.
export async function consumeConfirmationToken(
  token: string,
  userId: number,
  action: string,
): Promise<boolean> {
  const match = /^confirm_(\d+)_/.exec(token);
  const expiresAt = new Date(match ? Number(match[1]) : Date.now());
  const inserted = await db
    .insert(mcpConfirmationsUsedTable)
    .values({
      tokenHash: createHash("sha256").update(token).digest("hex"),
      userId,
      action,
      expiresAt,
    })
    .onConflictDoNothing()
    .returning({ id: mcpConfirmationsUsedTable.id });
  // Opportunistic prune of long-expired rows (non-fatal, keeps table tiny).
  db.delete(mcpConfirmationsUsedTable)
    .where(lt(mcpConfirmationsUsedTable.expiresAt, new Date(Date.now() - 60 * 60 * 1000)))
    .catch(() => {});
  return inserted.length > 0;
}
