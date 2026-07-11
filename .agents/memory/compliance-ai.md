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
- **Auth deferred** — no Clerk/Replit auth yet.

## How to apply
- Reseed with `npx tsx artifacts/api-server/src/seed.ts` (runs real OpenAI; ~3 min). Seed artwork URLs are hardcoded to `/artwork/pkg-N.png` keyed by product.
- If api-server typecheck reports missing `@workspace/db`/openai exports (TS6305/TS2305), rebuild composite refs: `npx tsc --build lib/db lib/integrations-openai-ai-server`.
