import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db, mcpTokensTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import type { AuthContext } from "../rbac/context";
import { contextForUserId } from "../rbac/provision";

// Personal access tokens for the MCP gateway. Plaintext format:
//   mcp_<48 hex chars>
// Only the SHA-256 hash is persisted; the plaintext is returned exactly once
// at creation time.

const TOKEN_PREFIX = "mcp_";

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function generatePlaintextToken(): string {
  return TOKEN_PREFIX + randomBytes(24).toString("hex");
}

export function displayPrefix(plaintext: string): string {
  return plaintext.slice(0, TOKEN_PREFIX.length + 6);
}

// Constant-time comparison of two hex hashes (defensive: lookups are by exact
// hash equality in SQL, but the double-check avoids subtle regressions if the
// lookup ever changes to a scan).
function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export interface McpTokenAuth {
  ctx: AuthContext;
  tokenId: number;
}

// Resolve a bearer token to a live authorization context. Returns null for
// unknown, revoked, or deactivated-user tokens — callers respond 401 without
// distinguishing which (no oracle for token probing).
export async function authenticateMcpToken(
  bearer: string | undefined,
): Promise<McpTokenAuth | null> {
  if (!bearer || !bearer.startsWith(TOKEN_PREFIX)) return null;
  const tokenHash = hashToken(bearer);
  const [row] = await db
    .select()
    .from(mcpTokensTable)
    .where(
      and(eq(mcpTokensTable.tokenHash, tokenHash), isNull(mcpTokensTable.revokedAt)),
    );
  if (!row || !hashesEqual(row.tokenHash, tokenHash)) return null;
  const ctx = await contextForUserId(row.userId);
  if (!ctx) return null;
  // Tenant sanity: a token never outlives an org move.
  if (ctx.organizationId !== row.organizationId) return null;
  // Best-effort usage timestamp; never blocks the request.
  void db
    .update(mcpTokensTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(mcpTokensTable.id, row.id))
    .catch(() => {});
  return { ctx, tokenId: row.id };
}
