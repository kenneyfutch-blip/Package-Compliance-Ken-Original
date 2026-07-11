// Google Document AI provider. Adapts the existing Google-specific config and
// client modules to the vendor-agnostic OcrProvider interface. All Google SDK
// and credential handling stays behind this adapter and `../config` / `../client`.

import {
  documentAiStatus,
  isDocumentAiConfigured,
  normalizeMimeType,
  SUPPORTED_DOCUMENT_MIME_TYPES,
} from "../config";
import { processDocument } from "../client";
import type {
  OcrExtractionInput,
  OcrExtractionResult,
  OcrProvider,
  OcrProviderStatus,
} from "./types";

// Persisted to document_extractions.engine / packages.extractionEngine. This is
// the historical value, so keeping it stable avoids any data migration.
export const GOOGLE_DOCUMENT_AI_PROVIDER_ID = "google-document-ai";

export const googleDocumentAiProvider: OcrProvider = {
  id: GOOGLE_DOCUMENT_AI_PROVIDER_ID,
  label: "Google Document AI",
  isConfigured(): boolean {
    return isDocumentAiConfigured();
  },
  supportedMimeTypes(): Set<string> {
    return SUPPORTED_DOCUMENT_MIME_TYPES;
  },
  normalizeMimeType(input: string | null | undefined): string {
    return normalizeMimeType(input);
  },
  status(): OcrProviderStatus {
    return documentAiStatus();
  },
  process(input: OcrExtractionInput): Promise<OcrExtractionResult> {
    return processDocument(input);
  },
};
