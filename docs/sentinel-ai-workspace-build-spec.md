# AI Workspace — Full Build & Capabilities Spec (for porting to "Sentinel")

This is the complete, exact specification of the AI Workspace assistant as built
in the Packaging Compliance platform: the prompts (verbatim), the capability
surface (read tools + actions), the orchestration loop, the provider abstraction
(so any model vendor — OpenAI today, Claude later — plugs in), the streaming
contract, the data model, and the security invariants. Hand this to another agent
to rebuild the same capabilities in Sentinel.

Adapt the domain wording (packaging/compliance) to Sentinel's domain, but keep
the **architecture, security invariants, and orchestration contract** intact —
those are what make it grounded, safe, and vendor-portable.

---

## 0. What it is (one paragraph)

A grounded, tool-calling chat assistant scoped to a single organization. A user
opens a conversation under a **specialist persona**, asks questions, and the
assistant answers using **read-only tools** (real data lookups, permission- and
tenant-scoped) and **actions** (state changes). Read/derived actions run inline;
**state-changing actions are never executed by the model — they are proposed and
require explicit human confirmation.** Answers stream token-by-token over SSE
with citations to the real records used. Every run is telemetered and audited. A
separate **dashboard** landing page re-surfaces the user's recent work and what
needs attention, deep-linking back into the app — never widening access.

---

## 1. The system prompt (verbatim)

The prompt is assembled from a fixed base plus optional blocks (tools, actions,
persona, context) that are appended only when applicable. Reproduce this exactly,
swapping the domain nouns for Sentinel's.

### 1.1 Base prompt (always present)

```
You are the AI compliance assistant for a packaging compliance review platform used by retail compliance specialists. Answer questions about packaging, labeling and regulatory compliance (FDA / FTC / CPSC / EPA / USDA / Prop 65 requirements, required warnings and disclosures, claim substantiation, net-quantity statements, ingredient/allergen labeling) accurately and practically, and help users find the right tool in the app.

Be warm, concise and practical. Write a clear, well-structured plain-text answer (short paragraphs or bullet points where helpful). When a specific in-app tool would help, mention it by name and reference its path from this catalog — never invent paths:
{TOOL_CATALOG}

If you are not certain about a specific regulation or citation, say so plainly rather than guessing, and point the user to the Regulatory Library for authoritative text. Never state an uncertain requirement as if it were definitive. Do not use emojis.
```

`{TOOL_CATALOG}` is a newline list of the app's navigable tools, each rendered as
`- {label} ({href}): {description}`. This is the **navigation catalog** (where to
send users), distinct from the callable tools in §2. The model is told never to
invent paths — only cite from this catalog.

### 1.2 Tools block (appended only when the caller has ≥1 read tool)

```
You have READ-ONLY tools that fetch the user's real platform data (packages, findings, regulations, compliance memory, specialists, tasks, suppliers, reports, SOPs, audit trail, recalls). Every tool is already scoped to exactly what THIS user is permitted to see — never claim you cannot see data for permission reasons without trying the relevant tool first. Use tools whenever the user asks about their actual data ("my packages", "which suppliers", "what findings", "who can review…"); do NOT invent records, ids, statuses or citations. If a tool returns nothing, say so plainly. Ground factual claims about specific records in tool results, and prefer citing the specific records you used. For general regulatory/compliance knowledge you may answer directly. Do not call tools for pure greetings or general how-to questions.
```

### 1.3 Actions block (appended only when the caller has ≥1 action)

```
You can also take ACTIONS on the user's behalf when they clearly ask you to (e.g. "assign this to Dana", "escalate it", "create a task", "generate a report", "summarize the findings", "compare the versions").
- Read-only/derived actions (summarize_findings, draft_approval_notes, compare_versions, prepare_executive_summary) run immediately and their output is returned to you — weave it into your answer.
- State-changing actions (create_review, assign_reviewer, escalate_review, create_task, generate_report) are NOT executed when you call them. Calling one PROPOSES it to the user, who must explicitly confirm before it runs. When you call such an action, tell the user plainly what you have proposed and that it is awaiting their confirmation. NEVER claim a state-changing action is done — it only happens after they confirm. Resolve real ids first (e.g. call list_specialists to get a specialistId before assign_reviewer). Do not propose the same action twice.
```

### 1.4 Persona block (appended when a non-general specialist is selected)

```
Persona: {specialist.label}. {specialist.instructions}
```

### 1.5 Context block (appended when page/record context exists)

```
Current context (use only if relevant):
The user has linked this record to the conversation: {linkedRecordLabel}.
The user is currently viewing: {pageTitle} ({pagePath}).
Context summary: {summary, truncated to 1200 chars}
```

