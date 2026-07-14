---
name: Package artwork thumbnails
description: Why package-card previews are rendered server-side with poppler, and the object-auth invariant that applies to any DB-stored object path.
---

# Package artwork thumbnails

Package cards show a preview of the current artwork version. This is rendered
**server-side**, not in the browser.

## Rule: don't rasterize PDFs per-card in the browser
A list of N package cards must not each download a full PDF and run pdf.js.
That fans out to N multi-MB downloads + N concurrent renders — slow, flaky, and
it silently falls back to a "NO PREVIEW" placeholder under load. It is unfit for
a deployed tool.

**Instead:** `GET /packages/:id/thumbnail` rasterizes page 1 once with poppler's
`pdftoppm` (via a small `lib/thumbnail.ts` spawn helper), caches the PNG in a
bounded in-process LRU keyed by the version content hash, and serves it with a
`private, max-age` browser cache. The card is a plain `<img>`; images render
directly, `.indd` skips straight to a typed placeholder, `.ai` is attempted
(often PDF-compatible) and falls back on `onError`.

**Why:** one render + two cache layers instead of N browser renders. First
render ~700ms, cached hits ~10ms.

## Deploy dependency
`pdftoppm` comes from the `poppler-utils` **system dependency** — it must be
declared (persisted in `replit.nix`) via the package-management skill, not
relied on via an ambient nix runtime path, or it won't exist in the autoscale
deployment. Spawn it with an argv array (never a shell string) so filenames
can't inject.

## Auth invariant (applies beyond thumbnails)
When an endpoint reads private object-storage bytes from a path stored in a DB
record (e.g. a version's `fileUrl`), scoping the **parent** record to the caller
is NOT sufficient. Run the SAME object-owner authorization the raw
`/storage/objects/*` route uses — `resolveObjectOwner(path)` +
`canAccessObjectOwner(req, owner)` — and 404 on mismatch/unknown owner.

**Why:** a version row could hold an object path outside the caller's
tenant/supplier scope (bad migration, legacy data, weak write-path validation);
without the object-owner check that becomes a cross-tenant IDOR. Deny-by-default.
**How to apply:** any new route that turns a stored path into object bytes.
