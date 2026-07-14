---
name: Proofing & Review Suite
description: Object-storage uploads, proof/annotation/comment/decision model, and identity/markup decisions for the Proofing Studio.
---

# Proofing & Review Suite

## Uploads & object serving
- Uploads use presigned direct-to-GCS URLs (object storage), minted by the storage router behind Clerk `requireAuth`. Bypasses the JSON body-size limit → supports large/bulk files.
- **Private object downloads are record-authorized, not just auth'd.** `GET /api/storage/objects/*` reverse-maps the requested `/objects/...` path to the record that references it (package_versions.fileUrl/previewUrl, packages.artworkUrl, proofs.objectPath, reports.objectPath → owning package; supplier_submissions.artworkUrl → owning supplier) and applies the same org + supplier scope (`canAccessObjectOwner`) before streaming. Unknown/out-of-scope paths → 404 (deny-by-default, never leak existence). Route is gated by `requireAnyPermission('proofs:read','packages:read')`.
  - **Why:** global auth alone let any signed-in user pull another tenant's/supplier's proof artifact by guessing an object path (code review REJECT). Object-serving routes must enforce the same tenancy predicates as the record routes, or they become an IDOR bypass.
  - **How to apply:** any new object kind served through this route must be persisted with its `/objects/...` path on an owning record and added to `resolveObjectOwner`, else it will 404. Exported proof PDFs needed a new `reports.object_path` column precisely for this.

## Object keys MUST carry the file extension
- The presign route appends the original file extension to the stored upload key (`/objects/uploads/<uuid>.pdf`). The proof viewer decides how to render (`<img>` vs pdf.js) purely from `fileType`, which is derived from the URL extension via `inferFileType`. An **extensionless** key → `fileType=null` → the viewer renders neither image nor PDF, the white artwork box collapses to **zero height**, and every AI pin's `top:y%` collapses to the top of the frame (user-reported "artwork not shown + broken reference points" — one root cause, not two).
  - **Why:** the type must be recoverable from the URL alone; no other field (filename, content-type) is threaded through to the viewer. Legacy pre-fix uploads have null `package_versions.file_type` and render blank until backfilled.
  - **How to apply:** keep the extension sanitized (`/^[a-z0-9]{1,5}$/i`, lowercased) so keys stay path-safe. To repair a legacy extensionless record without re-uploading, set `package_versions.file_type` directly (the object still serves from its extensionless key; pdf.js/`<img>` fetch by URL, not by extension).

## Version control (restore / download / integrity)
- Version **restore** is **append-only**: it inserts a NEW `package_versions` row copying the target version's file/metadata and marks it current — it never mutates history — and writes its own audit event.
- Per-version `package_versions.fileHash` (SHA-256) is **best-effort integrity evidence**, computed at create/restore time; null for legacy/seed rows. Hashing must never gate the upload succeeding.
- Historical version **downloads reuse the ACL-enforced `/api/storage/objects/*` route** (via frontend `servingUrl()`), NOT a bespoke byte-serving endpoint. **Do not** add a custom route that streams object bytes — a first attempt did and it bypassed `resolveObjectOwner`/`canAccessObjectOwner` (code review REJECT, cross-tenant read).
- Any caller-supplied storage reference (`fileUrl`/`previewUrl`) must be validated at **write time** before persist/hash: `isSafeStoredFileUrl` (only `/objects/...` or `/artwork/...`, reject `..`/backslash/null/scheme) AND, for `/objects/` paths, `resolveObjectOwner` + `canAccessObjectOwner` so a forged pointer can't bind another tenant's object (IDOR/BOLA). `resolveObjectOwner` is exported from the storage route for this reuse.
  - **Why:** a stored fileUrl later drives hashing, proof export, and the object-serving owner lookup; ownership is reference-derived, so an unvalidated forged `/objects/` path lets an attacker's package "adopt" a victim object and download it. Fixed across 3 review rounds.

## Identity (audit integrity)
- Author/reviewer identity is derived **strictly server-side** from the Clerk session (`req.userId`, `req.userEmail` local-part), never from the request body. The API contract has **no `authorName` input** on annotation/comment/decision create.
  - **Why:** client-supplied author names are spoofable and break the audit trail (code review finding). If you add name display, fetch it server-side from Clerk, don't accept it from the client.

## Proof creation invariants
- `createProof` rejects any `objectPath` not under the `/objects/` private namespace before linking it to a package.
- `proofs` has a unique constraint on `(package_id, version)`. Version = `max(version)+1`, wrapped in a retry loop that catches Postgres `23505` (unique_violation) so concurrent uploads don't produce duplicate versions.

## AI finding pins anchor to the model bbox, not a grid
- In `applyAnalysis`, each AI-violation pin is placed at the **center of the model-provided bbox** (`bboxX + bboxW/2`, `bboxY + bboxH/2`, clamped 0..1). The synthetic `layoutPinPositions` grid is a **fallback only** for findings the model could not localize (null bbox) — never the whole set.
  - **Why:** a prior version ran every pin through `layoutPinPositions`, so all markers appeared in an even grid detached from the flagged regions (user-reported). The model already returns per-finding bbox (clamped in ai.ts); use it.
  - **How to apply:** fix is forward-only — existing packages keep their old grid coords until re-analyzed. Pin w/h stay null (bbox w/h is a text-guess that draws detached boxes in PDF export); only x/y are used, via the bbox center.

## Markup is image-only
- Pin/box markup and the AI-violation overlay are enabled **only for image proofs**. For `application/pdf`, markup tools + AI overlay are disabled; PDFs get the embedded viewer + general comments + approval.
  - **Why:** annotation coords are normalized 0..1 to the rendered element; a scrolling/multi-page PDF iframe has no stable element↔page mapping, so overlay markup would be inaccurate. The schema keeps a `page` field for a future real PDF renderer.

## Frontend wiring
- Studio at `/proofing/:packageId`; `/proofing` is a package picker (`ProofingIndex`). Entry points: nav under Review Queue + a button in the review workspace header.
- Serve proof images via `/api/storage/objects/<objectPath minus leading /objects/>` (root-relative — same origin as the app; cookies carry the Clerk session).