**Key prompt-engineering principles baked in (keep these in Sentinel):**
- Anti-hallucination: never invent records/ids/statuses/citations; if a tool
  returns nothing, say so.
- Try-before-refuse: never claim "I can't see that" for permission reasons
  without first attempting the relevant tool (tools are pre-scoped).
- Uncertainty honesty: never state an uncertain requirement/fact as definitive;
  point to the authoritative source.
- Never claim a state-changing action is done — only proposed, pending
  confirmation.
- No emojis; plain-text, well-structured output.

---

## 2. Capability surface

Two registries. Each entry declares `requiredPerms` (RBAC gate) and `supplierSafe`
(tenant-isolation gate). Actions additionally declare `sensitive`.

### 2.1 Read-only tools (data lookups)

| Tool | requiredPerms | supplierSafe | Purpose |
|---|---|---|---|
| `search_packages` | `packages:read` | yes | Free-text search packages (name/SKU/brand/vendor), filter by status/category. |
| `get_package_details` | `packages:read` | yes | Full detail for one package id. |
| `search_findings` | `violations:read` | yes | Search findings/violations by severity etc. |
| `search_regulations` | `regulations:read` | yes | Search the curated regulatory library. |
| `search_federal_regulations` | `regulations:read` | yes | Plain-English semantic search over federal regs (eCFR). |
| `search_compliance_memory` | `violations:read` | yes | Recall past findings/fixes (vector memory). |
| `list_specialists` | `specialists:read` | **no** | Reviewer directory (resolve ids/names). |
| `search_tasks` | `packages:read` | yes | Search review tasks. |
| `list_suppliers` | `suppliers:read` | yes | List/search suppliers. |
| `list_reports` | `reports:read` | **no** | List generated compliance reports. |
| `search_sop_documents` | `policies:read` | **no** | Search internal SOP documents. |
| `search_audit_trail` | `audit:read` | **no** | Search the audit event log. |
| `search_recalls` | `fda:read` | yes | Search FDA recalls (food/drug/device). |

### 2.2 Actions (state changes + derived outputs)

**State-changing (`sensitive: true`, `supplierSafe: false`) — PROPOSED, never
auto-executed:**

| Action | requiredPerms | Purpose |
|---|---|---|
| `create_review` | `packages:write` | Open a review on a package. |
| `assign_reviewer` | `packages:write` | Assign a specialist (needs a real specialistId). |
| `escalate_review` | `packages:write` | Escalate a package's review. |
| `create_task` | `packages:write` | Create a task on a package. |
| `generate_report` | `reports:write` | Generate a compliance report. |

**Read-only / derived (`sensitive: false`, `supplierSafe: true`) — run inline:**

| Action | requiredPerms | Purpose |
|---|---|---|
| `summarize_findings` | `violations:read` | Summarize a package's findings. |
| `draft_approval_notes` | `packages:read` | Draft internal approval/decision notes. |
| `compare_versions` | `packages:read` | Diff two artwork versions. |
| `prepare_executive_summary` | `packages:read` | Leadership-level summary. |

Each tool/action is exposed to the model as a JSON-Schema tool definition (name,
description, parameter schema). The model calls them by name; the loop executes
or proposes them.

---

## 3. Specialist personas (the persona catalog)

Each conversation selects one persona, which sets the persona block instructions
and suggested prompts. Verbatim instructions:

- **general** — General Assistant. *(no extra instructions — base prompt only.)*
- **compliance** — Compliance Analyst.
  > Act as a senior packaging compliance analyst. When discussing findings, explain severity, likely root cause and concrete remediation steps a reviewer can take. Prefer precise, checklist-style guidance. Always distinguish a definitive requirement from a cautious recommendation.
- **regulatory** — Regulatory Expert.
  > Act as a regulatory affairs expert for consumer packaging (FDA, FTC, CPSC, EPA, Prop 65). Cite the relevant agency and general rule area when you can, but never fabricate a specific citation. If you are unsure of an exact CFR section, say so and point the user to the Regulatory Library for authoritative text.
- **packaging_engineer** — Packaging Engineer.
  > Act as a packaging engineer. Focus on the practical mechanics of artwork and print files (dielines, bleed, legibility, minimum type sizes, panel layout) as they intersect with regulatory placement requirements. Be concrete and actionable.
- **packaging_reviewer** — Packaging Reviewer.
  > Act as an experienced packaging reviewer. Focus on the review workflow: triaging queues, assigning specialists, escalating risky items, and clearing packages efficiently while maintaining an audit trail.
