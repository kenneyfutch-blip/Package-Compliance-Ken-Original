import { Router, type IRouter, type Request, type Response } from "express";
import { db, mcpTokensTable, mcpToolCallsTable, usersTable } from "@workspace/db";
import { eq, and, desc, isNull } from "drizzle-orm";
import { getAuthContext, requirePermission, orgId } from "../lib/rbac/context";
import { writeAudit } from "../lib/audit";
import {
  generatePlaintextToken,
  hashToken,
  displayPrefix,
} from "../lib/mcp/tokens";

// Session-authenticated management of personal MCP access tokens, plus the
// admin view of the AI tool-call ledger. Suppliers cannot mint tokens: the
// external gateway is for internal associates and future routing agents.

const router: IRouter = Router();

function forbidSuppliers(req: Request, res: Response): boolean {
  if (getAuthContext(req).roleKey === "supplier_user") {
    res.status(403).json({ error: "MCP tokens are not available to supplier accounts." });
    return true;
  }
  return false;
}

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

const MAX_ACTIVE_TOKENS = 10;

// List the caller's own tokens (never the secret — only prefix + metadata).
router.get("/mcp/tokens", async (req: Request, res: Response) => {
  if (forbidSuppliers(req, res)) return;
  const ctx = getAuthContext(req);
  const rows = await db
    .select()
    .from(mcpTokensTable)
    .where(eq(mcpTokensTable.userId, ctx.userId))
    .orderBy(desc(mcpTokensTable.createdAt));
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      tokenPrefix: r.tokenPrefix,
      lastUsedAt: iso(r.lastUsedAt),
      revokedAt: iso(r.revokedAt),
      createdAt: iso(r.createdAt)!,
    })),
  );
});

// Mint a new token. The plaintext appears in this response and nowhere else.
router.post("/mcp/tokens", async (req: Request, res: Response) => {
  if (forbidSuppliers(req, res)) return;
  const ctx = getAuthContext(req);
  const name = String((req.body as { name?: unknown })?.name ?? "").trim();
  if (!name || name.length > 100) {
    res.status(400).json({ error: "Provide a token name (1-100 characters)." });
    return;
  }
  const active = await db
    .select({ id: mcpTokensTable.id })
    .from(mcpTokensTable)
    .where(
      and(eq(mcpTokensTable.userId, ctx.userId), isNull(mcpTokensTable.revokedAt)),
    );
  if (active.length >= MAX_ACTIVE_TOKENS) {
    res.status(409).json({
      error: `You already have ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.`,
    });
    return;
  }
  const plaintext = generatePlaintextToken();
  const [row] = await db
    .insert(mcpTokensTable)
    .values({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      name,
      tokenHash: hashToken(plaintext),
      tokenPrefix: displayPrefix(plaintext),
    })
    .returning();
  await writeAudit(req, {
    entityType: "mcp_token",
    entityId: row!.id,
    action: "mcp_token_created",
    detail: `Created MCP access token "${name}"`,
  });
  res.status(201).json({
    id: row!.id,
    name: row!.name,
    tokenPrefix: row!.tokenPrefix,
    createdAt: iso(row!.createdAt)!,
    // Shown exactly once. Only a hash is stored server-side.
    token: plaintext,
  });
});

// Revoke one of the caller's own tokens (soft — the row and its audit linkage
// are preserved; the credential stops working immediately).
router.post("/mcp/tokens/:id/revoke", async (req: Request, res: Response) => {
  if (forbidSuppliers(req, res)) return;
  const ctx = getAuthContext(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [updated] = await db
    .update(mcpTokensTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(mcpTokensTable.id, id),
        eq(mcpTokensTable.userId, ctx.userId),
        isNull(mcpTokensTable.revokedAt),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Token not found" });
    return;
  }
  await writeAudit(req, {
    entityType: "mcp_token",
    entityId: updated.id,
    action: "mcp_token_revoked",
    detail: `Revoked MCP access token "${updated.name}"`,
  });
  res.json({ ok: true });
});

// Admin: the org-scoped AI tool-call ledger (MCP gateway + in-app workspace).
router.get(
  "/mcp/tool-calls",
  requirePermission("audit:read"),
  async (req: Request, res: Response) => {
    // Suppliers are barred even if a permission override grants audit:read —
    // the ledger spans org-wide internal AI activity, not supplier-scoped data.
    if (forbidSuppliers(req, res)) return;
    const limitRaw = Number(req.query.limit);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    const rows = await db
      .select({
        id: mcpToolCallsTable.id,
        userId: mcpToolCallsTable.userId,
        userName: usersTable.name,
        source: mcpToolCallsTable.source,
        tool: mcpToolCallsTable.tool,
        args: mcpToolCallsTable.args,
        permissionOk: mcpToolCallsTable.permissionOk,
        success: mcpToolCallsTable.success,
        resultChars: mcpToolCallsTable.resultChars,
        errorText: mcpToolCallsTable.errorText,
        durationMs: mcpToolCallsTable.durationMs,
        createdAt: mcpToolCallsTable.createdAt,
      })
      .from(mcpToolCallsTable)
      .leftJoin(usersTable, eq(usersTable.id, mcpToolCallsTable.userId))
      .where(eq(mcpToolCallsTable.organizationId, orgId(req)))
      .orderBy(desc(mcpToolCallsTable.createdAt))
      .limit(limit);
    res.json(
      rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: r.userName ?? "Unknown user",
        source: r.source,
        tool: r.tool,
        args: r.args ?? {},
        permissionOk: r.permissionOk,
        success: r.success,
        resultChars: r.resultChars,
        errorText: r.errorText,
        durationMs: r.durationMs,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      })),
    );
  },
);

export default router;
