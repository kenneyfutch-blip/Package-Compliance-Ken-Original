// ---------------------------------------------------------------------------
// Provider-agnostic agent abstraction.
//
// The AI Workspace agent (lib/workspace/agent.ts) runs a grounded, tool-calling
// loop: build a system prompt, offer the caller's permission-scoped tools +
// actions, stream an assistant turn, execute any tool calls, feed results back,
// repeat. NONE of that orchestration is vendor-specific. The only vendor-
// specific work is "stream one assistant turn given a message history + tool
// definitions, and tell me what the model said and which tools it wants to
// call". THAT is what an AgentProvider implements.
//
// This is the single seam a future Anthropic/Claude provider plugs into: it
// implements createSession()/streamTurn() against its own API + tool schema,
// registers itself, and is selected via WORKSPACE_AGENT_PROVIDER — the loop,
// permission gating, proposal interception, citation handling, and audit never
// change. See docs/ai-workspace-architecture.md.
// ---------------------------------------------------------------------------

// An assembled tool call the model wants executed before the next turn.
export type AgentToolCall = { id: string; name: string; args: string };

// A chat message in the loop's running transcript. Mirrors the OpenAI chat
// shape (the dominant tool-calling contract); a non-OpenAI provider translates
// this to/from its own format inside streamTurn.
export type AgentMessage =
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

// A function/tool the model may call. `parameters` is a JSON Schema object.
export type AgentToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
};

// The result of streaming a single assistant turn.
export type AgentTurnResult = {
  // Assistant text produced this turn. It has ALSO been delivered incrementally
  // via onDelta; this is the assembled copy.
  content: string;
  // Tool calls the model wants executed before the next turn.
  toolCalls: AgentToolCall[];
  // Raw finish reason ("stop" | "tool_calls" | ...). The loop treats
  // "tool_calls" as "run the tools then continue".
  finishReason: string | null;
  // Opaque token-usage object for telemetry; shape is provider-specific and read
  // leniently (see readUsage in ai-orchestration).
  usage: unknown;
};

export type AgentStreamRequest = {
  messages: AgentMessage[];
  // Omitted/empty on the final round to force the model to answer.
  tools?: AgentToolDef[];
  maxOutputTokens: number;
  // Called with assistant text as it streams in.
  onDelta: (text: string) => void;
  signal?: AbortSignal;
};

// A resolved, bound session for a single agent run. Created once per run so the
// active model/client is resolved a single time (not per round), then reused for
// every streamed turn. This preserves the original single-resolution behavior
// while keeping the vendor call behind the provider boundary.
export interface AgentSession {
  // The provider key that owns this session (for telemetry), e.g. "openai".
  readonly provider: string;
  // The concrete model id resolved for this run, e.g. "gpt-4o".
  readonly model: string;
  // Stream one assistant turn.
  streamTurn(request: AgentStreamRequest): Promise<AgentTurnResult>;
}

export interface AgentProvider {
  // Stable registry key, e.g. "openai".
  readonly key: string;
  // Human-readable label for docs/telemetry, e.g. "OpenAI (managed)".
  readonly label: string;
  // Resolve the active model + client and return a bound session for one run.
  createSession(): Promise<AgentSession>;
}