- **claims** — Claims Specialist.
  > Act as a marketing-claims compliance specialist. Focus on whether packaging claims are substantiated and lawful (e.g. 'natural', 'organic', 'clinically proven', health claims). Flag high-risk claims and explain the substantiation or disclosure they require.
- **executive** — Executive Briefer.
  > Act as an executive briefer. Answer at a leadership altitude: summarize risk, trends and business impact in plain language, lead with the bottom line, and keep detail minimal unless asked. Avoid jargon.
- **agent_router** — Workspace Router.
  > Act as a routing assistant. Your priority is to understand the user's goal and point them to the single best tool or specialist for it. Keep answers short and always include a concrete next step.

Each persona also ships 3 suggested prompts to seed the empty state.

---

## 4. Orchestration loop (the vendor-neutral core)

One assistant turn = a bounded, tool-calling loop. Reproduce this exactly; it is
where grounding, safety, and correctness live.

```
POST /workspace/conversations/:id/stream   (Server-Sent Events)
  → runWorkspaceAgent():
      buildAgentToolSurface(req)      → permission-scoped { tools, actions, toolDefs }
      getActiveAgentProvider()        → registry → active AgentProvider
        .createSession()              → resolves model + client ONCE per run
      history = [system prompt, ...persisted conversation turns, new user turn]
      for round in 0..MAX_TOOL_ROUNDS:
        result = session.streamTurn({ messages, tools: toolDefs (off on final round), onDelta })
          - stream content deltas to the client live
          - assemble tool_calls by index across chunks
        if result has tool calls:
          cap to MAX_TOOL_CALLS_PER_ROUND  (BEFORE recording the assistant turn)
          record the assistant tool-call turn in history
          for each tool call:
            - if unknown / not in offered set  → error tool result (blocks hallucinated tools)
            - if read tool                     → execute (re-scoped by org/supplier), push tool result
            - if non-sensitive action          → execute inline, push result
            - if sensitive action              → summarize + record a PROPOSAL; push
                                                 "surfaced for confirmation, awaiting decision" result
                                                 (NEVER executed here)
          continue loop
        else:
          break with final content
      dedupe citations; persist assistant message (+ proposals) in ONE transaction
      recordAiUsage(...)              (token/cost telemetry — fire-and-forget)
      recordAgentRun(...)            (dashboard activity + audit — fire-and-forget)
```

**Bounds (tune per platform, keep them finite):**
- `MAX_TOOL_ROUNDS = 4` — on the final round, tools are turned off so the model
  must produce a text answer.
- `MAX_TOOL_CALLS_PER_ROUND = 6` — cap **before** recording the assistant
  tool-call turn, so tool_call ids and the tool responses fed back stay in
  lockstep (the API requires exactly one tool response per tool_call id).
- `MAX_TOOL_RESULT_CHARS = 6000` — truncate each tool result fed back.
- `maxOutputTokens = 1400` per turn.

**Tool-failure handling:** a failing tool is non-fatal — push a "that lookup
failed, continue without it" tool message so the model recovers gracefully.

---

## 5. Provider abstraction (OpenAI now, Claude later — the whole point)

The orchestration above is **completely vendor-neutral**. The only vendor-specific
work is a single seam: "stream one assistant turn given a message history + tool
definitions; report the text and requested tool calls." Everything else (tool
selection, permission gating, proposal interception, citation dedup, bounded
rounds, telemetry, audit) never changes across vendors.

### 5.1 The interface

```ts
interface AgentProvider {
  key: string;                 // "openai" | "anthropic" | ...
  label: string;               // human label, shown on the dashboard
  createSession(): Promise<AgentSession>;   // resolves model + client ONCE
}

interface AgentSession {
  provider: string;
  model: string;               // resolved model id (shown, never keys)
  streamTurn(request: AgentStreamRequest): Promise<AgentTurnResult>;
}

interface AgentStreamRequest {
  messages: AgentMessage[];    // OpenAI-shaped chat history (the lingua franca)
  tools?: AgentToolDef[];      // JSON-Schema tool defs (omit/empty to force text)
  maxOutputTokens: number;
  onDelta: (text: string) => void;   // stream content to the client
  signal?: AbortSignal;        // client-cancel support
}

interface AgentTurnResult {
  content: string;
  toolCalls: { id: string; name: string; args: string }[];
  finishReason: string | null;
  usage: unknown;              // provider usage payload for telemetry
}
```

Message/tool shapes mirror the OpenAI chat-completions contract because it is the
dominant tool-calling format. A non-OpenAI provider translates to/from its own
format **inside `streamTurn`** — the loop never sees vendor differences.

