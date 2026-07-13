// OpenAI Vision OCR provider. Transcribes packaging artwork (images) and PDFs
// through the active OpenAI-compatible model configured in AI Integrations, then
// derives deterministic components from the transcript using the shared
// heuristics. This is the DEFAULT extraction provider; Google Document AI remains
// registered and can be re-selected via OCR_PROVIDER=google-document-ai.

import { PDFDocument } from "pdf-lib";
import type { ExtractionPage } from "@workspace/db";
import { runOpenAiOcr } from "../../ai";
import { extractHeuristicComponents } from "../components";
import { normalizeMimeType } from "../config";
import type {
  OcrExtractionInput,
  OcrExtractionResult,
  OcrProvider,
  OcrProviderStatus,
} from "./types";

// Persisted to document_extractions.engine / packages.extractionEngine. Treat as
// a permanent contract value — changing it would orphan cached extraction rows.
export const OPENAI_VISION_PROVIDER_ID = "openai-vision";

// OpenAI vision accepts raster images and, via the file input, PDFs. TIFF/BMP are
// intentionally excluded (the model does not accept them); select Google Document
// AI for those formats.
const SUPPORTED = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

async function pdfPageCount(bytes: Buffer): Promise<number> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    return Math.max(1, doc.getPageCount());
  } catch {
    return 1;
  }
}

export const openaiVisionProvider: OcrProvider = {
  id: OPENAI_VISION_PROVIDER_ID,
  label: "OpenAI Vision",
  // The AI client always resolves (the active provider, else the Replit-managed
  // fallback), so OpenAI-based extraction is always available.
  isConfigured(): boolean {
    return true;
  },
  supportedMimeTypes(): Set<string> {
    return SUPPORTED;
  },
  normalizeMimeType(input: string | null | undefined): string {
    return normalizeMimeType(input);
  },
  status(): OcrProviderStatus {
    return {
      configured: true,
      engine: OPENAI_VISION_PROVIDER_ID,
      processorType: "Vision Transcription",
      location: null,
      // These flags describe Google Document AI credential readiness. This
      // provider rides on the active AI model and needs none of them, so they are
      // reported false (truthful: those Google env vars are not set). Provider-
      // aware UI hides the Google credential checklist for non-Google engines.
      projectConfigured: false,
      locationConfigured: false,
      processorConfigured: false,
      serviceAccountConfigured: false,
    };
  },
  async process(input: OcrExtractionInput): Promise<OcrExtractionResult> {
    const mimeType = normalizeMimeType(input.mimeType);
    const { text, model } = await runOpenAiOcr({
      content: input.content,
      mimeType,
    });

    const pageCount =
      mimeType === "application/pdf" ? await pdfPageCount(input.content) : 1;

    // A vision transcription is a flat transcript (no per-block layout/bbox), so
    // represent it as a single page holding one text block.
    const pages: ExtractionPage[] = text
      ? [
          {
            pageNumber: 1,
            width: 0,
            height: 0,
            blocks: [{ text, confidence: null, bbox: null }],
          },
        ]
      : [];

    // Derive structured components deterministically from the transcript using
    // the same heuristics the Google path applies (no ML entities available).
    const components = extractHeuristicComponents(text, []);

    return {
      text,
      pages,
      components,
      confidence: null,
      pageCount,
      processor: `${OPENAI_VISION_PROVIDER_ID}:${model}`,
    };
  },
};
