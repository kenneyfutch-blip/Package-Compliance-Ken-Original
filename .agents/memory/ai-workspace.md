---
name: AI Workspace (grounded, permission-scoped)
description: Phase 2 of the AI Workspace — live read-only platform data tools, two-layer tenancy enforcement, streamed tool-calling, attachments, and citations.
---

# AI Workspace — grounded, permission-scoped data access

The Workspace chat runs a server-side tool-calling agent that grounds answers in the
user's real platform data. Read-only registry of data tools lives in
`artifacts/api-server/src/lib/workspace/tools.ts`; the streaming loop is in
`.../workspace/agent.ts`; the route is `.../routes/workspace.ts`.

## Two-layer tenancy enforcement (the security invariant)
Every tool must be safe under BOTH layers; neither alone is the boundary:
1. **Offering layer** — `availableToolsFor(req)` only offers a tool if the caller
   holds ALL its `requiredPerms`. The agent also re-checks `tools.includes(tool)`
   at execution, so the model can neither be offered nor execute a tool outside
   its allowed set (blocks hallucinated tool names too).
2. **Query layer** — every tool re-scopes its own query by org (+ supplier) at
   execution via the shared helpers (`packageConds`, `supplierScopeConds`,
   `retrieveSimilarFindings`'s supplierId arg). Removing a tool from the offered
   set never widens what a query could return.

**`supplierSafe` gate (required field on every tool).** Some tools scope by
organization ONLY, not by supplier (specialist directory, reports, SOPs, audit
trail). Those are `supplierSafe:false` and `availableToolsFor` excludes them for
`roleKey==='supplier_user'` regardless of permission bits — so a misconfigured
supplier role can never reach org-wide internal datasets.
**Why:** permission gating alone is not supplier isolation; an org-only query
handed to a supplier leaks every supplier's data in that org. The field is
required (not optional) so adding a new tool is a compile error until you
consciously declare its supplier safety — this already caught a missed tool.
**How to apply:** any NEW workspace tool must set `supplierSafe`. It's true only
if the query is supplier-scoped (package/supplier/memory-backed) OR the data is
non-tenant reference material (internal regulations, live eCFR, FDA recalls).

## Streamed tool-calling loop
- Accumulate `delta.tool_calls` by index across chunks; `finish_reason==='tool_calls'`
  triggers execution. Content deltas stream live across all rounds.
- Bounded by `MAX_TOOL_ROUNDS` (final round forces tool_choice off) AND
  `MAX_TOOL_CALLS_PER_ROUND` — cap the per-round tool calls BEFORE recording the
  assistant tool-call turn, so tool_call ids and the tool responses fed back stay
  in lockstep (OpenAI requires one tool response per tool_call id).
- Tool results capped (`MAX_TOOL_RESULT_CHARS`). Tool failures are non-fatal:
  push a "that lookup failed, continue without it" tool message.

## Attachments
- Persist typed text in message `content`; store extracted attachment text in the
  `attachments` jsonb (chat bubble stays clean, context survives reloads). Server
  folds attachment text into model history directly from the DB.
- `mapMessage` ships only attachment name/kind to the client, NOT the extracted
  text (avoids large blobs on every conversation load).
- A turn is valid with message text OR ≥1 usable attachment (attachment-only
  "analyze this" is allowed); 400 only when both are empty. Auto-title falls back
  to the first attachment name.
- Client reuses the shared `attachment-extract.ts` pipeline: text/PDF extracted
  client-side, images OCR'd server-side via the assistant extract endpoint.

## Citations
- New nullable `citations` jsonb column on the messages table (additive push).
- Tools return structured citations; agent de-dupes by `type:id`. Emitted as a
  new SSE `citations` event and persisted on the assistant turn. hrefs are
  server-constructed, allowlisted app routes only (no injection surface).
- Also added a `status` SSE event for tool activity. The client ignores unknown
  SSE events, so new event types are backward-compatible.
- **Package citation/nav hrefs must be `/reviews/:id`, NOT `/packages/:id`.** The
  package DETAIL page is the wouter route `/reviews/:id` (ReviewWorkspace).
  `/packages/*` in the web app is only a set of STATIC list routes
  (`/packages/active|needs-review|approved|rejected|archived`) with no `:id`
  param — so a `/packages/123` nav link falls through to NotFound (404).
  `/packages/:id` exists ONLY as an API endpoint on the server; it is not a
  frontend route. When building any citation/suggestion/dashboard href that
  deep-links a package, use `/reviews/${id}` (this is what the dashboard already
  does). **Why:** a code-authored href pointing at the API-style path silently
  404s in the UI. **How to apply:** grep new nav hrefs against `App.tsx` routes,
  never assume `/packages/:id` is navigable.

## Rate limiting
The workspace stream path must be listed in the AI POST-paths regex in
`middlewares/rateLimit.ts` or streamed AI turns bypass the AI rate limiter.

## Phase 3 — actions with confirmation
The Workspace can now PROPOSE and, on explicit user approval, INITIATE platform
actions. Action registry lives in `.../workspace/actions.ts`, alongside the
read-tool registry it mirrors. Actions reuse EXISTING service functions
(assignReview/autoAssignReview, escalateReviewNow, compareVersions, DAO inserts +
writeAudit) — no new business logic, no privilege/tenant bypass.

**Confirmation via tool-call-as-proposal.** Sensitive actions are registered as
model-callable tools, but calling one during the stream does NOT execute it: the
agent runs `action.summarize()` (validates args + resolves human names, org/tenant
scoped), records a proposal, and feeds the model a "surfaced for confirmation,
awaiting decision" tool result so it never claims the action is done. A
`proposed_action` SSE event surfaces a confirm card. Non-sensitive (read-only/
derived) actions execute inline like read tools.
**Why:** state-changing ops must never fire from a model turn alone; the human is
the gate. Modeling the proposal as a tool result keeps the streaming loop's
tool_call/tool_response lockstep intact.

**Authoritative proposal row.** `workspace_action_proposals` (own dedicated table,
NOT inline message jsonb) is the source of truth. The confirm endpoint re-derives
action name + params FROM THE ROW, never the client body — so params cannot be
forged/tampered after proposal. Status pending→executed|cancelled|failed makes
confirm idempotent (double-click can't run twice).

**Three security invariants (all enforced in code, not prompt):**
1. Every state-changing action is `sensitive:true` AND `supplierSafe:false`
   (internal-only) — a supplier is never offered nor allowed one.
2. Confirm re-validates perms + supplier gate via `callerMayRunAction(req, action)`
   independently of what was offered mid-stream (defense in depth).
3. Proposal load is scoped by conversation + org + owner; only the owner can
   confirm/cancel their own pending proposal.
Coverage is unit tests (`actions.authz.test.ts`) — seed has no supplier_user rows,
so supplier isolation can't be curl-tested.

**Confirm/cancel endpoints** are plain JSON POSTs kept OUT of the OpenAPI/orval
codegen (like the stream endpoint) — the client calls them via fetch in
`workspace-stream.ts`. Reflect a successful action back as an assistant result
message with a record link + citation. Derived AI outputs
(draft_approval_notes/prepare_executive_summary) reuse the `copilot` telemetry
workload (no new AiWorkload member needed).

## Phase 4 — provider-agnostic agent layer + dashboard
The workspace agent loop is now vendor-neutral. The ONLY provider-specific seam
is `lib/agents/` (`AgentProvider.createSession()` → `AgentSession.streamTurn()`):
the session resolves model+client ONCE per run and streams each round; the loop
(perm gating, proposal interception, citation dedup, bounded rounds, telemetry,
audit) never changes. Selection is `WORKSPACE_AGENT_PROVIDER` env → registry,
falling back to the built-in OpenAI provider on unknown/unset (never breaks
chat). Adding Claude = implement an AgentProvider, register it, set the env — no
loop change. `buildAgentToolSurface(req)` assembles the perm-scoped read tools +
actions into one offer + JSON-Schema tool defs. Full design in
`docs/ai-workspace-architecture.md`.

**Agent-run telemetry** (`agent-activity.ts` `recordAgentRun`, table
`workspace_agent_runs`) is fire-and-forget + audited, called in BOTH success and
failure paths of `runWorkspaceAgent` alongside `recordAiUsage`; must never
break/delay chat. Org+user scoped; feeds the dashboard's Agent Activity.

**Dashboard `GET /workspace/home`** (`routes/workspace-dashboard.ts`) normalizes
8 sections into `{provider, sections[{key,title,description,visible,items[]}]}`
so the UI renders generically; unauthorized sections come back `visible:false`
empty. Each section resolves independently and degrades to empty on failure (one
slow query can't blank the page).
**The dashboard mirrors each source surface's EXACT scoping — it never widens OR
narrows access.** Key gotcha: the real `/reports` list endpoint (routes/misc.ts)
is scoped by **org + `reports:read` ONLY** (no packageConds/opsTeamScope), so the
dashboard's recentReports must match that — adding package/team scoping there
would be drift, not a security fix (a code-review flagged this as a false leak).
Reviews sections DO apply `packageConds` + `opsTeamScope` because the reviews
surface does. Rule: to decide a dashboard section's scope, read the endpoint it
deep-links to and copy its gate exactly.
**Routing:** dashboard is the landing at `/ai-workspace/home` (nav "AI
Workspace"); chat stays at `/ai-workspace` + `/ai-workspace/:id` (nav "AI
Assistant"), reached from the dashboard's "Open Assistant" button. `/ai-workspace/home`
route must be registered BEFORE `/ai-workspace/:id` (wouter first-match).
