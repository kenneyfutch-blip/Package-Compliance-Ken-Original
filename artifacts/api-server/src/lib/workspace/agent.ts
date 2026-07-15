import type { Request } from "express";
import { resolveAiClientForTier } from "../ai-client";
import { readUsage, WORKLOAD_LABELS } from "../ai-orchestration";
import { recordAiUsage } from "../ai-usage";
import { getSpecialist } from "../specialists";
import {
  ASSISTANT_TOOL_CATALOG,
  type AssistantChatMessage,
  type WorkspacePageContext,
} from "../ai";
import { logger } from "../logger";
import {
  availableToolsFor,
  findTool,
  toolStatusLabel,
  type WorkspaceCitation,
} from "./tools";
import {
  availableActionsFor,
  findAction,
  actionStatusLabel,
  type WorkspaceAction,
} from "./actions";

// A state-changing action the model has proposed and the user must confirm
// before it runs. Carries only what the confirm flow needs; the authoritative
// copy is persisted server-side so parameters cannot be tampered with.
export type ProposedAction = {
  actionName: string;
  params: Record<string, unknown>;
  summary: string;
};

// ---------------------------------------------------------------------------
// AI Workspace agent — grounded, tool-calling, streaming chat.
//
// Layered on top of the classic assistant: the model can call the read-only
// data tools (workspace/tools.ts) to ground answers in the user's real, permission-
// scoped platform data, then streams a plain-text answer. Tool-resolution rounds
// and the final answer both stream, so any assistant text is delivered live and
// tool activity surfaces as `status` events. Citations from the tools that were
// used are returned so the UI can render source links.
// ---------------------------------------------------------------------------

const MAX_TOOL_ROUNDS = 4;
// Hard cap on tool calls executed in a single round, bounding worst-case fan-out.
const MAX_TOOL_CALLS_PER_ROUND = 6;
// Hard cap on a single tool's serialized result fed back to the model, so a
// large query result can't blow the context or the response budget.
const MAX_TOOL_RESULT_CHARS = 6000;

type AssembledToolCall = { id: string; name: string; args: string };

function buildSystemPrompt(opts: {
  specialistKey: string;
  pageContext?: WorkspacePageContext | null;
  linkedRecordLabel?: string | null;
  hasTools: boolean;
  hasActions: boolean;
}): string {
  const specialist = getSpecialist(opts.specialistKey);
  const catalog = ASSISTANT_TOOL_CATALOG.map(
    (t) => `- ${t.label} (${t.href}): ${t.desc}`,
  ).join("\n");

  const contextParts: string[] = [];
  if (opts.linkedRecordLabel) {
    contextParts.push(
      `The user has linked this record to the conversation: ${opts.linkedRecordLabel}.`,
    );
  }
  if (opts.pageContext?.title || opts.pageContext?.path) {
    contextParts.push(
      `The user is currently viewing: ${opts.pageContext.title ?? opts.pageContext.path}${opts.pageContext.path && opts.pageContext.title ? ` (${opts.pageContext.path})` : ""}.`,
    );
  }
  if (opts.pageContext?.summary) {
    contextParts.push(`Context summary: ${opts.pageContext.summary.slice(0, 1200)}`);
  }
  const contextBlock =
    contextParts.length > 0
      ? `\n\nCurrent context (use only if relevant):\n${contextParts.join("\n")}`
      : "";

  const personaBlock = specialist.instructions
    ? `\n\nPersona: ${specialist.label}. ${specialist.instructions}`
    : "";

  const toolsBlock = opts.hasTools
    ? `\n\nYou have READ-ONLY tools that fetch the user's real platform data (packages, findings, regulations, compliance memory, specialists, tasks, suppliers, reports, SOPs, audit trail, recalls). Every tool is already scoped to exactly what THIS user is permitted to see — never claim you cannot see data for permission reasons without trying the relevant tool first. Use tools whenever the user asks about their actual data ("my packages", "which suppliers", "what findings", "who can review…"); do NOT invent records, ids, statuses or citations. If a tool returns nothing, say so plainly. Ground factual claims about specific records in tool results, and prefer citing the specific records you used. For general regulatory/compliance knowledge you may answer directly. Do not call tools for pure greetings or general how-to questions.`
    : "";

  const actionsBlock = opts.hasActions
    ? `\n\nYou can also take ACTIONS on the user's behalf when they clearly ask you to (e.g. "assign this to Dana", "escalate it", "create a task", "generate a report", "summarize the findings", "compare the versions").
- Read-only/derived actions (summarize_findings, draft_approval_notes, compare_versions, prepare_executive_summary) run immediately and their output is returned to you — weave it into your answer.
- State-changing actions (create_review, assign_reviewer, escalate_review, create_task, generate_report) are NOT executed when you call them. Calling one PROPOSES it to the user, who must explicitly confirm before it runs. When you call such an action, tell the user plainly what you have proposed and that it is awaiting their confirmation. NEVER claim a state-changing action is done — it only happens after they confirm. Resolve real ids first (e.g. call list_specialists to get a specialistId before assign_reviewer). Do not propose the same action twice.`
    : "";

  return `You are the AI compliance assistant for a packaging compliance review platform used by retail compliance specialists. Answer questions about packaging, labeling and regulatory compliance (FDA / FTC / CPSC / EPA / USDA / Prop 65 requirements, required warnings and disclosures, claim substantiation, net-quantity statements, ingredient/allergen labeling) accurately and practically, and help users find the right tool in the app.

Be warm, concise and practical. Write a clear, well-structured plain-text answer (short paragraphs or bullet points where helpful). When a specific in-app tool would help, mention it by name and reference its path from this catalog — never invent paths:
${catalog}

If you are not certain about a specific regulation or citation, say so plainly rather than guessing, and point the user to the Regulatory Library for authoritative text. Never state an uncertain requirement as if it were definitive. Do not use emojis.${toolsBlock}${actionsBlock}${personaBlock}${contextBlock}`;
}

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

