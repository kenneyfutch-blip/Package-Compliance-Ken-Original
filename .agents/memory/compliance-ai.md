---
name: Packaging Compliance AI
description: Product overview, AI pipeline, and non-obvious decisions for the Packaging Compliance AI app.
---

# Packaging Compliance AI

AI packaging-compliance review tool. Reviewers submit product packaging artwork copy; AI detects FDA/EPA/CPSC/FTC/USDA + spelling/grammar/claims issues, assigns grade + risk score, and returns fixes with regulation citations.

## Shape
- Frontend: `artifacts/compliance` (React+Vite). API: `artifacts/api-server` (Express 5). DB: `lib/db` (Drizzle+Postgres).
- AI engine + copilot prompts live in `artifacts/api-server/src/lib/ai.ts`, model `gpt-5.4`, JSON mode.

## Decisions (why)
- **AI runs synchronously** on package create (if artwork text present) and on `/analyze`; results persisted. **Why:** simple, reliable UX over async queue for a demo-scale app.
- **Copilot is non-streaming** (returns `{answer, citations}`). **Why:** Orval can't generate typed hooks for SSE; non-streaming keeps a clean generated hook.
- **Violation bboxes are AI-estimated** normalized 0–1 coords, overlaid as hotspots on artwork image. **Why:** no real OCR/coordinate data; approximate boxes are acceptable for the review viewer.
- **No real file/OCR parsing**; analysis is on pasted "extracted artwork text". Artwork images (`public/artwork/pkg-*.png`) are illustrative, served at `/artwork/...`.
- **Clerk auth gates all API routes** (`requireAuth` middleware after the health route; email-domain allowlist, default `dollartree.com`). `requireAuth` attaches `userId`/`userEmail`/`userName` to the request.
- **Reviewer identity for audit is ALWAYS server-derived**, never from the request body. Use `currentUser(req)` (`api-server/src/lib/identity.ts`) for every `author`/`reviewer`/`createdBy`/`resolvedBy`/audit `actor`. Input schemas must NOT carry identity fields (only content + assignment *targets* like `assignee`). **Why:** client-supplied identity let any signed-in user impersonate another reviewer in comments/approvals/audit — a blocking integrity bug. Guarded by `proofing.impersonation.test.ts`.
- **Engine labels are free-form AI strings**, not a clean enum (e.g. "FTC/Country of Origin", "Spelling/Grammar/Style"). Any grouping (heatmaps, distributions, category filters) MUST normalize via `normalizeEngine()` in `artifacts/compliance/src/lib/compliance.ts` into canonical buckets. **Why:** the model emits varied labels; grouping on raw strings fragments the data.
- **Violation "resolved" is violation-level** (`violations.status` in Resolved/Fixed/Accepted/Closed), NOT package `complianceStatus`. `GET /violations?resolved=true|false` filters on violation status. **Why:** a passed package can still have open findings and vice-versa.
- **`GET /violations`** (global, cross-package) powers the AI Compliance nav section. Selects only needed columns + package context (never full rows — avoids pulling heavy OCR/bbox JSON), severity-ranked ordering with id tie-breaker, `limit`(≤500)/`offset` pagination.

## Navigation (grouped IA)
- Sidebar is grouped + collapsible (`components/layout.tsx`, `NAV` array): Dashboard / Review Queue / Packages / Regulatory Intelligence / AI Compliance / Suppliers / Reports / Audit / Admin. Group auto-opens when it contains the active route.
- Bucket pages reuse one generic `PackagesView` (status/risk filtered); regulatory libraries reuse `RegulatoryLibrary` filtered by agency (`/regulatory/:agency`, sop→Internal). Topbar search pushes `/packages?q=` (read via wouter `useSearch`).

## Proofing & Review Suite
- **AI annotations + review tasks are derived deterministically inside `applyAnalysis`** (packageService.ts), not extra AI calls: every violation → annotation (color by findingClass; passed→status "resolved"); critical/major issue|warning → "Fix:" tasks. Re-analysis deletes only `source:"ai"` annotations + non-done AI tasks, preserving human ones. **Why:** keeps human markup stable across re-scans.
- **Version compare is a live AI call** (`compareVersions`), path-param route `/packages/{id}/compare/{a}/{b}`, not stored. Scorecard computed live in `computeScorecard`.
- **Proof PDF** generated server-side with pdf-lib (`proofPdf.ts`); artwork raster from disk for seed art or downloaded from object storage for uploads; PDF-type artwork skips image embed.
- **Markup coords are normalized 0–1** relative to the media element. Arrows/strikethrough encode direction as signed `w`/`h` deltas from `x,y`; rect/circle/highlight use positive `x,y,w,h`; pin/text use `x,y` only. Viewer maps via `getBoundingClientRect` (handles zoom/pan; rotation is a known skew edge case).
- **Serving artwork in browser**: `servingUrl()` in `lib/proof-utils.ts` maps `/objects/...`→`/api/storage/objects/...` and seed `/artwork/...`→BASE_URL. Both artifacts share an origin via path routing so the browser opens these directly.

## How to apply
- Reseed with `npx tsx artifacts/api-server/src/seed.ts` (runs real OpenAI; ~3 min). Seed artwork URLs are hardcoded to `/artwork/pkg-N.png` keyed by product.
- If api-server typecheck reports missing `@workspace/db`/openai exports (TS6305/TS2305), rebuild composite refs: `npx tsc --build lib/db lib/integrations-openai-ai-server`.
