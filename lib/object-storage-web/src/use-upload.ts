import { useCallback, useState } from 'react';
import type { UppyFile } from '@uppy/core';
import { MAX_UPLOAD_LABEL, validateUploadFile } from './upload-config';

interface UploadMetadata {
  name: string;
  size: number;
  contentType: string;
}

interface UploadResponse {
  uploadURL: string;
  objectPath: string;
  metadata: UploadMetadata;
}

interface UseUploadOptions {
  /** Base path where object storage routes are mounted (default: "/api/storage") */
  basePath?: string;
  onSuccess?: (response: UploadResponse) => void;
  onError?: (error: UploadError) => void;
}

/**
 * A user-facing upload failure with a plain-language message. `retryable`
 * distinguishes transient problems (network / 5xx / timeout — worth retrying)
 * from permanent ones (file too large / unsupported type). We NEVER surface raw
 * HTTP status strings like "HTTP 502 Bad Gateway" to the user.
 */
export class UploadError extends Error {
  retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'UploadError';
    this.retryable = retryable;
  }
}

const GENERIC_RETRY = 'Please try again in a moment.';

interface FileMeta {
  name: string;
  size: number;
  contentType: string;
}

// Step 1 of the presigned flow: ask our backend to mint a write URL. Maps every
// failure onto a friendly, retryable-aware UploadError.
async function requestUploadUrl(
  basePath: string,
  meta: FileMeta,
): Promise<UploadResponse> {
  let response: Response;
  try {
    response = await fetch(`${basePath}/uploads/request-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    });
  } catch {
    throw new UploadError(
      "We couldn't reach the upload service. Check your connection and try again.",
      true,
    );
  }

  if (!response.ok) {
    const data = (await response
      .json()
      .catch(() => ({}))) as { error?: string };
    if (response.status === 401) {
      throw new UploadError(
        'Your session has expired. Please sign in again and retry.',
        false,
      );
    }
    // 4xx carry actionable, plain-language reasons from the server (e.g. size /
    // type rejections) — surface those directly.
    if (response.status >= 400 && response.status < 500 && data?.error) {
      throw new UploadError(data.error, false);
    }
    // 5xx (and anything else) is a service problem, not the user's fault.
    throw new UploadError(
      `The upload service is temporarily unavailable. ${GENERIC_RETRY}`,
      true,
    );
  }

  return response.json();
}

// Step 2: PUT the bytes straight to storage via the presigned URL, using
// XMLHttpRequest so we can report real byte-level progress. fetch() gives no
// upload progress, which matters for large artwork files.
function putWithProgress(
  file: File,
  url: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader(
      'Content-Type',
      file.type || 'application/octet-stream',
    );
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else if (xhr.status === 413) {
        reject(
          new UploadError(
            `This file is over the ${MAX_UPLOAD_LABEL} limit.`,
            false,
          ),
        );
      } else {
        reject(
          new UploadError(`The upload didn't complete. ${GENERIC_RETRY}`, true),
        );
      }
    };
    xhr.onerror = () =>
      reject(
        new UploadError(
          'The upload was interrupted. Check your connection and try again.',
          true,
        ),
      );
    xhr.ontimeout = () =>
      reject(
        new UploadError(
          'The upload timed out. Check your connection and try again.',
          true,
        ),
      );
    xhr.send(file);
  });
}

function toUploadError(err: unknown): UploadError {
  if (err instanceof UploadError) return err;
  return new UploadError(
    `Something went wrong during the upload. ${GENERIC_RETRY}`,
    true,
  );
}

/**
 * React hook for handling file uploads with presigned URLs.
 *
 * Two-step presigned flow:
 * 1. Request a presigned URL from the backend (sends JSON metadata, NOT the file)
 * 2. PUT the file directly to the presigned URL (with real progress reporting)
 *
 * Oversize / unsupported files are rejected up front (before any network call)
 * with a clear message. All failures resolve to a friendly `error` — the caller
 * can re-invoke `uploadFile` to retry.
 */
export function useUpload(options: UseUploadOptions = {}) {
  const basePath = options.basePath ?? '/api/storage';
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<UploadError | null>(null);
  const [progress, setProgress] = useState(0);

  const uploadFile = useCallback(
    async (file: File): Promise<UploadResponse | null> => {
      setError(null);
      setProgress(0);

      // Early, offline rejection — no network round-trip for a doomed upload.
      const validationError = validateUploadFile(file);
      if (validationError) {
        const e = new UploadError(validationError, false);
        setError(e);
        options.onError?.(e);
        return null;
      }

      setIsUploading(true);
      try {
        const uploadResponse = await requestUploadUrl(basePath, {
          name: file.name,
          size: file.size,
          contentType: file.type || 'application/octet-stream',
        });

        await putWithProgress(file, uploadResponse.uploadURL, setProgress);

        setProgress(100);
        options.onSuccess?.(uploadResponse);
        return uploadResponse;
      } catch (err) {
        const e = toUploadError(err);
        setError(e);
        options.onError?.(e);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [basePath, options],
  );

  const getUploadParameters = useCallback(
    async (
      file: UppyFile<Record<string, unknown>, Record<string, unknown>>,
    ): Promise<{
      method: 'PUT';
      url: string;
      headers?: Record<string, string>;
    }> => {
      const uploadResponse = await requestUploadUrl(basePath, {
        name: file.name ?? 'upload',
        size: file.size ?? 0,
        contentType: file.type || 'application/octet-stream',
      });
      return {
        method: 'PUT',
        url: uploadResponse.uploadURL,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      };
    },
    [basePath],
  );

  return {
    uploadFile,
    getUploadParameters,
    isUploading,
    error,
    progress,
  };
}