### 5.2 Registry + selection

- `registerAgentProvider(p)` / `getActiveAgentProvider()` / `listAgentProviders()`.
- Active provider chosen by env `WORKSPACE_AGENT_PROVIDER` (default `openai`).
- **Unknown/unset value safely falls back to the built-in default — never breaks
  chat.**
- The provider `key` is recorded on every agent run, so telemetry/activity
  attribute correctly per vendor.

### 5.3 Current provider (what powers it today)

OpenAI, managed through Replit's AI Integrations proxy (no personal API key). The
model is resolved from the org's active AI configuration at the "standard" tier
(currently `gpt-5.4`). The OpenAI provider resolves client+model once per session
and does all OpenAI-specific streaming + tool-call assembly.

### 5.4 Adding Claude (the intended extension — one file)

1. Implement `AgentProvider` with `key: "anthropic"`; `createSession()` resolves
   the Claude client + model; `streamTurn` calls the Anthropic Messages API,
   translating the OpenAI-shaped history + tool defs to Anthropic's
   `tools` / `tool_use` format and back into an `AgentTurnResult`.
2. `registerAgentProvider(anthropicAgentProvider)`.
3. Set `WORKSPACE_AGENT_PROVIDER=anthropic`.

No change to the loop, tools, permissions, proposals, citations, telemetry, or
audit. Do **not** ship a non-functional stub before the client exists — an
un-runnable placeholder can break the fallback path.

---

## 6. Streaming contract (SSE)

The stream/confirm/cancel endpoints are plain-fetch SSE (not expressible in
OpenAPI); all other reads go through the typed API. SSE event types:

- **content delta** — token text, appended live to the assistant bubble.
- `status` — tool-activity notices (e.g. "Looking up packages…").
- `citations` — structured citations for the records used (deduped by `type:id`),
  persisted on the assistant turn; hrefs are **server-constructed, allowlisted app
  routes only** (no injection surface).
- `proposed_action` — a confirm card for a pending sensitive action.

Clients must **ignore unknown event types** so new events are backward-compatible.

---

## 7. Actions & confirmation model (the safety spine)

- Sensitive actions are registered as model-callable tools, but calling one during
  the stream does **not** execute it. The loop runs `action.summarize()`
  (validates args + resolves human names, org/tenant-scoped), records a proposal
  row, and feeds the model a "surfaced for confirmation, awaiting decision" tool
  result — so the model can never claim it's done.
- The proposal is stored in its **own table** (not inline message JSON) and is the
  source of truth. The confirm endpoint **re-derives the action name + params from
  the row, never the client body**, so params cannot be forged after proposal.
