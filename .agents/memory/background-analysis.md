---
name: Background package analysis
description: Upload offloads AI compliance analysis to a durable job; the "AI Review" holding state and the rules that keep packages from hanging in it.
---

# Background package analysis

Package creation does **not** run AI compliance analysis synchronously anymore. When a
new package has extracted text, the create handler sets `status = "AI Review"` and
enqueues a durable `package.analysis` job; the upload response returns immediately
(~250ms). The job runs the full analysis (which can escalate to the slow reasoning tier
and take minutes), persists it, and routes the package to a team at the correct
priority. The web review page polls while `status === "AI Review"` and shows an
"Analyzing…" state until results land.

**Why:** the reasoning-tier escalation makes analysis take up to ~3 minutes for
high-risk items; blocking the upload on it made the core Upload→Analyze flow feel
broken. Backgrounding it keeps the upload snappy.

**The invariant that matters:** a package must never be left in `"AI Review"` with no
job that will complete it. Three exit paths enforce this — break any one and packages
hang in a permanent "Analyzing…" limbo:
1. Job success → `applyAnalysis` sets the final status (Approved/Needs Revision).
2. Job **permanent** failure (last attempt, `job.attempts >= job.maxAttempts`) → the
   handler sets status to `"Needs Review"` before rethrowing.
3. **Enqueue** failure in the create handler → the catch drops status to
   `"Needs Review"` and auto-assigns for manual handling (don't just log).

**How to apply:** if you add another status-holding + background-job pattern, wire all
three exits. Assignment now happens *inside the job* (correct priority from the
analysis's critical count) for the text path; only the no-text branch assigns
synchronously at create. Supplier-scoped memory recall is preserved by passing
`supplierId` through the job payload (supplier uploads must not recall other suppliers'
findings). The worker polls every 10s; `pokeJobWorker()` is called after enqueue so
analysis starts without the poll delay.
