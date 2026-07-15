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

## Rate limiting
The workspace stream path must be listed in the AI POST-paths regex in
`middlewares/rateLimit.ts` or streamed AI turns bypass the AI rate limiter.
