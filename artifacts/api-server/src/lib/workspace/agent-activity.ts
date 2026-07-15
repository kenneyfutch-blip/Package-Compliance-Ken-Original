import type { Request } from "express";
import { db, workspaceAgentRunsTable } from "@workspace/db";
import { writeAudit } from "../audit";
import { logger } from "../logger";

export type AgentRunInput = {
  organizationId: number;
  userId?: number | null;
  conversationId?: number | null;
  provider: string;
  model: string;
  specialist: string;
  status: "succeeded" | "failed";
  // Distinct tool/action names the agent invoked this run.
  toolsUsed: string[];
  citationCount: number;
  proposalCount: number;
  durationMs: number;
  error?: string | null;
};

// Record one AI Workspace agent run for the dashboard's "Agent Activity" feed
// and the audit trail. Fire-and-forget: telemetry must NEVER break or delay the
// chat, so the insert + audit run detached and all failures are swallowed after
// logging (mirrors recordAiUsage). The row is org-scoped and owned by the
// initiating user; the audit event is written through the same request context.
export function recordAgentRun(req: Request, input: AgentRunInput): void {
  void (async () => {
    try {
      const [row] = await db
        .insert(workspaceAgentRunsTable)
        .values({
          organizationId: input.organizationId,
          userId: input.userId ?? null,
          conversationId: input.conversationId ?? null,
          provider: input.provider,
          model: input.model || "unknown",
          specialist: input.specialist,
          status: input.status,
          toolsUsed: input.toolsUsed.length ? input.toolsUsed : null,
          citationCount: input.citationCount,
          proposalCount: input.proposalCount,
          durationMs: input.durationMs,
          error: input.error ?? null,
        })
        .returning({ id: workspaceAgentRunsTable.id });
      if (row) {
        await writeAudit(req, {
          action: "workspace_agent.run",
          entityType: "workspace_agent_run",
          entityId: row.id,
        });
      }
    } catch (err) {
      logger.warn({ err }, "recordAgentRun failed");
    }
  })();
}
