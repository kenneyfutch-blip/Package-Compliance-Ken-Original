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
**How to apply:** submit is gated while extraction runs so the request always carries the text (no accidental fallback to slow OCR). Tradeoff: the "Provided" path creates NO `document_extractions` row (no components/confidence/engine) — Document AI history shows nothing until a manual reprocess; that's intentional. Don't reintroduce an unconditional `runExtraction` on create. pdfjs worker is set via `GlobalWorkerOptions.workerSrc` (same `?url` import pattern as proof-viewer).

## Server-side digital-PDF text-layer shortcut (bulk lever)
`runExtraction` (the server chokepoint used by bulk import, background analysis, and manual reprocess) reads a PDF's embedded text layer with poppler `pdftotext` BEFORE calling the OCR provider. `lib/document-ai/pdf-text-layer.ts` → `extractPdfTextLayer(bytes)`: spawns pdftotext into a temp dir, and if non-whitespace chars ≥ 24 returns a full `OcrExtractionResult` (single synthetic page block, `extractHeuristicComponents`, pageCount via pdf-lib, `processor="pdf-text-layer:pdftotext"`); else returns null → falls back to Vision. Never throws. New permanent engine id `pdf-text-layer` (persisted to `document_extractions.engine`/`packages.extractionEngine` — do NOT rename, orphans cached rows). Kill-switch env `PDF_TEXT_LAYER_SHORTCUT=off`. Only triggers for `mimeType==='application/pdf'`; images/.ai/.indd always go to the provider.
**Why:** the client upload path already skips OCR when the browser supplies text, but server paths (bulk/background/reprocess) had no such text; they always paid a Vision round-trip even on digital PDFs. This is the biggest bulk throughput/cost lever. Verified: digital PDF → 66 chars → text-layer; blank/scanned → 0 chars → Vision fallback.
**How to apply:** the shortcut sits AFTER the content-hash cache check and BEFORE the pending-row insert (so the pending row records the right engine). A doc previously extracted via `openai-vision` still cache-hits regardless of engine; force-reprocess re-evaluates and may switch engine to `pdf-text-layer`. 24-char threshold is a benign digital-vs-scanned cutoff (sparse label misclassified as scanned just falls back to Vision, no breakage). Extraction still never calls reasoning.

## Async seam
Processing is synchronous now but the `document_extractions.status` field (Pending/Processing/Complete/Failed) + service boundary leave a seam for background workers later (overlaps the "Compliance Memory & Scalability" work). Failures use compensating status updates rather than a DB transaction (can't hold a txn across the multi-second external call).
