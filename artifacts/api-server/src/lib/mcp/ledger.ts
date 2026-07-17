import { db, mcpToolCallsTable } from "@workspace/db";
import { logger } from "../logger";

// Per-tool-call audit ledger shared by the MCP gateway and the in-app AI
// Workspace agent. Fire-and-forget: recording must NEVER break or slow the
// AI path itself (same principle as AI usage telemetry).

const MAX_ARG_CHARS = 2000;

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  try {
    const raw = JSON.stringify(args ?? {});
    if (raw.length <= MAX_ARG_CHARS) return args ?? {};
    return { _truncated: raw.slice(0, MAX_ARG_CHARS) };
  } catch {
    return { _unserializable: true };
  }
}

export function recordToolCall(entry: {
  organizationId: number;
  userId: number;
  source: "mcp" | "workspace";
  tool: string;
  args: Record<string, unknown>;
  permissionOk: boolean;
  success: boolean;
  resultChars?: number;
  errorText?: string;
  durationMs?: number;
}): void {
  void db
    .insert(mcpToolCallsTable)
    .values({
      organizationId: entry.organizationId,
      userId: entry.userId,
      source: entry.source,
      tool: entry.tool,
      args: sanitizeArgs(entry.args),
      permissionOk: entry.permissionOk,
      success: entry.success,
      resultChars: entry.resultChars ?? null,
      errorText: entry.errorText?.slice(0, 1000) ?? null,
      durationMs: entry.durationMs ?? null,
    })
    .catch((err) => {
      logger.warn({ err, tool: entry.tool }, "mcp tool-call ledger write failed");
    });
}
