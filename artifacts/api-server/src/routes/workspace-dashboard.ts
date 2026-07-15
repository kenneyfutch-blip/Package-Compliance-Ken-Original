import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  aiConversationsTable,
  reportsTable,
  workspaceActionProposalsTable,
  workspaceAgentRunsTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { orgId, getAuthContext, hasPermission } from "../lib/rbac/context";
import { packageConds, opsTeamScope } from "../lib/rbac/scope";
import { listAssignments } from "../lib/reviews/reporting";
import { getSpecialist } from "../lib/specialists";
import { getActiveAgentProvider } from "../lib/agents/registry";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// AI Workspace dashboard aggregation.
//
// GET /workspace/home returns the Workspace landing surface: a set of sections,
// each already scoped to EXACTLY what the caller may already see elsewhere in
// the app. This endpoint surfaces existing data — it never widens access:
//   * Own-data sections (conversations, saved investigations, suggested actions,
//     agent + specialist activity) are scoped to org + the calling user.
//   * Cross-record sections (reviews, reports) reuse the same permission gates
//     and tenant/supplier scoping the underlying pages use. A section the caller
//     may not see is returned with visible=false and no items, so the UI can
//     omit it rather than leaking its existence.
//
// A single stalled query must not blank the whole dashboard, so every section is
// resolved independently and a failed section degrades to empty (never throws).
// ---------------------------------------------------------------------------

const router: IRouter = Router();

const RECENT_LIMIT = 6;

type HomeItem = {
  id: string;
  title: string;
  subtitle: string | null;
  href: string | null;
  badge: string | null;
  timestamp: string | null;
};

type HomeSection = {
  key: string;
  title: string;
  description: string;
  visible: boolean;
  items: HomeItem[];
};

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

// Resolve one section's items, swallowing any failure to an empty list so a
// single slow/broken query can never take down the whole dashboard.
async function safeItems(
  key: string,
  fn: () => Promise<HomeItem[]>,
): Promise<HomeItem[]> {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ err, section: key }, "workspace dashboard section failed");
    return [];
  }
}

