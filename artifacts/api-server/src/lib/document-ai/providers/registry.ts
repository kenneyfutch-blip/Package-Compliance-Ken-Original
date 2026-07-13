// OCR provider registry + active-provider selection.
//
// This is the single place that knows which extraction providers exist. The
// extraction service, policy pipeline, and status route depend only on the
// helpers here, so adding a provider is a one-line registration change with no
// ripple through callers.
//
// Selection: `OCR_PROVIDER` env var chooses the active provider; it defaults to
// OpenAI Vision (which rides on the active AI model and is always available) and
// falls back to the default if set to an unknown id. Google Document AI stays
// registered and can be re-selected with OCR_PROVIDER=google-document-ai.

import { logger } from "../../logger";
import {
  GOOGLE_DOCUMENT_AI_PROVIDER_ID,
  googleDocumentAiProvider,
} from "./google";
import {
  OPENAI_VISION_PROVIDER_ID,
  openaiVisionProvider,
} from "./openai";
import type { OcrProvider, OcrProviderStatus } from "./types";

// Registry of available providers. To add a provider: implement OcrProvider in a
// sibling module and register it here.
const PROVIDERS: Record<string, OcrProvider> = {
  [OPENAI_VISION_PROVIDER_ID]: openaiVisionProvider,
  [GOOGLE_DOCUMENT_AI_PROVIDER_ID]: googleDocumentAiProvider,
};

const DEFAULT_PROVIDER_ID = OPENAI_VISION_PROVIDER_ID;

/** The provider currently selected for extraction (via OCR_PROVIDER, else default). */
export function getActiveProvider(): OcrProvider {
  const requested = process.env["OCR_PROVIDER"]?.trim();
  if (requested) {
    const provider = PROVIDERS[requested];
    if (provider) return provider;
    logger.warn(
      { requested, fallback: DEFAULT_PROVIDER_ID },
      "Unknown OCR_PROVIDER; falling back to default extraction provider",
    );
  }
  return PROVIDERS[DEFAULT_PROVIDER_ID]!;
}

/** All registered providers (for diagnostics / future multi-provider status). */
export function listProviders(): OcrProvider[] {
  return Object.values(PROVIDERS);
}

/** Look up a specific provider by id, or null if not registered. */
export function getProvider(id: string): OcrProvider | null {
  return PROVIDERS[id] ?? null;
}

/** True when the active provider has all of its configuration/credentials. */
export function isExtractionConfigured(): boolean {
  return getActiveProvider().isConfigured();
}

/** Non-secret status of the active extraction provider (for the status endpoint). */
export function extractionStatus(): OcrProviderStatus {
  return getActiveProvider().status();
}
