---
name: Google Document AI extraction
description: Enterprise OCR/extraction layer — trigger contract, hash-based cache, three-service separation, SSRF boundary.
---

# Google Document AI extraction

Enterprise document extraction layer for the Packaging Compliance AI product.
Separate from reasoning and validation by deliberate design.

## Extraction is provider-based (OCR provider abstraction)
Document extraction runs through an `OcrProvider` interface + registry (`lib/document-ai/providers/{types,google,openai,registry}.ts`), not a hardwired vendor. `getActiveProvider()` selects via env `OCR_PROVIDER` (warn+fallback on unknown). Callers (`service.runExtraction`, `policies/extract`, status route) depend only on the interface — adding a provider = implement `OcrProvider` + register in `registry.ts`, no caller/route/DB changes.
**Why:** avoid future architectural redesign; activation of any provider = just add its config.
**How to apply:** never re-hardcode a provider id in callers — use `provider.id` (persisted to `document_extractions.engine` / `packages.extractionEngine`; it's a permanent contract value, renaming orphans cached rows). Use `provider.supportedMimeTypes()` / `provider.normalizeMimeType()` / `provider.isConfigured()` / `provider.process()` / `provider.label`. `config.ts`/`client.ts` stay Google-specific behind the google adapter; `components.ts` heuristics are shared by both providers.

## DEFAULT provider is OpenAI Vision (not Google)
`DEFAULT_PROVIDER_ID = "openai-vision"`. The OpenAI Vision provider (`providers/openai.ts`) transcribes images (`image_url` part) and PDFs (chat `file` content part) via `runOpenAiOcr()` in `lib/ai.ts` — which rides on the ACTIVE AI provider (user's key, else Replit-managed fallback), reusing `resolveAiClientForTier('standard')` + `trackDirectUsage` (workload `ocr`). It derives components from the transcript with the shared `extractHeuristicComponents`, `confidence=null`, one synthetic page, `pageCount` via `pdf-lib` for PDFs. `isConfigured()` is hardcoded `true` (AI client always resolves); runtime failures (e.g. a custom endpoint lacking multimodal support) are caught by `runExtraction` → status `Failed`. Google Document AI stays registered and is re-selectable with `OCR_PROVIDER=google-document-ai`. Verified working: image reprocess produced Complete rows with `engine=openai-vision`, `processor=openai-vision:<model>`, real text.
**Why:** user wanted OCR done by their OpenAI model, not Google, but keep Google wired for future. Also Google was never configured (no `GOOGLE_*` secrets) so OCR had been a silent no-op — OpenAI default makes extraction actually run.
**How to apply:** the `/document-ai/status` shape is unchanged, but its four `*Configured` booleans are Google-credential flags — the OpenAI provider returns them ALL `false` (truthful) and every UI card (`document-ai-status-card`, `document-ai-tab`, `admin/integrations`) branches on `status.engine === "google-document-ai"` to hide the Google credential checklist for non-Google engines. Keep UI provider-aware; never hardcode "Google Document AI" copy again.

## `/document-ai/status.configured` = ACTIVE provider, not Google-specific
`extractionStatus()` (status route) returns `getActiveProvider().status()`. The default OpenAI Vision provider hardcodes `configured: true`, so a bare `status.configured` check is TRUE even when Google Document AI has zero credentials. Any UI feature that must gate on "Google Document AI specifically is set up" (e.g. the review-workspace AI-annotation toggle — AI pin geometry is only trustworthy from Google word boxes) must check `status.engine === "google-document-ai" && status.configured === true`, NOT `configured` alone.
**Why:** gating on bare `configured` opened the AI-annotation toggle under the default OpenAI engine, surfacing untrustworthy synthetic pins — the exact thing the gate was meant to prevent (see proof-annotation-accuracy.md).
**How to apply:** the generated `DocumentAiStatus` exposes `{ configured: boolean; engine: string }`; both nav/card UIs already branch on `engine === "google-document-ai"` — follow that pattern for any new Google-only gate. UI gate is layered: force marker visibility off + disable the toggle + no-op the handler when not ready.

## Three-service separation (do not merge)
- **Extraction** = Google Document AI (the only thing that produces OCR text + page coords + components).
- **Reasoning** = OpenAI `analyzePackaging` (reads `packages.extractedText`).
- **Validation** = FDA/EPA/regulations.
The handoff is one-directional: extraction writes `packages.extractedText`, then reasoning consumes it. Extraction never calls OpenAI; reasoning never calls Document AI.

## Trigger contract (strict)
Document AI runs on ONLY three triggers: new package upload, new version (proof) upload, manual reprocess.
**Why:** cost + the spec forbids re-running on read paths.
**How to apply:** any new read/view/review endpoint must NOT call `runExtraction`. The `GET /packages/:id/extraction[s]` routes are read-only and return cached rows. `runExtraction` is the single chokepoint that invokes the processor.

## Cache is content-hash-driven, not "latest row"
Cache key = sha256 of the source document bytes, scoped to the package. A cache hit requires a **Complete** extraction row whose `sourceHash` matches — not merely the latest complete row. Skipping this (comparing only the latest row's hash) breaks "same bytes never re-run" when a newer row has a different hash.
**Why:** an earlier implementation compared only the latest Complete row and re-ran Document AI incorrectly.

## Graceful degradation when unconfigured
Four env vars gate everything: `GOOGLE_PROJECT_ID`, `GOOGLE_LOCATION`, `DOCUMENT_AI_PROCESSOR_ID`, `DOCUMENT_AI_SERVICE_ACCOUNT` (JSON key). `isDocumentAiConfigured()` returns true only when all four present. Unconfigured => extraction is a no-op setting package `extractionStatus='NotConfigured'`; create-flow falls back to any text supplied at upload. Client is constructed lazily (import is side-effect free). Service account private_key needs `\\n` -> newline normalization. Status endpoint exposes only booleans + region, never the key.

## SSRF boundary on source resolution
Extraction sources are ONLY: trusted object-storage `/objects/...` paths and inline `data:` URLs (both minted/validated by this server). Do NOT add a branch that server-side `fetch()`es arbitrary `http(s)` artwork URLs — that is SSRF against the internal network via attacker-controlled package data.

## Processor + normalization
Initial processor is Layout Parser (returns `documentLayout` blocks, not always page tokens/vertices). Response normalization is defensive across shapes: page tokens/paragraphs/lines with `boundingPoly.normalizedVertices`, else flattened `documentLayout` text blocks (bbox null). Components come from `document.entities` (future custom extractors) plus deterministic regex heuristics over OCR text (Net Weight, EPA Reg #, Lot Codes, Expiration Dates, UPC) tagged `source: "heuristic"`.

## Fast client PDF text path + skip server OCR when text supplied
Uploading a PDF now reads its embedded text layer in-browser via `pdfjs-dist` (upload page), populating `extractedText` near-instantly — no AI round-trip. The create-package route SKIPS `runExtraction` (the OCR provider) whenever the request already carries non-empty `extractedText` (client PDF text, image OCR result, or pasted copy), marking `extractionStatus="Provided"`; OCR only runs when no text is supplied (e.g. scanned/flattened PDFs with no text layer, or .ai/.indd).
**Why:** the previous flow always ran Vision OCR on the whole PDF during package creation even when the client had text — slow ("Analyzing…" spun) and it overwrote provided text. Design/artwork PDFs almost always have a real text layer, so the browser read is enough.
**How to apply:** submit is gated while extraction runs so the request always carries the text (no accidental fallback to slow OCR). Don't reintroduce an unconditional `runExtraction` on create. pdfjs worker is set via `GlobalWorkerOptions.workerSrc` (same `?url` import pattern as proof-viewer).

## Provided text is recorded as a Document AI row (`provided-at-upload`)
The create-package route now calls `recordProvidedExtraction()` (in `document-ai/service.ts`) inside the `extractedText` branch: it writes a `status='Complete'` `document_extractions` row from the client text — `engine='provided-at-upload'` (new permanent contract id, do NOT rename), `sourceHash='provided:'+sha256(text)`, components via `extractHeuristicComponents(text,[])`, `pageCount=1`, `confidence=null` — plus a "Document extracted" audit. Wrapped in try/catch, strictly non-fatal (a failure just leaves the tab empty as before, never fails the upload).
**Why:** the earlier design left the Document AI tab showing "No extraction has run" even when Findings existed (both derive from the same provided text) — a confusing UX/data inconsistency a user flagged. Recording it keeps the tab consistent with Findings WITHOUT paying for a redundant server OCR (bytes are never downloaded on the upload path — that stays fast).
**How to apply:** the prefixed `provided:` hash intentionally can't collide with a real byte-hash provider run, so `getCompletedExtractionByHash` never treats it as a provider cache hit; background analysis still skips OCR (text present) so no duplicate row; manual Reprocess (`force:true`) writes a fresh provider row that supersedes it via `getLatestExtraction` desc-id ordering. The tab header labels by `status.engine` (global config), not the row's engine, so `provided-at-upload` doesn't need UI copy.

## Client OCR fallback for scanned/flattened PDFs (upload page)
When a PDF has NO usable embedded text layer (`extractPdfText` returns "" — degenerate-layer guard is <12 non-space chars), the upload page must NOT just tell the user to paste manually — OCR/data extraction is the tool's core purpose. It renders the PDF pages to JPEG data URLs (pdfjs → canvas) and runs the existing `POST /api/ocr` text endpoint (`useExtractArtworkText` → `extractTextFromImage`) per page, concatenating into the Artwork Text box. Images already did this; PDFs now do too. Metadata pre-fill (`/api/ocr/fields`, page-1 image) and full-text OCR are separate calls — keep BOTH wired (a user reported metadata auto-filling while the copy box stayed empty, because only the fields OCR ran).
**Why:** the original PDF path only read the text layer and gave up on scanned/flattened exports, contradicting the product's purpose.
**How to apply:** gate rendering by outcome — text-layer PDFs render ONLY page 1 (metadata) and stay fast; render up to the page cap (OCR_PDF_PAGE_CAP=8) ONLY in the no-text branch. Per-page OCR must be best-effort (try/catch each page, keep successes, warn on partial) so one transient 429/5xx doesn't drop all recovered text. `/api/ocr` regex-matches image data URLs only and is on the strict rate limiter — keep OCR sequential + page-capped. This is the client-side counterpart to the server `pdf-text-layer` → Vision fallback in `runExtraction`.

## Server-side digital-PDF text-layer shortcut (bulk lever)
`runExtraction` (the server chokepoint used by bulk import, background analysis, and manual reprocess) reads a PDF's embedded text layer with poppler `pdftotext` BEFORE calling the OCR provider. `lib/document-ai/pdf-text-layer.ts` → `extractPdfTextLayer(bytes)`: spawns pdftotext into a temp dir, and if non-whitespace chars ≥ 24 returns a full `OcrExtractionResult` (single synthetic page block, `extractHeuristicComponents`, pageCount via pdf-lib, `processor="pdf-text-layer:pdftotext"`); else returns null → falls back to Vision. Never throws. New permanent engine id `pdf-text-layer` (persisted to `document_extractions.engine`/`packages.extractionEngine` — do NOT rename, orphans cached rows). Kill-switch env `PDF_TEXT_LAYER_SHORTCUT=off`. Only triggers for `mimeType==='application/pdf'`; images/.ai/.indd always go to the provider.
**Why:** the client upload path already skips OCR when the browser supplies text, but server paths (bulk/background/reprocess) had no such text; they always paid a Vision round-trip even on digital PDFs. This is the biggest bulk throughput/cost lever. Verified: digital PDF → 66 chars → text-layer; blank/scanned → 0 chars → Vision fallback.
**How to apply:** the shortcut sits AFTER the content-hash cache check and BEFORE the pending-row insert (so the pending row records the right engine). A doc previously extracted via `openai-vision` still cache-hits regardless of engine; force-reprocess re-evaluates and may switch engine to `pdf-text-layer`. 24-char threshold is a benign digital-vs-scanned cutoff (sparse label misclassified as scanned just falls back to Vision, no breakage). Extraction still never calls reasoning.

## Async seam
Processing is synchronous now but the `document_extractions.status` field (Pending/Processing/Complete/Failed) + service boundary leave a seam for background workers later (overlaps the "Compliance Memory & Scalability" work). Failures use compensating status updates rather than a DB transaction (can't hold a txn across the multi-second external call).
