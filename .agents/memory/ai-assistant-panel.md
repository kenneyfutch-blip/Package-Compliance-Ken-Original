---
name: AI Assistant side panel
description: Slide-in "find the right tool" AI chat that splits the screen; how it's wired and the non-obvious decisions.
---

# AI Assistant side panel

A right-side slide-in chat that helps users pick the right tool for a task. Opened from an "Ask AI" header button; it is meant to eventually be Claude-powered but currently rides the active AI provider.

## Split-screen (not overlay)
The panel pushes the whole app left rather than overlaying it. Achieved with a flex wrapper in the `Shell`: an outer `flex h-screen overflow-hidden`, a main column (`flex-1 min-w-0`) holding the original sidebar+content, and the panel as a sibling `<aside>` whose **width transitions** (`w-0` ↔ `w-[400px]`) so flexbox reclaims/gives space.
**Why:** width-transition on a flex sibling gives a smooth split without absolute positioning or reflowing the main content. The panel keeps a fixed-width inner shell so its contents don't reflow while animating.

## Tool catalog is server-side + href-allowlisted
The list of recommendable tools (label/href/description) lives in the AI system prompt on the server (in `ai.ts`), and the model's returned suggestion hrefs are hard-filtered against that allowlist before the client renders/navigates them.
**Why:** prevents the model from inventing routes or emitting external/open-redirect links. Keep this catalog in sync with the left-nav sections when tools are added/removed.

## Telemetry workload reuse
The assistant reuses the existing `copilot` `AiWorkload` for usage tracking instead of adding a new workload value.
**Why:** adding an `AiWorkload` member ripples through the union + label maps; reuse avoids that churn. Revisit only if assistant cost needs to be broken out separately from copilot.

## Document attachments ("add documents")
The composer's `+` attaches files whose text is extracted client-side then injected into the outgoing chat message as context. Extraction by type: text files read directly; PDFs via pdfjs text layer (no AI round-trip; scanned/no-text PDFs are rejected with a friendly message — no rasterize-to-OCR fallback); images downscaled then OCR'd server-side. The chat message keeps `content` (display-safe, shown in the bubble) separate from `apiContent` (display + `--- Attached document ---` blocks) and sends `apiContent ?? content` for every turn so document context survives across the conversation without dumping raw text into the UI.

## New AI/OCR endpoints must join the strict AI rate limiter
The app's rate limiting is centralized: a single dispatcher matches request paths against `AI_POST_PATHS` regexes in `rateLimit.ts` and routes matches to the strict `aiLimiter`; everything else falls through to a much looser general limit. There is **no** per-route limiter middleware.
**Why:** a new AI/OCR endpoint (e.g. the assistant's image-extract route) that is open to all authed users but *not* added to `AI_POST_PATHS` silently gets the loose limit → cost/DoS abuse vector. This was caught in review for `/assistant/extract`.
**How to apply:** whenever you add a POST endpoint that calls an LLM or multimodal/OCR model, add its path to `AI_POST_PATHS` in the same change.

## Auth / suppliers
`POST /assistant/chat` sits behind the global `requireAuth` only — no `requirePermission` — so it's open to all authed users incl. `supplier_user`. Safe because it reads no tenant business data (static catalog + caller messages; orgId used only for telemetry). Worst case a supplier is suggested a page they can't open (UX noise). If that matters, filter the catalog by permission.
