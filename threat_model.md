# Threat Model

## Project Overview

Packaging Compliance AI is a single-tenant, multi-user SaaS platform for Dollar Tree employees. Reviewers upload retail product packaging artwork/copy; the system automatically detects regulatory (FDA/EPA/CPSC/FTC/USDA), spelling, grammar, and marketing-claims issues — assigning a letter grade, risk score, and actionable fixes with regulation citations.

**Stack:** Node.js 24 / Express 5 / TypeScript, React + Vite frontend, PostgreSQL + Drizzle ORM, OpenAI (GPT-5.4), Replit Object Storage. Auth via Clerk with a hard domain gate (`dollartree.com`). Deployed as a Reserved VM on Replit.

**Users:** Dollar Tree internal associates (reviewers, admins) and supplier users (restricted to their own submission data).

## Assets

- **Clerk session tokens and MCP bearer tokens** — authenticate user actions; compromise allows impersonation
- **AI provider API keys** — stored AES-256-GCM encrypted (key derived from SESSION_SECRET/AI_KEY_ENCRYPTION_SECRET); compromise allows unauthorized AI usage charges
- **Package compliance data and violation records** — proprietary Dollar Tree trade/product data
- **Regulatory knowledge base** — curated regulation data
- **SESSION_SECRET / AI_KEY_ENCRYPTION_SECRET** — symmetric roots used for session signing, AES key derivation, and MCP HMAC tokens; single-point-of-compromise if leaked
- **Audit trail** — append-only compliance decision history; immutability enforced at DB level

## Trust Boundaries

- **Browser ↔ API (Replit proxy)** — all client requests cross here; Clerk JWT validates identity; domain gate enforces `dollartree.com`-only emails
- **API ↔ PostgreSQL** — Drizzle ORM with parameterized queries; every multi-row query filters by `organizationId` (and `supplierId` for supplier users)
- **API ↔ Replit Object Storage** — pre-signed URLs; no user-supplied remote URLs are fetched server-side
- **API ↔ OpenAI / AI Providers** — configurable provider layer; `baseUrl` is SSRF-validated (HTTPS required, private-IP DNS resolution blocked)
- **MCP gateway ↔ External AI agents** — bearer token (SHA-256 hashed, 192-bit entropy) with per-IP + per-token rate limiting; stateless HMAC confirmation for write actions
- **Authenticated ↔ Unauthenticated** — all `/api` routes except `/api/healthz` and `/api/mcp` (bearer-authed) require Clerk session; rate-limited globally
- **Reviewer ↔ Supplier** — role-based; suppliers see only their own packages; RBAC offer gate enforced in both Workspace and MCP layers

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/index.ts`
- **Highest-risk areas:** `artifacts/api-server/src/lib/rbac/` (auth + access control), `artifacts/api-server/src/lib/mcp/` (external gateway), `artifacts/api-server/src/lib/crypto.ts` (API key encryption), `artifacts/api-server/src/lib/ai-client.ts` (AI provider usage + cost)
- **Public surface:** `/api/healthz` (no auth), `/api/mcp` (bearer token, not Clerk), Clerk proxy path
- **Auth-required surface:** all other `/api/**` routes
- **Admin-only surface:** `/api/users`, `/api/ai-providers`, `/api/ops`, permission management endpoints
- **Dev-only (ignore unless proven reachable):** `artifacts/api-server/src/lib/loadtest.ts` (guarded by `NODE_ENV !== "production"`), `artifacts/mockup-sandbox/`

## Threat Categories

### Spoofing

Clerk handles session authentication with JWT validation. The domain gate (`auth-gate.ts`) enforces `dollartree.com` at the server on every request and permanently deletes non-allowed Clerk accounts on detection. MCP gateway uses opaque bearer tokens (192-bit entropy, only SHA-256 hash persisted). **Guarantee:** Every API request must carry a valid Clerk session or MCP bearer token; domain restriction enforced server-side on every call, not only at login.

### Tampering

All database writes go through Drizzle ORM (parameterized). Package prices and scores are computed server-side; no client-supplied grades or totals are accepted. Permission grants are ceilinged — a user cannot grant permissions they don't hold. MCP write actions use HMAC confirmation tokens bound to `(userId, action, exact-args, expiry)` preventing argument substitution after preview approval. **Guarantee:** No user-supplied value reaches the database unparameterized; business rules are enforced server-side.

### Information Disclosure

API error responses return generic strings; stack traces and DB errors log server-side only. Every multi-record query filters by `organizationId`. Supplier users are additionally filtered by `supplierId`. AI provider API keys are encrypted at rest (AES-256-GCM); only the last-4 and a display prefix are ever returned to the client. The `SESSION_SECRET` is never logged. **Risk:** Single-pass SHA-256 key derivation (no KDF) means encrypted API keys are cheaper to brute-force offline if the DB is dumped and `SESSION_SECRET` is weak. **Guarantee:** Secrets must never appear in logs or API responses; key derivation should use a proper KDF.

### Denial of Service

API endpoints are rate-limited per authenticated user (or per IP when unauthenticated) via `express-rate-limit`. The MCP gateway has a two-layer limiter (per-IP pre-auth + per-token credential limiter). Request body size is capped at 5 MB. External service calls (openFDA, OpenAI) have explicit timeouts. **Guarantee:** Unauthenticated callers must not be able to exhaust per-user rate-limit buckets; resource-intensive operations must not be triggered without authentication.

### Elevation of Privilege

RBAC enforced server-side on every route via `requirePermission` / `requireAnyPermission`. Admin bootstrap: if no `platform_admin` exists, the first sign-in gets the role — mitigated by domain gate (only `dollartree.com` can sign in). Supplier users are explicitly excluded from reviewer/internal endpoints. Org-boundary scoping (`organizationId`) is applied uniformly by `packageConds()`, `loadOwnedPackage()`, and user management queries. MCP gateway only exposes tools the authenticated user is entitled to (RBAC offer gate). **Guarantee:** Role and org checks must be enforced at the server layer on every state-changing endpoint.
