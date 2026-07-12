# Packaging Version Control & Compliance Audit — Hardening Report

**Scope:** Packaging Asset Hub, Compliance Platform, and Artwork Management.
**Method:** Gap analysis of the existing system against the enterprise
version-control / auditability / evidence-retention brief, followed by additive
hardening. No existing functionality was removed or rebuilt.

---

## 1. Current Version-Control Assessment

**Strong / already in place**

- Packaging records are persisted in `packages` with `id`, `sku`, `name`
  (product name), `brand`, `category`, `status`, `approvalStatus`, `createdAt`
  (date created) and `updatedAt` (date modified), plus risk/compliance metadata.
- Artwork versions live in an **append-only** `package_versions` table:
  `versionNumber`, `label`, `fileUrl`, `fileName`, `fileType`, `previewUrl`,
  `pageCount`, `extractedText`, `notes`, `isCurrent`, `createdBy`, `createdAt`.
- New uploads **never overwrite** prior versions — a new row is inserted and
  flagged current; historical rows are retained.
- **View history** (`GET /packages/:id/versions`) and **AI compare**
  (`GET /packages/:id/compare/:a/:b`) already exist, surfaced in the review
  workspace version selector and Compare tab.

**Gaps identified (now closed — see §8)**

- No **restore** of a previous version.
- No **download** of a historical version's raw file (only current-version PDF
  export existed).
- No **per-version file hash** stored as tamper-evident integrity evidence.

## 2. Current Audit-Trail Assessment

- `audit_events` is a genuine **immutable, append-only** log: a database trigger
  (`audit_events_no_mutation`) blocks every `UPDATE`/`DELETE` unless the
  archival session GUC is explicitly set. Rows cannot be edited or deleted by
  application code.
- Recorded actions include package created, version added, reviews approved /
  rejected / feedback submitted, AI analyses, and user actions.
- A timeline view is exposed per package (`GET /packages/:id/audit`) and in the
  Audit Center UI.
- **New:** version **restore** now writes its own `Version restored` audit event.

## 3. Current Compliance-History Assessment

- **Decisions:** `approval_decisions` is an append-only approval timeline —
  `decision` (approve / approve_with_comments / needs_revision / reject /
  escalate), `reviewer`, `reviewer_role`, `note`, `created_at`.
- **Workflow history:** `review_history` logs every routed/assigned/escalated/
  completed action with actor, reason, and comments.
- **AI findings:** `claim_analyses`, `claim_findings`, and `violations` retain
  reviewer, risk score, claims found, results, remediation, confidence.
- **Compliance memory:** prior approved/rejected findings are embedded and
  semantically recalled into future AI reviews (org- and supplier-scoped).

## 4. Missing Enterprise Features (assessment)

| Capability | Status |
| --- | --- |
| Restore previous version | **Implemented** this pass |
| Download historical version file | **Implemented** this pass |
| Per-version file hash (integrity) | **Implemented** this pass |
| Immutable audit log | Already present |
| Approval decision timeline | Already present |
| Compliance memory / prior-decision recall | Already present |
| AI change detection between versions | Already present (AI compare) |
| Explicit evidence-attachment table linking arbitrary files to a *decision* | **Recommended** (see §8) |
| Historical AI-run snapshots for run-vs-run comparison | **Recommended** (see §8) |
| Structured search by reviewer / claim / CFR topic | **Partial** — recommended |

## 5. Versioning Gaps

- **Closed:** restore, historical download, file hash.
- **Minor / recommended:** no explicit `previousVersionId` foreign key (ordering
  is by `versionNumber`); no dedicated `market` column (currently `country` /
  `manufacturingRegion`); memory recall is package+timestamp scoped rather than
  version-tagged ("approved on v3").

## 6. Evidence-Retention Gaps

- Historical versions, reviews, approvals, and audit logs are all preserved;
  audit deletion is trigger-blocked and old audit rows are **archived**, not
  dropped. Retention posture is strong.
- **Recommended:** a first-class evidence-attachment table so a specific FDA/FTC
  PDF or supporting file can be linked directly to an individual finding or
  human decision (today evidence is captured as the `violations.evidence` text
  field, uploaded SOPs, and internal policies fed to the AI).

## 7. Compliance-Traceability Gaps

For any package the platform can now answer: who uploaded it (version
`createdBy` + audit), who reviewed it (`approval_decisions` / `review_history`),
what changed (AI compare + version diff), when (timestamps + audit timeline),
why it was approved (decision `note`), what findings existed (`violations` /
`claim_findings`), and which version was active (`isCurrent`). File-level
integrity is now verifiable via the stored SHA-256 per version.

## 8. Recommended Improvements

**Delivered this pass (additive, non-breaking):**

1. **Restore a previous version** — `POST /packages/:id/versions/:versionId/restore`
   appends a *new* version copying the chosen version's file/metadata and marks
   it current (append-only; nothing is overwritten), with a dedicated audit
   event. Surfaced as a **Restore** button in the review workspace.
2. **Download a historical version** — `GET /packages/:id/versions/:versionId/file`
   streams any version's stored artwork (object-storage or seed) as an
   attachment, org-scoped through the standard private-download path. Surfaced
   as a **Download** button.
3. **Per-version file hash** — `package_versions.fileHash` (SHA-256) captured at
   upload and restore time and exposed on the API/UI as tamper-evident evidence.

**Recommended next (not done — larger design/behavioral changes):**

- Evidence-attachment join table (files ↔ findings/decisions).
- Retained AI-run snapshots to enable run-vs-run finding comparison (today
  `claim_analyses` is latest-only by design).
- Structured historical search filters for reviewer, claim text, and CFR topic.
- `previousVersionId` FK and a version-tagged memory reference.

## 9. Database Changes Required

- **Applied:** `package_versions.fileHash text` (additive, nullable; legacy/seed
  rows remain null). Pushed with no data loss.
- **If recommendations adopted:** `evidence_attachments` table; optional
  `claim_analysis_snapshots`; optional `packages.market` and
  `package_versions.previous_version_id`.

## 10. Enterprise-Readiness Score

**Before this pass:** ~8.0 / 10 — immutable audit, append-only versions,
approval timeline, and compliance memory were already enterprise-grade; the
notable gaps were version restore, historical download, and file-integrity
hashing.

**After this pass:** **~9.0 / 10** — the core version-control lifecycle
(create → compare → restore → download, with per-version integrity hashes) and
full traceability are complete. Remaining points are the optional evidence-
attachment model, retained AI-run snapshots, and richer structured search.

---

*Guiding constraint honored throughout: existing detection, workflow, and
retention behavior was left intact; every change above is additive.*
