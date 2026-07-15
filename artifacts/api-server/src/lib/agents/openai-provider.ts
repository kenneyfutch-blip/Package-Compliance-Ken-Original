import { resolveAiClientForTier } from "../ai-client";
import type {
  AgentProvider,
  AgentSession,
  AgentStreamRequest,
  AgentToolCall,
  AgentTurnResult,
} from "./types";

// The default, currently-active agent provider: the managed, OpenAI-compatible
// model resolved from the organization's active AI configuration (ai-client.ts).
// ALL vendor-specific streaming + tool-call assembly lives here; the
// orchestration loop in lib/workspace/agent.ts is provider-agnostic.
//
// A session resolves the client + model ONCE and closes over them, so a
// multi-round run makes a single active-provider lookup (matching the original
// single-resolution behavior) rather than resolving per round.
export const openAiAgentProvider: AgentProvider = {
  key: "openai",
  label: "OpenAI (managed)",

  async createSession(): Promise<AgentSession> {
    const { client, model } = await resolveAiClientForTier("standard");

    return {
      provider: "openai",
      model,

      async streamTurn(request: AgentStreamRequest): Promise<AgentTurnResult> {
        const stream = await client.chat.completions.create(
          {
            model,
            messages: request.messages as never,
            max_completion_tokens: request.maxOutputTokens,
            stream: true,
            stream_options: { include_usage: true },
            ...(request.tools && request.tools.length
              ? { tools: request.tools as never, tool_choice: "auto" }
              : {}),
          },
          request.signal ? { signal: request.signal } : undefined,
        );

        let content = "";
        const calls = new Map<number, AgentToolCall>();
        let finishReason: string | null = null;
        let usage: unknown = null;

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
            request.onDelta(delta.content);
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
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (chunk.usage) usage = chunk.usage;
        }

        return {
          content,
          toolCalls: [...calls.values()].filter((c) => c.name),
          finishReason,
          usage,
        };
      },
    };
  },
};