router.get(
  "/workspace/home",
  async (req: Request, res: Response): Promise<void> => {
    const organizationId = orgId(req);
    const { userId } = getAuthContext(req);

    // Permission gates mirror the pages each section links to.
    const canReviews = hasPermission(req, "packages:read");
    const canReports = hasPermission(req, "reports:read");

    // --- own conversations (newest first) ---------------------------------
    const recentConversations = await safeItems("recentConversations", async () => {
      const rows = await db
        .select()
        .from(aiConversationsTable)
        .where(
          and(
            eq(aiConversationsTable.organizationId, organizationId),
            eq(aiConversationsTable.userId, userId),
            eq(aiConversationsTable.archived, false),
          ),
        )
        .orderBy(desc(aiConversationsTable.updatedAt))
        .limit(RECENT_LIMIT);
      return rows.map((r) => ({
        id: `conversation-${r.id}`,
        title: r.title,
        subtitle: getSpecialist(r.specialist).label,
        href: `/ai-workspace/${r.id}`,
        badge: r.favorite ? "Saved" : null,
        timestamp: iso(r.updatedAt),
      }));
    });

    // --- saved investigations (favorited conversations) -------------------
    const savedInvestigations = await safeItems("savedInvestigations", async () => {
      const rows = await db
        .select()
        .from(aiConversationsTable)
        .where(
          and(
            eq(aiConversationsTable.organizationId, organizationId),
            eq(aiConversationsTable.userId, userId),
            eq(aiConversationsTable.archived, false),
            eq(aiConversationsTable.favorite, true),
          ),
        )
        .orderBy(desc(aiConversationsTable.updatedAt))
        .limit(RECENT_LIMIT);
      return rows.map((r) => ({
        id: `saved-${r.id}`,
        title: r.title,
        subtitle: r.linkedRecordLabel ?? getSpecialist(r.specialist).label,
        href: `/ai-workspace/${r.id}`,
        badge: null,
        timestamp: iso(r.updatedAt),
      }));
    });

    // --- reviews assigned to me -------------------------------------------
    const assignedReviews = canReviews
      ? await safeItems("assignedReviews", async () => {
          const rows = await listAssignments(
            organizationId,
            { assigneeUserId: userId },
            packageConds(req),
            opsTeamScope(req),
            { limit: RECENT_LIMIT, offset: 0 },
          );
          return rows.map((r) => ({
            id: `assignment-${r.assignment.id}`,
            title: r.packageName ?? `Package #${r.assignment.packageId}`,
            subtitle:
              [r.category, r.assignment.status].filter(Boolean).join(" · ") ||
              null,
            href: `/reviews/${r.assignment.packageId}`,
            badge:
              (r.criticalCount ?? 0) > 0 ? `${r.criticalCount} critical` : null,
            timestamp: iso(r.assignment.updatedAt),
          }));
        })
      : [];

    // --- recent reviews across the caller's scope -------------------------
    const recentReviews = canReviews
      ? await safeItems("recentReviews", async () => {
          const rows = await listAssignments(
            organizationId,
            {},
            packageConds(req),
            opsTeamScope(req),
            { limit: RECENT_LIMIT, offset: 0 },
          );
          return rows.map((r) => ({
            id: `review-${r.assignment.id}`,
            title: r.packageName ?? `Package #${r.assignment.packageId}`,
            subtitle:
              [r.assigneeName, r.assignment.status]
                .filter(Boolean)
                .join(" · ") || null,
            href: `/reviews/${r.assignment.packageId}`,
            badge: r.complianceStatus ?? null,
            timestamp: iso(r.assignment.updatedAt),
          }));
        })
      : [];

    // --- recent reports ---------------------------------------------------
    const recentReports = canReports
      ? await safeItems("recentReports", async () => {
          const rows = await db
            .select()
            .from(reportsTable)
            .where(eq(reportsTable.organizationId, organizationId))
            .orderBy(desc(reportsTable.createdAt))
            .limit(RECENT_LIMIT);
          return rows.map((r) => ({
            id: `report-${r.id}`,
            title: r.title,
            subtitle: r.type,
            href: "/reports",
            badge: r.format,
            timestamp: iso(r.createdAt),
          }));
        })
      : [];

    // --- suggested actions: the caller's own pending action proposals ------
    // These are the concrete next steps the assistant proposed and is awaiting
    // the user's confirmation on. Own-data, so always visible.
    const suggestedActions = await safeItems("suggestedActions", async () => {
      const rows = await db
        .select()
        .from(workspaceActionProposalsTable)
        .where(
          and(
            eq(workspaceActionProposalsTable.organizationId, organizationId),
            eq(workspaceActionProposalsTable.userId, userId),
            eq(workspaceActionProposalsTable.status, "pending"),
          ),
        )
        .orderBy(desc(workspaceActionProposalsTable.createdAt))
        .limit(RECENT_LIMIT);
      return rows.map((r) => ({
        id: `proposal-${r.id}`,
        title: r.summary,
        subtitle: "Awaiting your confirmation",
        href: `/ai-workspace/${r.conversationId}`,
        badge: "Action",
        timestamp: iso(r.createdAt),
      }));
    });

    // --- agent activity: the caller's own recent agent runs ---------------
    const agentActivity = await safeItems("agentActivity", async () => {
      const rows = await db
        .select({
          run: workspaceAgentRunsTable,
          conversationTitle: aiConversationsTable.title,
        })
        .from(workspaceAgentRunsTable)
        .leftJoin(
          aiConversationsTable,
          eq(workspaceAgentRunsTable.conversationId, aiConversationsTable.id),
        )
        .where(
          and(
            eq(workspaceAgentRunsTable.organizationId, organizationId),
            eq(workspaceAgentRunsTable.userId, userId),
          ),
        )
        .orderBy(desc(workspaceAgentRunsTable.createdAt))
        .limit(RECENT_LIMIT);
      return rows.map(({ run, conversationTitle }) => {
        const toolCount = Array.isArray(run.toolsUsed)
          ? run.toolsUsed.length
          : 0;
        const parts = [
          getSpecialist(run.specialist).label,
          toolCount ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : null,
          run.proposalCount ? `${run.proposalCount} proposed` : null,
        ].filter(Boolean);
        return {
          id: `run-${run.id}`,
          title: conversationTitle ?? "AI Workspace run",
          subtitle: parts.join(" · ") || null,
          href: run.conversationId ? `/ai-workspace/${run.conversationId}` : null,
          badge: run.status === "failed" ? "Failed" : null,
          timestamp: iso(run.createdAt),
        };
      });
    });

    // --- specialist activity: which AI specialists the caller has used -----
    const specialistActivity = await safeItems("specialistActivity", async () => {
      const rows = await db
        .select({
          specialist: workspaceAgentRunsTable.specialist,
          runs: sql<number>`count(*)::int`,
          lastAt: sql<string | null>`max(${workspaceAgentRunsTable.createdAt})`,
        })
        .from(workspaceAgentRunsTable)
        .where(
          and(
            eq(workspaceAgentRunsTable.organizationId, organizationId),
            eq(workspaceAgentRunsTable.userId, userId),
          ),
        )
        .groupBy(workspaceAgentRunsTable.specialist)
        .orderBy(desc(sql`count(*)`))
        .limit(RECENT_LIMIT);
      return rows.map((r) => ({
        id: `specialist-${r.specialist}`,
        title: getSpecialist(r.specialist).label,
        subtitle: `${r.runs} conversation${r.runs === 1 ? "" : "s"}`,
        href: "/ai-workspace",
        badge: null,
        timestamp: r.lastAt ? new Date(r.lastAt).toISOString() : null,
      }));
    });

    const sections: HomeSection[] = [
      {
        key: "recentConversations",
        title: "Recent Conversations",
        description: "Pick up where you left off with the AI assistant.",
        visible: true,
        items: recentConversations,
      },
      {
        key: "savedInvestigations",
        title: "Saved Investigations",
        description: "Conversations you have saved for quick reference.",
        visible: true,
        items: savedInvestigations,
      },
      {
        key: "assignedReviews",
        title: "Assigned to You",
        description: "Reviews currently in your workload.",
        visible: canReviews,
        items: assignedReviews,
      },
      {
        key: "recentReviews",
        title: "Recent Reviews",
        description: "Latest review activity across your teams.",
        visible: canReviews,
        items: recentReviews,
      },
      {
        key: "recentReports",
        title: "Recent Reports",
        description: "Compliance reports generated for your organization.",
        visible: canReports,
        items: recentReports,
      },
      {
        key: "suggestedActions",
        title: "Suggested Actions",
        description: "Assistant proposals awaiting your confirmation.",
        visible: true,
        items: suggestedActions,
      },
      {
        key: "agentActivity",
        title: "Agent Activity",
        description: "A log of your recent AI assistant runs.",
        visible: true,
        items: agentActivity,
      },
      {
        key: "specialistActivity",
        title: "Specialist Activity",
        description: "The AI specialists you work with most.",
        visible: true,
        items: specialistActivity,
      },
    ];

    const provider = getActiveAgentProvider();
    // Resolve the active model for display; never fail the dashboard if the AI
    // configuration is unavailable.
    let model = "unavailable";
    try {
      const session = await provider.createSession();
      model = session.model;
    } catch (err) {
      logger.warn({ err }, "workspace dashboard provider resolve failed");
    }

    res.json({
      provider: { key: provider.key, label: provider.label, model },
      sections,
    });
  },
);

export default router;
