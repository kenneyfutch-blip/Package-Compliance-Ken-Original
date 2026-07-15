# AI Workspace — Architecture & Claude-Readiness

This document describes the AI Workspace: the in-app AI assistant, its dashboard
landing surface, and the provider-agnostic agent layer that lets a different
model vendor (e.g. Anthropic/Claude) be plugged in without rewriting the
orchestration, permissions, or auditing.

## 1. Overview

The AI Workspace is a grounded, tool-calling assistant scoped to a single
organization. A user opens a conversation with a **specialist** persona (general,
packaging, claims, etc.), asks questions, and the assistant answers using
**read tools** (data lookups) and **actions** (state changes). Sensitive actions
are never executed directly — they are proposed and require explicit user
confirmation.

Two surfaces:

- **Assistant** (`/ai-workspace`, `/ai-workspace/:id`) — the chat itself:
  conversation list, specialist selection, streamed answers, citations, and
  action-confirmation cards.
- **Dashboard** (`/ai-workspace/home`) — a landing page aggregating the user's
  recent work and what needs attention, deep-linking back into the app.

## 2. Request flow (one assistant turn)

```
POST /workspace/conversations/:id/stream   (SSE)
  → routes/workspace.ts
      → runWorkspaceAgent()                 (lib/workspace/agent.ts)
          buildAgentToolSurface(req)         permission-scoped tools + actions
          getActiveAgentProvider()           registry → active AgentProvider
            .createSession()                 resolves model + client ONCE
          loop (bounded rounds):
            session.streamTurn(...)          vendor-specific streaming
            execute read tools / non-sensitive actions inline
            intercept sensitive actions → proposals (not executed)
          recordAiUsage(...)                 token/cost telemetry
          recordAgentRun(...)                dashboard "Agent Activity" + audit
  ← streamed deltas, citations, proposals
```

The route persists the assistant message + any proposals in one transaction.
Confirming a proposal later runs the action through an atomic
pending→executing claim (so an action can only fire once).

## 3. Provider-agnostic agent layer

The orchestration loop (tool selection, permission gating, proposal
interception, citation dedup, bounded rounds, telemetry, audit) is **completely
vendor-neutral**. The only vendor-specific work is "stream one assistant turn
given a message history + tool definitions, and report the text and requested
tool calls." That is the single seam.

Files (`artifacts/api-server/src/lib/agents/`):

- **`types.ts`** — `AgentProvider`, `AgentSession`, and the message/tool/turn
  types. `AgentMessage`/tool-def shapes mirror the OpenAI chat contract (the
  dominant tool-calling format); a non-OpenAI provider translates to/from its own
  format inside `streamTurn`.
- **`openai-provider.ts`** — `openAiAgentProvider`, the current active provider.
  Resolves the org's active model/client once per session (via
  `resolveAiClientForTier`) and does all OpenAI-specific streaming + tool-call
  assembly.
- **`registry.ts`** — `registerAgentProvider` / `getAgentProvider` /
  `listAgentProviders` / `getActiveAgentProvider`. Selection is driven by the
  `WORKSPACE_AGENT_PROVIDER` env var; an unknown/unset value safely falls back to
  the built-in OpenAI provider (never breaks chat).
- **`tool-surface.ts`** — `buildAgentToolSurface(req)` assembles the caller's
  permission-scoped read tools + actions into one offer plus JSON-Schema tool
  definitions.

### Adding Claude (the intended extension)

1. Implement an `AgentProvider` (`key: "anthropic"`) whose `createSession()`
   resolves the Claude client + model and returns an `AgentSession` whose
   `streamTurn` calls the Anthropic Messages API, translating the OpenAI-shaped
   message history and tool defs to Anthropic's `tools` / `tool_use` format and
   back into an `AgentTurnResult`.
2. `registerAgentProvider(anthropicAgentProvider)` in `registry.ts`.
3. Set `WORKSPACE_AGENT_PROVIDER=anthropic`.

No change to `runWorkspaceAgent`, the tool surface, permissions, proposals,
citations, usage/cost telemetry, or the audit trail. The provider key is
recorded on every agent run, so activity/telemetry attribute correctly per
vendor.

