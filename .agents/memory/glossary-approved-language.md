---
name: Approved Language & Glossary library
description: Resource Center glossary feature — permissions, change tracking, and review-engine integration decisions.
---

# Approved Language & Glossary

The editable approved-language / glossary library that fills the previously-reserved
Resource Center "glossary" section. Org-scoped reference data modeled on the Policy engine.

## Key decisions

- **Dedicated permissions `glossary:read` / `glossary:write`** (category "policies"), NOT reused `policies:*`.
  **Why:** glossary is a distinct content type; each managed content type has its own read/write.
  **How to apply:** grant these in `permissions.ts` ROLES arrays (provisioning resolves from code, not DB).
  `supplier_user` is intentionally excluded from `glossary:read` — approved internal brand language must not leak to suppliers.

- **Change tracking = the immutable audit trail, not a versions table.** Every create/update/retire calls
  `writeAudit` with `entityType: "glossary_entry"` and before/after. The `/glossary/:id/history` endpoint reads
  those audit_events. `createdBy`/`updatedBy` are denormalized on the row for quick display only.
  **Why:** audit is already immutable + org-scoped; a separate versions table would duplicate it.

- **Retire = status "active" | "retired" via PATCH** (not a delete). Retired entries are hidden from browse/search
  and are NOT fed to the review engine, but remain for audit history. List defaults to active-only; pass
  `status=all` or `status=retired` to include them.

- **Review-engine integration:** active entries are loaded org-scoped and passed as a third arg to
  `analyzeLanguage(pkg, regulations, approvedLanguage)`; they render as an "ORGANIZATION APPROVED LANGUAGE & GLOSSARY"
  block in the prompt. Do NOT duplicate the review flow — feed context in. Reviewer-facing lookup is a collapsible
  panel inside `language-review-tab.tsx` gated by `glossary:read`.

- **resources.ts:** glossary is now a REAL searchable + counted resource (`available: canGlossary`). Overview/search
  endpoints added `glossary:read` to their `requireAnyPermission` gate. After SOP documents also became real, no
  reserved resource types remain (`type ReservedType = never`, `reserved = []`).
