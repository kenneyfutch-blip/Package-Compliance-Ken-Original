import { ObjectStorageService, ObjectNotFoundError } from "../objectStorage";
import { processDocument } from "../document-ai/client";
import {
  isDocumentAiConfigured,
  normalizeMimeType,
  SUPPORTED_DOCUMENT_MIME_TYPES,
} from "../document-ai/config";
import { logger } from "../logger";

const objectStorage = new ObjectStorageService();

export type PolicyExtractionStatus =
  | "Complete"
  | "Skipped"
  | "NotConfigured"
  | "Unsupported"
  | "Failed";

export type PolicyExtraction = {
  text: string | null;
  status: PolicyExtractionStatus;
  engine: string | null;
};

// Extract searchable text from an uploaded policy document, reusing the platform
// document pipeline. Contract:
//   - inline text (pasted rule text) is used verbatim;
//   - plain-text/CSV objects are decoded directly (no Document AI needed);
//   - PDF/image objects go through Google Document AI when configured;
//   - other rich formats (DOCX/PPTX) are marked Unsupported — the authored rule
//     text (policy.summary) still drives compliance analysis in that case.
// Never throws: a failure returns a status the caller records, so uploading a
// policy never breaks even when extraction cannot run.
export async function extractPolicyText(params: {
  documentUrl?: string | null;
  contentType?: string | null;
  inlineText?: string | null;
}): Promise<PolicyExtraction> {
  const { documentUrl, contentType, inlineText } = params;

  if (inlineText && inlineText.trim()) {
    return { text: inlineText, status: "Complete", engine: "inline" };
  }

  if (!documentUrl || !documentUrl.startsWith("/objects/")) {
    return { text: null, status: "Skipped", engine: null };
  }

  try {
    const file = await objectStorage.getObjectEntityFile(documentUrl);
    const { buffer, contentType: storedType } =
      await objectStorage.downloadObjectBytes(file);
    const mime = normalizeMimeType(contentType || storedType);

    // Plain-text formats: decode directly.
    if (mime.startsWith("text/")) {
      return { text: buffer.toString("utf-8"), status: "Complete", engine: "text" };
    }

    // PDF / images: Google Document AI (OCR + layout).
    if (SUPPORTED_DOCUMENT_MIME_TYPES.has(mime)) {
      if (!isDocumentAiConfigured()) {
        return { text: null, status: "NotConfigured", engine: null };
      }
      const result = await processDocument({ content: buffer, mimeType: mime });
      return {
        text: result.text,
        status: "Complete",
        engine: "google-document-ai",
      };
    }

    // DOCX / PPTX and other rich formats are not OCR-extractable here.
    return { text: null, status: "Unsupported", engine: null };
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      return { text: null, status: "Skipped", engine: null };
    }
    logger.error({ err }, "Policy text extraction failed");
    return { text: null, status: "Failed", engine: null };
  }
}
