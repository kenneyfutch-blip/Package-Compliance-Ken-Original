---
name: Background package analysis
description: Upload offloads AI compliance analysis to a durable job; the "AI Review" holding state and the rules that keep packages from hanging in it.
---

# Background package analysis

Package creation does **not** run AI compliance analysis — **nor OCR** — synchronously
anymore. The create handler enqueues a durable `package.analysis` job whenever there is
extracted text OR an artwork file to OCR, sets `status = "AI Review"`, and returns
immediately (~250-290ms). The job: (1) if the package has no `extractedText` (scanned /
flattened PDF or image with no selectable text layer), runs the OCR provider now to read
the artwork; (2) runs the full AI analysis (which can escalate to the slow reasoning tier
and take minutes); (3) persists it and routes the package to a team at the correct
priority. The web review page polls while `status === "AI Review"` and shows an
"Analyzing…" state until results land. Metadata-only uploads (no text, no artwork) skip
the job and get synchronous manual assignment.

**Why:** both the reasoning-tier escalation (up to ~3 min for high-risk items) *and*
Vision OCR of a scanned PDF are slow. Running either in the upload request made the core
Upload→Analyze flow feel broken. Backgrounding both keeps every upload snappy while the
AI still reads the PDF via OCR.

**Req-free OCR:** `runExtraction` accepts an optional `req` and an optional explicit
`organizationId`; the background job passes `organizationId` (no Express request) and the
function writes a system audit (`writeSystemAudit`) instead of a request-scoped one.
Retried jobs re-running OCR is safe because extraction is content-hash cached
(`Complete` by `packageId + sourceHash`).

**`"AI Review"` is a RESERVED transient string — never a terminal outcome.** Once it
became the "queued/analyzing" holding state the review page polls on, nothing that runs
*after* analysis may leave a package on it. `gradeToStatus` (packageService.ts) must map
every analyzer `complianceStatus` to a terminal status: `Passed→Approved`,
`Failed→Needs Revision`, and everything else (incl. `"Needs Review"`, the analyzer's
default) → `"Needs Review"`. Returning `"AI Review"` for a middling result strands a
fully-analyzed package in a permanent "Analyzing…" spinner.
**Why:** the analyzer emits `complianceStatus ∈ {Passed, Failed, Needs Review}` (coerced
in ai.ts, default "Needs Review"); the middling bucket is the common case, so any
terminal string collision here hits most real uploads, not an edge case. Any time a
status string is repurposed as a transient/polled state, sweep every writer that could
still emit it as a terminal value.

**The invariant that matters:** a package must never be left in `"AI Review"` with no
job that will complete it. Four exit paths enforce this — break any one and packages
hang in a permanent "Analyzing…" limbo:
1. Job success → `applyAnalysis` sets the final status (Approved/Needs Revision).
2. Job **permanent** failure (last attempt, `job.attempts >= job.maxAttempts`) → the
   handler sets status to `"Needs Review"` before rethrowing.
3. **Enqueue** failure in the create handler → the catch drops status to
   `"Needs Review"` and auto-assigns for manual handling (don't just log).
4. **No text even after OCR** → split by cause. A *transient* OCR failure — the provider
   threw, or returned `Failed`, or returned `Skipped` for a stored `/objects/...` artwork
   that *should* have resolved (an object-store read blip or an upload-vs-analyze race) —
   must **throw** so the durable queue retries (bounded by `maxAttempts`), instead of
   swallowing the error and stranding the package needing a manual Reprocess. A *permanent*
   no-text result (`Unsupported`, `NotConfigured`, `Skipped` for remote/data-URL/absent
   artwork, or `Complete` but genuinely empty) → the job moves status to `"Needs Review"`
   and auto-assigns, returning `analyzed:false` (no throw, no retry storm — retrying can't
   help). **Why:** the original code caught *every* OCR failure and returned normally, so
   the job was marked completed and the queue never retried; a momentary source-resolution
   hiccup on upload therefore left a fully-uploaded artwork package permanently showing
   "No extraction" until a human clicked Reprocess. Retries are safe to re-run OCR because
   the content-hash cache only returns `Complete` rows — a prior `Failed`/`Skipped` attempt
   never short-circuits the retry.

**Manual re-run must also background + dedupe.** The manual `POST /packages/:id/analyze`
("Re-run AI" button) originally ran analysis synchronously and blocked the HTTP request
for the full 1-4 min (button "just spins"). It must mirror the upload path: set
`"AI Review"` + enqueue the job + return immediately (metadata-only packages, no text/no
artwork, keep the synchronous path since the job requires text). Critically, any endpoint
that enqueues analysis needs an **atomic single-flight guard** — claim the package with a
conditional `UPDATE ... SET status='AI Review' WHERE id=? AND status<>'AI Review'
RETURNING id`; if 0 rows, it's already analyzing, so return current detail idempotently
instead of enqueuing. Postgres serializes the row update, so concurrent re-runs (double
click, multi-tab, multi-user) produce exactly one job — not duplicate expensive AI calls
and out-of-order overwrites. The client-side disabled-button guard is not enough (races
before status propagates).

**How to apply:** if you add another status-holding + background-job pattern, wire all
three exits. Assignment now happens *inside the job* (correct priority from the
analysis's critical count) for the text path; only the no-text branch assigns
synchronously at create. Supplier-scoped memory recall is preserved by passing
`supplierId` through the job payload (supplier uploads must not recall other suppliers'
findings). The worker polls every 10s; `pokeJobWorker()` is called after enqueue so
analysis starts without the poll delay.

**Document AI tab must reflect the in-flight state.** The extraction tab renders off the
`document_extractions` record, which only exists once OCR *finishes*. During the normal
background window (package `status === "AI Review"`) there is no record yet, so a static
"No extraction has run — click Reprocess" empty state pushes users to Reprocess
unnecessarily (and a Provided-text package analyzed on its own text layer never gets an
OCR record at all). While `status === "AI Review"` the tab must show an "extraction
running" state and poll (`refetchInterval`) so it populates on its own. An empty
extraction record ≠ "nothing happened."
