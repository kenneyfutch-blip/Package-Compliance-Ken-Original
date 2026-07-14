---
name: AI Language Review Engine
description: Language review module (6 detection layers + quality score) — persistence, scoping, and perf decisions worth staying consistent with.
---

# AI Language Review Engine

A first-class compliance module (not a spell checker) that reviews packaging copy across
six layers: Spelling, Grammar, Context, Regulatory, Marketing Claim (with claim-risk score
+ FDA/EPA/FTC/Legal review flags), and Brand Language. Produces a Language Quality Score (0-100).

## Key decisions (stay consistent)

- **Runs automatically as part of the initial upload analysis** — the background package-analysis
  job (`runPackageAnalysis`) invokes the language review after compliance analysis, so the Language
  Quality panel is populated on first upload with NO manual "Language Review" re-run. **Why:** users
  expect spelling/grammar checked on upload; before this it only ran on the manual button, leaving
  the widget at all-zeros. The call is **non-fatal** (try/catch): a language failure must never fail
  the compliance job or strand the package status.
- **Single shared orchestration** in `lib/language-review.ts`: `analyzeAndPersistLanguageReview`
  (load context → `analyzeLanguage` → persist, no audit) is used by BOTH the manual HTTP route and
  the background job. `persistLanguageReviewCore` holds the latest-only txn. **Why:** the manual route
  once had its own copy of regulation/glossary loading + analyze call; keeping two paths risks silent
  divergence of analysis inputs. Only audit-writing is split by actor: route → `writeAudit(req)`
  (real user), job → `writeSystemAudit` (System/uploader). Bulk loads context once and reuses it.
- **Synchronous processing** for the manual route, mirroring the existing `analyzePackaging` flow.
  **Why:** full async overlaps a separate scalability track; keep parity with existing analysis.
- **Dedicated tables** `language_reviews` (per-run aggregate) + `language_findings` (per issue),
  not reused `violations`. Denormalized `languageScore/languageIssueCount/languageCriticalCount/
  languageAnalyzedAt` onto `packages` for fast bulk/dashboard listing.
- **Latest-only semantics:** running a review replaces the prior review + findings for that
  package. This MUST be done in a single DB transaction (delete findings, delete review,
  insert review, insert findings, update package). **Why:** concurrent re-runs on the same
  package otherwise interleave and leave duplicate/stale review chains, and the findings list
  reads all findings by package (not only the latest review), so stragglers would surface.
- **Reused permission keys** (no RBAC reseed): reads -> `violations:read`, finding updates ->
  `violations:write`, run review -> `packages:analyze`, dashboard -> `dashboard:read`.
- **Historical usage** (how often a suggested fix was previously approved) is computed at read
  time, never stored. Query MUST be bounded by the current result set's candidate texts
  (`inArray` on approvedFix/suggestedText) — never scan all approved/resolved findings for the org.
- **Findings list** joins findings->packages in SQL with `packageConds(req)` and score bounds
  applied in SQL. **Why:** preloading all scoped packages into memory to filter was an N+1/scan risk.

## Frontend surfaces
- `/ai/language` center page, per-package "Language Review" tab in the review workspace (with
  artwork bbox overlay driven by the active tab), dashboard Language Quality widget, and a bulk
  language-review column + action. `Package` summary schema carries `languageScore` for listings.
