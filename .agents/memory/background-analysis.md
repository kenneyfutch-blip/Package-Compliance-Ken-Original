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

**The invariant that matters:** a package must never be left in `"AI Review"` with no
job that will complete it. Four exit paths enforce this — break any one and packages
hang in a permanent "Analyzing…" limbo:
1. Job success → `applyAnalysis` sets the final status (Approved/Needs Revision).
2. Job **permanent** failure (last attempt, `job.attempts >= job.maxAttempts`) → the
   handler sets status to `"Needs Review"` before rethrowing.
3. **Enqueue** failure in the create handler → the catch drops status to
   `"Needs Review"` and auto-assigns for manual handling (don't just log).
4. **No text even after OCR** (unreadable scanned artwork) → the job itself moves status
   to `"Needs Review"` and auto-assigns, then returns `analyzed:false` (not a throw, so
   no retry storm).

**How to apply:** if you add another status-holding + background-job pattern, wire all
three exits. Assignment now happens *inside the job* (correct priority from the
analysis's critical count) for the text path; only the no-text branch assigns
synchronously at create. Supplier-scoped memory recall is preserved by passing
`supplierId` through the job payload (supplier uploads must not recall other suppliers'
findings). The worker polls every 10s; `pokeJobWorker()` is called after enqueue so
analysis starts without the poll delay.
