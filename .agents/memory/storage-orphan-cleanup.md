---
name: Object-storage orphan cleanup on purge
description: How purged packages delete their stored files safely; invariants for any future delete flow that touches object storage.
---

Hard package purge (after the 30-day trash window) now deletes the underlying object-storage files (artwork + version files/previews), via `ObjectStorageService.deleteObjectEntity` (best-effort, 404 = success).

Invariants:
- Collect object paths INSIDE the purge transaction (before rows vanish), but delete files only AFTER commit — storage calls can't roll back; a failed file delete is a harmless logged orphan, never a dangling DB reference.
- Reference-count before deleting: a path may be shared across rows (packages.artwork_url, package_versions.file_url/preview_url, proofs.object_path, policies.document_url). Only delete when no surviving row references it.
- SOP/policy retire flows intentionally KEEP files (records retention); only hard purges delete.

**Why:** review caught that naive post-purge deletion could break another row sharing the same path — that would be a true dangling reference, worse than an orphan.
