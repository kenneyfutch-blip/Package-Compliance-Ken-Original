---
name: API security hardening
description: Rate limiting, security headers, error handling, and upload/download safety on the api-server; the non-obvious tradeoffs.
---

# API security hardening (api-server)

The Express 5 api-server runs behind the Replit/Clerk proxy. Auth (Clerk, domain-gated),
RBAC, tenant scoping, per-object storage ACL, and Drizzle parameterized queries were
already in place; this layer adds infrastructure controls.

## Rate limiting
- One dispatcher (`middlewares/rateLimit.ts`) mounted at `/api` routes each POST to a
  strict limiter (AI/upload) by regex, else a generous general limiter.
- **Keyed by Clerk `userId` when present, else client IP.** `trust proxy` = 1 so the
  forwarded client IP is used. **Why:** behind a shared proxy, IP-only keying would lump
  all users together; a 100/15min IP limit would break a normal SPA session.
- General limit is deliberately high (1000/15min) — a dashboard fans out many reads per
  page. Strict tiers (AI 60, upload 120) protect the expensive endpoints.
- **Path matching gotcha:** middleware mounted at `/api` sees `req.path` with the prefix
  stripped — reconstruct with `req.baseUrl + req.path`, and strip trailing slashes, or
  variants like `/api/packages/` bypass the strict limiter.

## Uploaded-file safety (defense in depth)
Uploads go direct-to-object-storage via a presigned PUT URL, so the server never sees the
bytes at upload time and the signed URL does not constrain content-type. Therefore:
- **Request-URL gate** validates declared metadata (size cap + content-type allowlist +
  filename denylist). Allowlist must include the product's real formats — packaging
  artwork **`.ai`/`.indd`** (application/postscript, application/octet-stream) and policy
  `.txt`/`.csv`, not just PDF/DOCX/PNG/JPG. Strictly enforcing the spec's short list
  would break artwork upload.
- **The authoritative XSS control is at SERVE time**, not upload time. `downloadObject`
  only serves a known-safe-inline allowlist (images, pdf, text/plain) inline; everything
  else is forced `Content-Disposition: attachment` + `application/octet-stream`, plus
  `X-Content-Type-Options: nosniff`. **Why:** a client can declare a safe type to pass the
  upload gate then PUT HTML/SVG bytes; sanitizing at serve time neutralizes stored-XSS
  regardless of the stored content-type.

## Other
- helmet with `crossOriginResourcePolicy: cross-origin` (the web artifact consumes the API
  cross-origin through the proxy — default `same-origin` would block it). `x-powered-by` off.
- Central error handler never returns stack/internal text: maps `entity.parse.failed`→400,
  `entity.too.large`→413, else generic 500/status. JSON 404 for unmatched `/api`.
- The dependency scanner reports Python django/pyjwt CVEs — those are **not** app deps
  (only a Replit skill helper `.local/skills/canvas/init.py` exists); ignore them.