- Status `pending → executed | cancelled | failed` makes confirm **idempotent** (a
  double-click can't run the action twice); execution goes through an atomic
  pending→executing claim.
- Confirm re-validates permission + tenant gate independently of what was offered
  mid-stream (defense in depth).
- A confirmed action is reflected back as an assistant result message with a
  record link + citation.

**Three invariants (enforced in code, not by the prompt):**
1. Every state-changing action is `sensitive: true` AND `supplierSafe: false`
   (internal-only) — an isolated tenant is never offered nor allowed one.
2. Confirm re-checks perms + tenant gate independently of the offer.
3. Proposal load is scoped by conversation + org + owner; only the owner can
   confirm/cancel their own pending proposal.

---

## 8. Grounding, context & memory

- **Grounding:** read tools return real rows + citations; the model is instructed
  to answer factual/record claims from tool results, and low-confidence findings
  are never surfaced as definitive (enforced in code, not just prompt).
- **Page context:** the client passes the current page/record context, injected
  into the system prompt (context block) so answers are grounded in what the user
  is viewing. A linked record label can pin a record to the conversation.
- **Conversation memory:** prior turns are replayed from the persisted
  conversation each request (bounded/truncated for token budget). Memory is the
  durable message history, not hidden server state.
- **Attachments:** typed text lives in message `content`; extracted attachment
  text is stored in an `attachments` JSONB column (chat bubble stays clean,
  context survives reloads). The client bubble ships only attachment name/kind,
  never the extracted text. A turn is valid with text OR ≥1 usable attachment.

---

## 9. Security & tenancy invariants (do not compromise when porting)

- **Two-layer enforcement — neither alone is the boundary:**
  1. **Offering layer:** the tool/action surface only offers an entry if the
     caller holds ALL its `requiredPerms`; the loop re-checks membership at
     execution (blocks hallucinated tool names).
  2. **Query layer:** every tool re-scopes its own query by org (+ tenant/supplier)
     at execution. Removing a tool from the offer never widens what a query could
     return.
- **`supplierSafe` (tenant-isolation) gate — required on every tool/action:**
  org-only datasets (directory, reports, SOPs, audit) are `supplierSafe:false` and
  are excluded for isolated-tenant roles regardless of permission bits. The field
  is **required** (a compile error until set) so a new tool can't silently leak.
- **No secret/prompt exposure:** system prompts, instructions, provider
  keys/credentials, and other tenants' data are never returned to the client. Only
  the provider label + resolved model name are exposed.
- **Auditability:** every agent run is audited and attributable to user, org,
  provider, and model.
- **Rate limiting:** the streaming path must be included in the AI rate-limiter
  path matching, or streamed turns bypass the limiter.

---

## 10. Telemetry & activity

- **Usage/cost telemetry** (`recordAiUsage`) — real-calls-only ledger; identity
  via async-local-storage in the auth middleware; fire-and-forget so logging
  failures never break the AI path; cost is a rate-card estimate.
- **Agent-run activity** (`recordAgentRun`) — org-scoped, user-owned row per run:
  provider, model, specialist, status, tools used, citation/proposal counts,
  duration, error. Fire-and-forget + audited; runs on **both** success and failure
  paths. Feeds the dashboard's Agent Activity / Specialist Activity.

---

## 11. Dashboard landing (`GET /workspace/home`)

Aggregates 8 sections into a normalized shape so the UI renders generically:
`{ provider:{key,label,model}, sections:[{ key,title,description,visible,items:[
{ id,title,subtitle,href,badge,timestamp } ] }] }`.

| Section | Scope | Gate |
|---|---|---|
| Recent Conversations | org + user | always |
| Saved Investigations | org + user (favorited) | always |
| Assigned to You | reviews assigned to user | `packages:read` |
| Recent Reviews | team/scope recent reviews | `packages:read` |
| Recent Reports | org reports | `reports:read` |
| Suggested Actions | user's pending proposals | always |
| Agent Activity | user's recent agent runs | always |
| Specialist Activity | user's runs grouped by specialist | always |

**Never widens access:** it only re-surfaces data the user can already see.
Cross-record sections reuse the *exact* permission gates and tenant/team scoping
of the pages they link to (resolved through one pure access plan, so scoping can't
drift). A section the caller can't see returns `visible:false` with no items (the
UI omits it rather than leaking its existence). Each section resolves
independently and **degrades to empty on failure**, so one slow query can't blank
the page.

**Routing:** dashboard is the landing (`/ai-workspace/home`); chat is
`/ai-workspace` + `/ai-workspace/:id`. Register the `/home` route BEFORE the
`/:id` route (first-match routing).

---

## 12. Data model (minimum tables)

- **conversations** — id, org, user, title, specialist key, favorite, archived,
  linked-record label, timestamps.
- **messages** — id, conversation, role, content, `attachments` JSONB (extracted
  text), `citations` JSONB (nullable), timestamps.
- **action proposals** — id, org, user, conversation, action name, params, summary,
  status (`pending|executed|cancelled|failed`), timestamps. Own table; source of
  truth for confirmation.
- **agent runs** — id, org, user, conversation, provider, model, specialist,
  status, tools used (JSONB), citation/proposal counts, duration, error,
  created-at. Indexed by org/user and conversation.

---

## 13. Port checklist for Sentinel

1. Swap the base prompt's domain nouns to Sentinel's; keep the anti-hallucination,
   try-before-refuse, uncertainty-honesty, and "never claim an action is done"
   rules verbatim.
2. Define Sentinel's read tools and actions; set `requiredPerms` + `supplierSafe`
   (or your tenancy field) on every one; mark state-changing actions
   `sensitive:true`.
3. Build the tool surface (offer only what the caller may hold) + JSON-Schema tool
   defs.
4. Implement the bounded orchestration loop with the exact tool_call/tool_result
   lockstep and the caps in §4.
5. Implement the provider interface (§5); ship the OpenAI (or your default)
   provider first; gate selection behind an env var with a safe fallback.
6. Implement the SSE contract (§6) and the confirmation model + proposal table
   (§7) with server-side re-derivation and idempotent confirm.
7. Enforce the two-layer security model and the required tenancy gate (§9).
8. Add fire-and-forget usage + agent-run telemetry (§10) on both success and
   failure paths.
9. Build the dashboard (§11) that mirrors — never widens — existing access, with
   per-section failure isolation.
10. When Claude access exists, add the Anthropic provider file and flip the env
    var (§5.4) — nothing else changes.
```
