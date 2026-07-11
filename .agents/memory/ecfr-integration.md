---
name: eCFR Regulatory Data integration
description: How live eCFR federal regulation content is synced, stored, recalled, and injected into the compliance review pipeline.
---

# eCFR Regulatory Data

Additive regulatory source of truth alongside the hand-seeded `regulations` table
and the openFDA proxy. Content is synced locally on a weekly schedule and recalled
semantically at analysis time — **never fetched live during a review**. Everything
fails safe: reviews never break when eCFR is unreachable/unsynced.

## eCFR public API (no key needed)
- Base: `https://www.ecfr.gov`. Public federal data — always "configured".
- Titles list: `GET /api/versioner/v1/titles.json` → each title has
  `latest_issue_date` / `up_to_date_as_of`. Use the title's own latest issue date
  as the edition to fetch content from.
- Part XML: `GET /api/versioner/v1/full/{date}/title-{title}.xml?part={part}`.
  **Always fetch ONE part at a time** (sub-MB, sub-second). Never a whole title.
- XML shape: sections are `<DIV8 N="101.9" TYPE="SECTION">` with a `<HEAD>` and
  `<P>` bodies. Dependency-free regex parse (the package firewall blocks XML libs);
  citation is just `{title} CFR {N}`.

## Curated coverage (the only parts mirrored)
Title 21 (FDA): 101 food, 111 supplement CGMP, 201 drug, 701 cosmetic.
Title 40 (EPA): 156 + 152 pesticide/antimicrobial. Add more in `CURATED_PARTS`
(lib/ecfr/router.ts); each part carries a category tag that scopes recall.

## Storage & recall
- Global (NOT org-scoped) table `ecfr_sections`; unique on `citation` for idempotent
  replace. Reuses the self-contained 512-dim hashed embedder + pgvector HNSW cosine
  index (same convention as Compliance Memory). Index created at startup.
- Sync replaces rows **per (title,part) in a transaction** so a failed part keeps
  its old rows and never wipes the rest. Reserved/empty sections are skipped.

## Job & endpoints
- Weekly recurring job `ecfr.sync` (self-reschedules via ensurePendingJob, mirrors
  escalation sweep); an initial run is scheduled ~30s after startup so fresh deploys
  populate without waiting a week.
- Routes: `GET /ecfr/status` + `POST /ecfr/sync` are admin-scoped
  (`ai_providers:read` / `ai_providers:write` — matches the Integrations page guard);
  `GET /ecfr/intelligence?packageId=` + `GET /ecfr/search?q=` use `fda:read`
  (broad, incl. suppliers), consistent with the FDA endpoints.

## Analysis injection
- `analyzePackaging(...)` takes a 5th `cfrRegulations` string param; packages.ts
  builds it via non-fatal `ecfrRegulationsFor(pkg)` at all 4 analyze call sites.
  Prompt instructs the model to cite the exact synced section (e.g. "21 CFR 101.9").

**Why fetch-by-part + local sync:** full CFR titles are far too large to pull during
a review; per-part fetch is fast and the weekly cache keeps reviews deterministic and
offline-safe.
