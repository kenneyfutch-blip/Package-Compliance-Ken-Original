# Packaging Compliance AI

An AI-powered packaging compliance operating system: reviewers upload retail product packaging artwork/copy, and the system automatically detects regulatory (FDA/EPA/CPSC/FTC/USDA), spelling, grammar, contextual-language, and marketing-claims issues — assigning a letter grade, risk score, and actionable fixes with regulation citations before production.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (binds to `PORT`)
- `pnpm --filter @workspace/compliance run dev` — run the compliance web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `npx tsx artifacts/api-server/src/seed.ts` — reseed the database (regulations, suppliers, users, notifications, and 6 AI-analyzed demo packages). Runs real OpenAI analysis; takes ~3 min.
- Required env: `DATABASE_URL`; `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY` (OpenAI integration)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + wouter + TanStack Query + shadcn/radix + recharts (`artifacts/compliance`)
- API: Express 5 (`artifacts/api-server`)
- DB: PostgreSQL + Drizzle ORM (`lib/db`)
- AI: OpenAI via `@workspace/integrations-openai-ai-server` (model `gpt-5.4`)
- API codegen: Orval — hooks in `@workspace/api-client-react`, Zod in `@workspace/api-zod`

## Where things live

- API contract (source of truth): `lib/api-spec/openapi.yaml` → run codegen after edits
- DB schema (source of truth): `lib/db/src/schema/` (one table per file, re-exported from `index.ts`)
- Compliance AI engine + copilot prompts: `artifacts/api-server/src/lib/ai.ts`
- Route handlers: `artifacts/api-server/src/routes/` (packages, dashboard, regulations, suppliers, misc)
- Row→API mappers: `artifacts/api-server/src/lib/mappers.ts`
- Seed data: `artifacts/api-server/src/seed.ts`
- Frontend pages/theme: `artifacts/compliance/src/`
- Demo artwork images: `artifacts/compliance/public/artwork/pkg-*.png` (served at `/artwork/...`)

## Architecture decisions

- AI analysis runs synchronously on package create (when artwork text is provided) and on explicit `/analyze`; results (grade, risk, violations, OCR fields, recommendations) are persisted, not recomputed per request.
- Violations carry normalized bbox coords (0–1) that the AI estimates; the review workspace overlays them as color-coded hotspots on the artwork image.
- Copilot is non-streaming (returns answer + citations JSON) for reliability — SSE was intentionally avoided since Orval can't generate typed streaming hooks.
- No real OCR/file parsing yet: analysis runs on pasted/extracted artwork text. Artwork images are illustrative.
- Auth is deferred (no Clerk/Replit auth wired yet).
- The AI engine runs through a configurable provider layer (`ai-client.ts` resolves the active provider), not a hardcoded client. Settings > AI Integrations manages providers; keys are encrypted at rest and `baseUrl` is SSRF-validated. See `.agents/memory/ai-providers.md`.
- Detection is a fixed 8-engine taxonomy (spelling/grammar, contextual language, FDA, EPA, missing disclosures/warnings, packaging formatting, Dollar Tree standards, category regulation) enforced in the `analyzePackaging` prompt.

## Product

Dashboard command center, single + bulk upload, bulk processing queue, split-screen review workspace (artwork proofing viewer with markup + threaded comments + AI color-coded markers + version A/B compare + approval workflow + scorecard), reviews list, regulatory knowledge base, suppliers, reports, audit history, Settings (AI integrations + detection capabilities + users), notifications. Dark + light mode.

## User preferences

- Do not use emojis anywhere in the UI.

## Gotchas

- After editing `lib/api-spec/openapi.yaml`, always run codegen. After editing `lib/db/src/schema/`, run `push`. Rebuild referenced libs (`npx tsc --build lib/db lib/integrations-openai-ai-server`) if the api-server typecheck reports missing `@workspace/db` exports.
- OpenAPI body schemas must be entity-shaped and `$ref`'d (never inline) to avoid TS2308; keep `info.title: Api` and the `/healthz` endpoint.
- Provider API keys are encrypted with `SESSION_SECRET`; rotating it makes stored keys undecryptable (they gracefully fall back to the managed provider).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
