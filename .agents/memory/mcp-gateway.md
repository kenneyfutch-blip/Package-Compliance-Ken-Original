---
name: MCP gateway
description: External MCP (Model Context Protocol) endpoint + tokens + shared AI tool-call ledger — design invariants.
---

# MCP security gateway

- POST /api/mcp is a stateless JSON-RPC (Streamable HTTP) endpoint, hand-rolled (no SDK dep), mounted BEFORE requireAuth with its own bearer-token auth (`mcp_` sha256-hashed personal tokens, plaintext shown once, soft revoke).
- **One security boundary**: it reuses the workspace tool registry via `availableToolsFor(req)` AND the action registry via `availableActionsFor(req)` as the ONLY lookup paths — an unoffered tool is indistinguishable from a nonexistent one (no capability oracle).
- **Why**: two parallel tool systems would drift and become a security liability.
- **Phase 2 (write actions)**: sensitive workspace actions surface as MCP tools with a two-step confirm flow — first call executes NOTHING, returns preview (action.summarize) + stateless HMAC confirmation token (SESSION_SECRET; bound to userId+action+deep-canonical args, 10-min TTL). Execution requires the token AND atomic single-use consumption via `mcp_confirmations_used` unique-index insert (replay → explicit refusal, never re-execution). Review flagged replayability as blocking — any stateless approval token for writes MUST be paired with a DB-consumed nonce.
- `create_comment` action added (proofs:write, inserts annotation via loadAccessiblePackage scoping) so in-app AI gets it too.
- Token auth resolves via `contextForUserId` (read-only, dies with deactivated users, checks token org == user org). Suppliers can't mint tokens AND are denied the ledger even with an audit:read override.
- Rate limiting must be two-layer: per-IP pre-auth limiter first (rotating bogus Authorization headers cannot mint buckets), then per-credential limiter keyed by sha256 of the full auth header. Review caught the single-limiter version as bypassable.
- Shared ledger table `mcp_tool_calls` records every AI tool call (mcp + in-app workspace source), fire-and-forget, args truncated, result size only (never payload).
- `mcp.registry.test.ts` pins: forbidden-capability name patterns (delete/sql/secret/env/role/...), every tool has requiredPerms, supplier offer gate, supplier denial on ledger/token routes. Any new registry tool must pass it or get explicit security review.
- Admin UI at /admin/mcp (audit:read) — token self-service + ledger.
- OpenAPI gotcha: inline requestBody object schemas generate a `*Body` type that collides with orval's zod `*Body` const → always $ref a named Input schema.
