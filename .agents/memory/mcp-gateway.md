---
name: MCP gateway
description: External MCP (Model Context Protocol) endpoint + tokens + shared AI tool-call ledger — design invariants.
---

# MCP security gateway

- POST /api/mcp is a stateless JSON-RPC (Streamable HTTP) endpoint, hand-rolled (no SDK dep), mounted BEFORE requireAuth with its own bearer-token auth (`mcp_` sha256-hashed personal tokens, plaintext shown once, soft revoke).
- **One security boundary**: it reuses the workspace tool registry via `availableToolsFor(req)` as the ONLY lookup path — an unoffered tool is indistinguishable from a nonexistent one (no capability oracle). Read-only by deliberate phase-1 decision (user chose read-only first; write tools = phase 2 with confirmation semantics).
- **Why**: two parallel tool systems would drift and become a security liability; token boundary proven with read traffic before write power.
- Token auth resolves via `contextForUserId` (read-only, dies with deactivated users, checks token org == user org). Suppliers can't mint tokens AND are denied the ledger even with an audit:read override.
- Rate limiting must be two-layer: per-IP pre-auth limiter first (rotating bogus Authorization headers cannot mint buckets), then per-credential limiter keyed by sha256 of the full auth header. Review caught the single-limiter version as bypassable.
- Shared ledger table `mcp_tool_calls` records every AI tool call (mcp + in-app workspace source), fire-and-forget, args truncated, result size only (never payload).
- `mcp.registry.test.ts` pins: forbidden-capability name patterns (delete/sql/secret/env/role/...), every tool has requiredPerms, supplier offer gate, supplier denial on ledger/token routes. Any new registry tool must pass it or get explicit security review.
- Admin UI at /admin/mcp (audit:read) — token self-service + ledger.
- OpenAPI gotcha: inline requestBody object schemas generate a `*Body` type that collides with orval's zod `*Body` const → always $ref a named Input schema.
