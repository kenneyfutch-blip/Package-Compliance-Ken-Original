---
name: Finding dismissal ("Not Applicable")
description: Per-finding "Not Applicable" dismissal on the compliance review workspace — score exclusion, memory feedback, and restore semantics.
---

# Finding dismissal ("Not Applicable")

Reviewers can mark an AI finding "Not Applicable" (e.g. text the AI OCR'd from the
artwork's prepress/production layer — color callouts, file names, dielines — that
is not consumer-facing). Endpoints: `POST /violations/:id/dismiss` (body
`{reason, note?}`) and `POST /violations/:id/restore`, both gated by
`violations:write`, tenant-scoped by joining `packagesTable` with
`packageConds(req)`.

## Score exclusion (two layers, must stay in sync)
- Read-time: `computeScorecard` (mappers.ts) counts severities via
  `isFindingCounted(v)` (status is a real issue/warning AND not dismissed).
- Stored counts: `packagesTable.{critical,major,minor}Count` (used by list views)
  are recomputed by `recomputePackageCounts(packageId, executor?)` on every
  dismiss/restore.
- **Why:** the detail scorecard derives from violations live, but list pages read
  the stored counts — both must exclude dismissed findings or the two disagree.
- **AI `grade`/`riskScore` are intentionally left untouched** — they are the AI's
  holistic snapshot, not a deterministic count. Only counts/readiness change.

## Memory feedback
- On dismiss, `captureFindingDismissal` writes ONE compliance_memory row for that
  violation with `approvalStatus: "Approved"` + `outcome: "Not Applicable"` +
  `approvedFix = dismissalResolutionText(...)`. On restore, `removeFindingMemory`
  deletes it. Both are non-fatal (try/catch) — memory must never break the action.
- **Why "Approved":** recall (`retrieveSimilarFindings`) filters
  `approval_status = 'Approved'`, so a dismissal only teaches future AI reviews if
  stored as Approved. The `outcome`/resolution text tell the AI the team treats
  such content as a non-issue.

## Restore is a true reversal (not "reopen to Open")
- Nullable `violations.dismissPriorStatus` saves the status held before dismissal
  (guard: don't overwrite it when re-dismissing an already-dismissed row).
- Restore sets status back to `dismissPriorStatus ?? "Open"` and clears dismiss
  fields. **Why:** a finding could be dismissed from a non-Open state
  (e.g. Acknowledged/Fixed); hard-coding Open on restore silently rewrites review
  state/history.

## Atomicity
- Status update + `recomputePackageCounts` run in one `db.transaction` (recompute
  accepts an optional executor). Memory capture + `writeAudit` follow after commit;
  writeAudit stays outside the tx by design (it uses the module `db`, and a missing
  audit row on an otherwise-consistent commit beats refactoring the shared audit
  writer). **Why:** counts must never drift from the finding's state mid-failure.

## Auth
- Actor identity comes from `getAuthContext(req)` / `writeAudit(req, ...)`, never
  the request body. `dismissedBy` = display name, `dismissedByUserId` = internal id.