/**
 * Run the grounded Workspace agent. Streams plain-text answer chunks via
 * onDelta and tool activity via onStatus. Returns the full answer and the
 * de-duplicated citations from every tool that was used. Usage is logged
 * fire-and-forget; telemetry never affects the response.
 */
export async function runWorkspaceAgent(opts: {
  req: Request;
  organizationId: number;
  userId?: number | null;
  specialistKey: string;
  messages: AssistantChatMessage[];
  pageContext?: WorkspacePageContext | null;
  linkedRecordLabel?: string | null;
  onDelta: (text: string) => void;
  onStatus?: (info: { tool: string; label: string }) => void;
  signal?: AbortSignal;
}): Promise<{
  answer: string;
  citations: WorkspaceCitation[];
  proposals: ProposedAction[];
}> {
  const {
    req,
    organizationId,
    userId,
    specialistKey,
    messages,
    pageContext,
    linkedRecordLabel,
    onDelta,
    onStatus,
    signal,
  } = opts;

  const tools = availableToolsFor(req);
  const actions = availableActionsFor(req);
  // The model is offered read tools AND actions under one function-calling
  // surface. Sensitive actions are intercepted at call time (proposed, not run);
  // non-sensitive actions execute inline like read tools.
  const toolDefs = [...tools, ...actions].map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const system = buildSystemPrompt({
    specialistKey,
    pageContext,
    linkedRecordLabel,
    hasTools: tools.length > 0,
    hasActions: actions.length > 0,
  });

  const convo: ChatMessage[] = [
    { role: "system", content: system },
    ...messages.slice(-12).map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: String(m.content ?? "").slice(0, 8000),
    })),
  ];

  const { client, model } = await resolveAiClientForTier("standard");
  const start = Date.now();
  const citations: WorkspaceCitation[] = [];
  const proposals: ProposedAction[] = [];
  let full = "";
  let usage: unknown = null;

  const logUsage = (success: boolean, errorMessage?: string): void => {
    const u = readUsage(usage);
    recordAiUsage({
      workload: "copilot",
      model,
      tier: "standard",
      reviewType: WORKLOAD_LABELS.copilot,
      organizationId,
      userId: userId ?? null,
      promptTokens: u.promptTokens,
      completionTokens: u.completionTokens,
      totalTokens: u.totalTokens,
      durationMs: Date.now() - start,
      success,
      ...(errorMessage ? { errorMessage } : {}),
    });
  };

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      // On the final permitted round, forbid further tool calls so the model
      // must produce an answer with whatever it has gathered.
      const allowTools = toolDefs.length > 0 && round < MAX_TOOL_ROUNDS;

      const stream = await client.chat.completions.create(
        {
          model,
          messages: convo as never,
          max_completion_tokens: 1400,
          stream: true,
          stream_options: { include_usage: true },
          ...(allowTools ? { tools: toolDefs, tool_choice: "auto" } : {}),
        },
        signal ? { signal } : undefined,
      );

      let content = "";
      const calls = new Map<number, AssembledToolCall>();
      let finish: string | null = null;

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        const delta = choice?.delta as
          | {
              content?: string | null;
              tool_calls?: {
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }[];
            }
          | undefined;
        if (delta?.content) {
          content += delta.content;
          full += delta.content;
          onDelta(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const cur = calls.get(idx) ?? { id: "", name: "", args: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            calls.set(idx, cur);
          }
        }
        if (choice?.finish_reason) finish = choice.finish_reason;
        if (chunk.usage) usage = chunk.usage;
      }

      // Cap the number of tool calls executed per round so a single round can't
      // fan out unbounded work; we cap BEFORE recording the assistant turn so the
      // tool_call ids and the tool responses we feed back stay in lockstep.
      const toolCalls = [...calls.values()]
        .filter((c) => c.name)
        .slice(0, MAX_TOOL_CALLS_PER_ROUND);
      if (toolCalls.length === 0 || finish !== "tool_calls") {
        // Model produced its answer (already streamed). Done.
        break;
      }

      // Record the assistant's tool-call turn, then execute each tool and feed
      // the results back for the next round.
      convo.push({
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.args },
        })),
      });

      for (const call of toolCalls) {
        const tool = findTool(call.name);
        const action = tool ? undefined : findAction(call.name);
        onStatus?.({
          tool: call.name,
          label: action ? actionStatusLabel(call.name) : toolStatusLabel(call.name),
        });
        if (!tool && !action) {
          convo.push({
            role: "tool",
            tool_call_id: call.id,
            content: `Unknown tool: ${call.name}`,
          });
          continue;
        }
        // Re-check offer at execution time (defense in depth): only offered
        // tools/actions are runnable, and each re-scopes its own query anyway.
        if ((tool && !tools.includes(tool)) || (action && !actions.includes(action))) {
          convo.push({
            role: "tool",
            tool_call_id: call.id,
            content: "You do not have permission to use this.",
          });
          continue;
        }
        let parsed: Record<string, unknown> = {};
        try {
          parsed = call.args ? JSON.parse(call.args) : {};
        } catch {
          parsed = {};
        }

        // --- Sensitive action → PROPOSE (do not execute) ------------------
        if (action && action.sensitive) {
          try {
            const outcome = await action.summarize(req, parsed);
            if ("error" in outcome) {
              convo.push({
                role: "tool",
                tool_call_id: call.id,
                content: `Could not propose ${action.name}: ${outcome.error}`,
              });
            } else {
              const dup = proposals.some(
                (p) =>
                  p.actionName === action.name &&
                  JSON.stringify(p.params) === JSON.stringify(parsed),
              );
              if (!dup) {
                proposals.push({
                  actionName: action.name,
                  params: parsed,
                  summary: outcome.summary,
                });
              }
              convo.push({
                role: "tool",
                tool_call_id: call.id,
                content: `Proposed to the user for confirmation (awaiting their decision — it has NOT run): ${outcome.summary}`,
              });
            }
          } catch (err) {
            logger.warn({ err, action: call.name }, "workspace action proposal failed");
            convo.push({
              role: "tool",
              tool_call_id: call.id,
              content: "That could not be proposed. Continue without it.",
            });
          }
          continue;
        }

        // --- Read tool OR non-sensitive action → execute inline -----------
        try {
          let text: string;
          if (tool) {
            const result = await tool.execute(req, parsed);
            text = result.text;
            citations.push(...result.citations);
          } else {
            const result = await (action as WorkspaceAction).execute(req, parsed);
            text = result.resultText;
            citations.push(...result.citations);
          }
          convo.push({
            role: "tool",
            tool_call_id: call.id,
            content: text.slice(0, MAX_TOOL_RESULT_CHARS),
          });
        } catch (err) {
          logger.warn({ err, tool: call.name }, "workspace tool execution failed");
          convo.push({
            role: "tool",
            tool_call_id: call.id,
            content: "That lookup failed. Continue without it.",
          });
        }
      }
    }

    logUsage(true);
  } catch (err) {
    logUsage(false, err instanceof Error ? err.message : String(err));
    throw err;
  }

  // De-duplicate citations by type+id, preserving first-seen order.
  const seen = new Set<string>();
  const uniqueCitations = citations.filter((c) => {
    const key = `${c.type}:${c.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { answer: full, citations: uniqueCitations, proposals };
}