## 4. Context awareness & conversation memory

- **Page context** — the client passes the current page/record context, injected
  into the system prompt so answers are grounded in what the user is looking at.
- **Conversation memory** — prior turns are replayed from the persisted
  conversation on each request (bounded/truncated for token budget). Memory is
  the durable message history, not hidden server state.
- **Specialists** — persona catalog in `lib/specialists.ts` selects the system
  instructions and suggested prompts per conversation.
- **Grounding** — read tools return real rows + citations; the assistant is
  instructed to answer from tool results, and low-confidence compliance findings
  are never surfaced as definitive violations.

## 5. Dashboard (`GET /workspace/home`)

`routes/workspace-dashboard.ts` aggregates eight sections into a normalized,
openapi-friendly shape (`WorkspaceHome` → `sections[]` → `items[]`) so the UI
renders every section generically:

| Section | Scope | Gate |
|---|---|---|
| Recent Conversations | org + user | always |
| Saved Investigations | org + user (favorited) | always |
| Assigned to You | reviews assigned to user | `packages:read` |
| Recent Reviews | team/scope recent reviews | `packages:read` |
| Recent Reports | org reports | `reports:read` |
| Suggested Actions | user's pending action proposals | always |
| Agent Activity | user's recent agent runs | always |
| Specialist Activity | user's runs grouped by specialist | always |

**The dashboard never widens access** — it only re-surfaces data the user can
already see. Review/report sections reuse the exact permission gates
(`hasPermission`) and tenant/supplier scoping (`packageConds`, `opsTeamScope`) of
the pages they link to. A section the caller cannot see is returned
`visible:false` with no items, so the UI omits it rather than leaking its
existence. Each section resolves independently and degrades to empty on failure,
so one slow query cannot blank the whole page.

## 6. Agent activity & audit

`lib/workspace/agent-activity.ts` `recordAgentRun(req, input)` writes an
org-scoped, user-owned row to `workspace_agent_runs` (provider, model,
specialist, status, tools used, citation/proposal counts, duration, error) and a
`workspace_agent.run` audit event. It is fire-and-forget and fully swallowed on
failure — telemetry must never break or delay the chat. It runs on both the
success and failure paths of `runWorkspaceAgent`, alongside `recordAiUsage`.

## 7. Security

- **RBAC** — every tool/action declares `requiredPerms`; `buildAgentToolSurface`
  only offers what the caller holds, and each tool/action re-checks its own scope
  at execution time (defense in depth).
- **Tenant isolation** — all queries are org-scoped; supplier users are further
  isolated via `packageConds` / `supplierSafe` gates. No cross-tenant data is
  ever offered or returned.
- **No secret/prompt exposure** — system prompts, agent instructions, provider
  keys/credentials, and other tenants' data are never returned to the client. The
  dashboard exposes only the provider label + resolved model name (no keys).
- **Confirmed mutations** — sensitive actions are proposed, not executed;
  confirmation runs through an atomic pending→executing claim so an action cannot
  double-fire.
- **Auditability** — every agent run is audited and attributable to a user, org,
  provider, and model.

## 8. Data & API changes

- **DB** — new `workspace_agent_runs` table (org + user scoped, indexed by
  org/user and conversation).
- **API** — new `GET /workspace/home` (openapi + orval generated hook
  `useGetWorkspaceHome`). Streaming/confirm/cancel remain plain-fetch SSE (not
  expressible in openapi); all other workspace reads go through orval.

## 9. Scalability

- Dashboard sections are bounded (small recent-N limits), independently resolved,
  and failure-isolated.
- Provider sessions resolve the model once per run (not per round).
- Telemetry is fire-and-forget and never on the critical path.
- The agent loop is bounded (max rounds, max tool calls/round, capped tool-result
  size) so a single conversation cannot fan out unbounded work.

## 10. Out of scope (handled elsewhere)

- A live autonomous Claude agent (this lays the seam; the provider impl is a
  follow-up).
- Proving a confirmed action runs exactly once end-to-end.
- Producing a real downloadable report file.
