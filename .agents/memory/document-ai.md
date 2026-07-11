---
name: Google Document AI extraction
description: Enterprise OCR/extraction layer — trigger contract, hash-based cache, three-service separation, SSRF boundary.
---

# Google Document AI extraction

Enterprise document extraction layer for the Packaging Compliance AI product.
Separate from reasoning and validation by deliberate design.

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

## Async seam
Processing is synchronous now but the `document_extractions.status` field (Pending/Processing/Complete/Failed) + service boundary leave a seam for background workers later (overlaps the "Compliance Memory & Scalability" work). Failures use compensating status updates rather than a DB transaction (can't hold a txn across the multi-second external call).
