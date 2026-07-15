---
name: AI Workspace (streaming, specialists, conversations)
description: AI Workspace enhancement layered on the classic assistant panel — durable design decisions & gotchas.
---

# AI Workspace

An ENHANCEMENT layered on the existing stateless assistant panel — the panel must
keep working unchanged (additive only). Built in phases (foundation → live data →
actions → dashboard); this file captures the durable decisions, not the diff.

## Streaming must live OUTSIDE Orval
The typed Orval client cannot express a streaming response, so the SSE endpoint is
hand-written and deliberately EXCLUDED from `openapi.yaml` (CRUD stays in-spec and
codegenned). **Why:** trying to codegen or type a stream response fights the tool.
**How to apply:** any future streaming endpoint = hand-write it + keep it out of
the spec; the web client consumes it with `fetch()` + ReadableStream and
`credentials:"include"` against `/api` (EventSource can't POST; setBaseUrl is
Expo-only, web relies on the proxy routing `/api`).

## SSE client lifecycle is the fragile part (got this wrong once)
Two bugs that will recur if forgotten:
- **Completion must be idempotent.** Server sends an `event: done` frame AND then
  the stream ends — fire the completion callback exactly once (guard flag), or you
  double-invalidate/double-transition.
- **Abort emits nothing.** The helper swallows AbortError silently, so the CALLER
  must clear its own streaming flag and drop/finalize the placeholder turn when it
  aborts (switching conversation / new chat). Otherwise the composer stays
  disabled and the page looks frozen until reload.

## Streaming answers are plain-text only
No JSON envelope, no tool-suggestion cards in the stream. Tool suggestions stay in
the classic panel's non-streaming path. **Why:** streaming structured JSON is
brittle. **How to apply:** if suggestions are wanted in the workspace, do a
separate non-streaming pass; never stream JSON.

## Personas change framing only
Specialists only alter the system-prompt framing — never data access or the tool
catalog. `general` reproduces the classic voice (empty instructions).

## Tenancy & linked records
Conversations are private: every read filters org AND owner userId; delete is soft
(archived). Only package/report/task are linkable and each is validated against the
caller's org — `review_tasks` has NO org column, so validate it via join to its
package's org. Telemetry is fire-and-forget (never fatal to the answer).

## Panel→Workspace handoff persists the transcript
The handoff seeds the new conversation by PERSISTING prior turns as real messages
(bounded), not just loading them into local UI state. **Why:** the stream endpoint
rebuilds model context from DB rows, so local-only seeding loses continuity on
refetch/refresh and hides prior context from the next turn.
