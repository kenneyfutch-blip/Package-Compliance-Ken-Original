---
name: Upload limit & config lockstep
description: Client upload limit/validation mirrors the server; the two must be kept in sync manually.
---

# Upload limit & config lockstep

The web upload size limit and accepted-type validation live in TWO places that
are NOT wired together at build time:

- **Server (authoritative gate):** `MAX_UPLOAD_BYTES` + content-type allowlist in
  `artifacts/api-server/src/routes/storage.ts` (`validateUpload`). This is what
  actually rejects a bad upload.
- **Client (mirror for UX):** `MAX_UPLOAD_BYTES` / `MAX_UPLOAD_LABEL` /
  `ALLOWED_UPLOAD_EXTENSIONS` / `validateUploadFile` in
  `lib/object-storage-web/src/upload-config.ts`, consumed by `useUpload` and the
  UI so oversize/unsupported files are rejected up front and the limit is shown.

**Rule:** any change to the server limit or allowlist must be mirrored in
upload-config.ts in lockstep (both are 100MB today). There is a cross-reference
comment on each side.

**Why:** the presigned flow uploads bytes directly to storage; if the client
shows/permits a larger size than the server allows, the user wastes a full
upload only to hit a server rejection. The client validates by **extension**
(not MIME) on purpose — browsers send empty/`application/octet-stream` MIME for
Adobe `.ai`/`.indd`, so a MIME-based client check would wrongly reject them.

**How to apply:** when adjusting upload size or file types, edit both files and
keep `.ai`/`.indd` in the client extension list. User-facing upload errors are
normalized to the `UploadError` class (with a `retryable` flag) in
`use-upload.ts` — never surface raw HTTP status strings; feed the friendly
`error.message` to consumers (directly in JSX, or via the `onError` option to
avoid stale-closure reads inside async click handlers).
