// OCR / document-extraction provider abstraction.
//
// Document extraction is provider-based: the extraction service and policy
// pipeline depend only on this interface, never on a concrete vendor SDK. Google
// Document AI is the first (currently only) provider; additional providers are
// added by implementing `OcrProvider` and registering them in `registry.ts` —
// no changes to callers, routes, or the database contract are required.
//
// This keeps the platform production-ready for Document AI while operating
// normally until credentials are supplied: an unconfigured provider reports
// `isConfigured() === false` and extraction becomes a graceful no-op.

import type { ExtractionPage, ExtractedComponent } from "@workspace/db";

export type OcrExtractionInput = {
  content: Buffer;
  mimeType: string;
};

// Normalized extraction output. Every provider must map its vendor-specific
// response onto this shape so downstream reasoning/validation stay provider-
// agnostic. (Structurally identical to the Google client's DocumentAiResult.)
export type OcrExtractionResult = {
  text: string;
  pages: ExtractionPage[];
  components: ExtractedComponent[];
  confidence: number | null;
  pageCount: number;
  processor: string;
};

// Non-secret configuration status safe to return to API clients. The shape is
// intentionally backward-compatible with the original Google-only
// /document-ai/status payload. The credential booleans are provider-specific
// (they tell the UI which env vars are still missing); a future provider fills
// them in with its own configuration flags.
export type OcrProviderStatus = {
  configured: boolean;
  engine: string;
  processorType: string;
  location: string | null;
  projectConfigured: boolean;
  locationConfigured: boolean;
  processorConfigured: boolean;
  serviceAccountConfigured: boolean;
};

export interface OcrProvider {
  /**
   * Stable identifier persisted to `document_extractions.engine` and
   * `packages.extractionEngine`. Changing it would orphan cached rows, so treat
   * it as a permanent contract value.
   */
  readonly id: string;
  /** Human-readable provider name (used in audit log detail). */
  readonly label: string;
  /** True only when every credential/config value this provider needs is present. */
  isConfigured(): boolean;
  /** MIME types this provider can extract text/layout from. */
  supportedMimeTypes(): Set<string>;
  /** Normalize a raw content-type onto this provider's canonical MIME string. */
  normalizeMimeType(input: string | null | undefined): string;
  /** Non-secret configuration status for the status endpoint. Never returns credentials. */
  status(): OcrProviderStatus;
  /**
   * Run OCR / extraction on a single document. Callers MUST check
   * `isConfigured()` first — providers may throw if invoked while unconfigured.
   */
  process(input: OcrExtractionInput): Promise<OcrExtractionResult>;
}
