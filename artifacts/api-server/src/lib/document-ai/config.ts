// Google Document AI configuration. Mirrors the openFDA pattern: read the
// required values straight from environment variables, expose a single
// `isDocumentAiConfigured()` gate, and NEVER surface the service-account
// credentials outside this module.

export class DocumentAiNotConfiguredError extends Error {
  constructor(message = "Google Document AI is not configured") {
    super(message);
    this.name = "DocumentAiNotConfiguredError";
  }
}

export class DocumentAiUnavailableError extends Error {
  constructor(message = "Google Document AI request failed") {
    super(message);
    this.name = "DocumentAiUnavailableError";
  }
}

export type DocumentAiConfig = {
  projectId: string;
  location: string;
  processorId: string;
  credentials: { client_email: string; private_key: string };
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

/** True only when every value Document AI needs is present. */
export function isDocumentAiConfigured(): boolean {
  return Boolean(
    env("GOOGLE_PROJECT_ID") &&
      env("GOOGLE_LOCATION") &&
      env("DOCUMENT_AI_PROCESSOR_ID") &&
      env("DOCUMENT_AI_SERVICE_ACCOUNT"),
  );
}

/**
 * Parse and validate the configuration. Throws DocumentAiNotConfiguredError if
 * anything is missing or the service-account JSON is malformed.
 */
export function getDocumentAiConfig(): DocumentAiConfig {
  const projectId = env("GOOGLE_PROJECT_ID");
  const location = env("GOOGLE_LOCATION");
  const processorId = env("DOCUMENT_AI_PROCESSOR_ID");
  const serviceAccountRaw = env("DOCUMENT_AI_SERVICE_ACCOUNT");

  if (!projectId || !location || !processorId || !serviceAccountRaw) {
    throw new DocumentAiNotConfiguredError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serviceAccountRaw);
  } catch {
    throw new DocumentAiNotConfiguredError(
      "DOCUMENT_AI_SERVICE_ACCOUNT is not valid JSON",
    );
  }

  const account = parsed as { client_email?: string; private_key?: string };
  if (!account.client_email || !account.private_key) {
    throw new DocumentAiNotConfiguredError(
      "DOCUMENT_AI_SERVICE_ACCOUNT is missing client_email or private_key",
    );
  }

  return {
    projectId,
    location,
    processorId,
    credentials: {
      client_email: account.client_email,
      // Env vars often store the private key with literal "\n" sequences.
      private_key: account.private_key.replace(/\\n/g, "\n"),
    },
  };
}

/** Non-secret status summary safe to return to the client. */
export function documentAiStatus() {
  const location = env("GOOGLE_LOCATION") ?? null;
  return {
    configured: isDocumentAiConfigured(),
    engine: "google-document-ai",
    processorType: "Layout Parser",
    location,
    projectConfigured: Boolean(env("GOOGLE_PROJECT_ID")),
    locationConfigured: Boolean(location),
    processorConfigured: Boolean(env("DOCUMENT_AI_PROCESSOR_ID")),
    serviceAccountConfigured: Boolean(env("DOCUMENT_AI_SERVICE_ACCOUNT")),
  };
}

// Document AI supported input MIME types (Layout Parser / OCR processors).
export const SUPPORTED_DOCUMENT_MIME_TYPES = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/tiff",
  "image/bmp",
  "image/gif",
  "image/webp",
]);

export function normalizeMimeType(input: string | null | undefined): string {
  const mime = (input ?? "").split(";")[0]!.trim().toLowerCase();
  if (mime === "image/jpg") return "image/jpeg";
  return mime;
}
