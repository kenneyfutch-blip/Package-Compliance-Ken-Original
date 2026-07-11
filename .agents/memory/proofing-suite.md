---
name: Proofing & Review Suite
description: Object-storage uploads, proof/annotation/comment/decision model, and identity/markup decisions for the Proofing Studio.
---

# Proofing & Review Suite

## Uploads & object serving
- Uploads use presigned direct-to-GCS URLs (object storage), minted by the storage router behind Clerk `requireAuth`. Bypasses the JSON body-size limit → supports large/bulk files.
- **No per-object ACL.** Private objects are served through the authenticated `/api/storage/objects/*` GET route; any signed-in associate can read any proof.
  - **Why:** internal tool — every user is gated to `@dollartree.com` and compliance specialists collaborate across all packages. A code review flagged this as "over-permissive"; it is an intentional product decision, not a bug. Revisit only if the product gains external/partner users.

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
