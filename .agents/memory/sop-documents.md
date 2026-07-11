---
name: SOP Document Management
description: Uploaded SOP files with version history + side-by-side diff in the Resource Center; how it reuses policy/extraction/object-storage patterns.
---

# SOP Document Management

First-class SOP document library in the Resource Center (distinct from the short
"Internal SOP" text entries in the regulation library, which are agency-regex
split rows in the regulations table).

## Data model decision
- Two tables mirror the policies pattern but with a key difference: **every**
  version (including v1) is snapshotted into `sop_document_versions`, and the
  parent `sop_documents` row **denormalizes the current version's** file +
  extracted text so list/search touch a single table. Policies only snapshot the
  *previous* state on publish; SOPs keep the full lineage because each version is
  its own uploaded file.
- New-version upload is atomic: row-lock the parent (`.for("update")`), insert
  the next monotonic version, bump the parent — same shape as policy versioning.
  Unique index on (org, sopDocumentId, version).

## Reuse (do not duplicate)
- **Permissions:** reuses `policies:read` / `policies:write` — no new RBAC keys.
  Nav `/resources/sop` is gated at `policies:read` (client `requiredPermFor`).
- **Extraction:** reuses `extractPolicyText` (generic over documentUrl/contentType;
  never throws, returns {text,status,engine}). Runs BEFORE the txn.
- **File serving:** dedicated org-scoped endpoint
  `GET /sop-documents/:id/versions/:versionId/file` streams via
  `objectStorage.getObjectEntityFile` + `downloadObject` (XSS-safe serving).
  Chose a dedicated endpoint over the shared storage route because that route's
  gate excludes pure policy-readers and `ObjectOwner` has no org-only kind.

## Version comparison
- Server-side LCS **line** diff (`lib/sop/diff.ts`), returns aligned side-by-side
  rows classified unchanged/added/removed/changed (a removed-run immediately
  followed by an added-run is paired into "changed" rows). Route is **path-param**
  `/:id/compare/:versionA/:versionB` (older shown left regardless of arg order).

## orval gotcha (important)
- An endpoint with BOTH path AND query params makes the zod client emit
  `<Op>Params` (path) which collides with the types generator's `<Op>Params`
  (combined) → `TS2308 already exported`. Fix: make compare **path-params only**
  (matches the package compare endpoint precedent). Query-only or path-only avoid
  the collision.

## Search / overview
- Resource Center unified search + overview now include `sop_document` (was a
  reserved no-op). Search matches title/category/owner/extractedText on the
  current version; deep-links to `/resources/sop?doc=<id>` (card scroll+highlight).
