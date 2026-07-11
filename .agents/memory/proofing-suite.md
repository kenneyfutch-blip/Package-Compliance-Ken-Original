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

## Identity (audit integrity)
- Author/reviewer identity is derived **strictly server-side** from the Clerk session (`req.userId`, `req.userEmail` local-part), never from the request body. The API contract has **no `authorName` input** on annotation/comment/decision create.
  - **Why:** client-supplied author names are spoofable and break the audit trail (code review finding). If you add name display, fetch it server-side from Clerk, don't accept it from the client.

## Proof creation invariants
- `createProof` rejects any `objectPath` not under the `/objects/` private namespace before linking it to a package.
- `proofs` has a unique constraint on `(package_id, version)`. Version = `max(version)+1`, wrapped in a retry loop that catches Postgres `23505` (unique_violation) so concurrent uploads don't produce duplicate versions.

## Markup is image-only
- Pin/box markup and the AI-violation overlay are enabled **only for image proofs**. For `application/pdf`, markup tools + AI overlay are disabled; PDFs get the embedded viewer + general comments + approval.
  - **Why:** annotation coords are normalized 0..1 to the rendered element; a scrolling/multi-page PDF iframe has no stable element↔page mapping, so overlay markup would be inaccurate. The schema keeps a `page` field for a future real PDF renderer.

## Frontend wiring
- Studio at `/proofing/:packageId`; `/proofing` is a package picker (`ProofingIndex`). Entry points: nav under Review Queue + a button in the review workspace header.
- Serve proof images via `/api/storage/objects/<objectPath minus leading /objects/>` (root-relative — same origin as the app; cookies carry the Clerk session).
