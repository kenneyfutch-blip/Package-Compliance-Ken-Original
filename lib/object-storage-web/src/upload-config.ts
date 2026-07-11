// Single source of truth for upload limits and accepted types on the CLIENT.
//
// IMPORTANT: keep MAX_UPLOAD_BYTES in lockstep with the server's
// MAX_UPLOAD_BYTES in artifacts/api-server/src/routes/storage.ts. The server is
// the authoritative gate; this mirror lets the UI display the same limit and
// reject oversize/unsupported files up front so users never hit a surprise
// server rejection after a long upload.
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_UPLOAD_LABEL = "100MB";

// Extensions the product supports. The server enforces an equivalent
// content-type allowlist, but browsers frequently send an empty or
// application/octet-stream MIME for Adobe .ai/.indd binaries, so the client
// validates by EXTENSION to stay robust. Keep .ai/.indd in this list.
export const ALLOWED_UPLOAD_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "pdf",
  "ai",
  "indd",
  "txt",
  "csv",
  "doc",
  "docx",
  "pptx",
] as const;

// Human-friendly byte formatting for messages ("12.3MB", "512KB").
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)}MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

// Mirror of the server's validateUpload (minus the MIME check — see above).
// Returns a plain-language error string, or null when the file is acceptable.
export function validateUploadFile(file: {
  name: string;
  size: number;
}): string | null {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return "That file appears to be empty.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `This file is ${formatBytes(file.size)}, over the ${MAX_UPLOAD_LABEL} limit. Please upload a smaller file.`;
  }
  const ext = extensionOf(file.name);
  if (
    !ALLOWED_UPLOAD_EXTENSIONS.includes(
      ext as (typeof ALLOWED_UPLOAD_EXTENSIONS)[number],
    )
  ) {
    return "That file type isn't supported. Please choose a supported file (e.g. PNG, JPG, PDF, AI, or INDD).";
  }
  // Block traversal / dangerous double-extensions, matching the server.
  if (/[\\/]|\.\.|\.(exe|sh|bat|cmd|js|mjs|html?|svg|php|com|scr)$/i.test(file.name)) {
    return "That file name isn't allowed. Please rename the file and try again.";
  }
  return null;
}
