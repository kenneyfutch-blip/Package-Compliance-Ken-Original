---
name: Claims Compliance Engine
description: Marketing/label claim auditing vertical cloned from the language-review pattern; how it escalates and persists.
---

# Claims Compliance Engine

Audits marketing/label CLAIMS on packaging artwork (Organic, Natural, Clean,
Healthy, Sustainable, Eco-Friendly, Recyclable, Biodegradable, Compostable,
Non-GMO, Gluten Free, Sugar Free, plus any other regulated claim the model
observes). Per claim it produces: jurisdiction, risk band (Low/Medium/High/
Critical), regulation reference, remediation, and a 0-100 confidence.

**Built by cloning the Language Review vertical** — same shape end to end:
`runTiered` orchestration, `cachedAiCall`, two-table latest-only design
(`claim_analyses` aggregate + `claim_findings` detail), org/supplier scoping via
`packageConds(req)`, and `writeAudit`. When touching one vertical, check whether
the other needs the same change.

**Escalation rule:** `claims_review` is a new `AiWorkload`, initial tier
`standard` (Terra), `WORKLOAD_ESCALATES = true`. Its `assess()` returns
`risky: true` whenever any finding is High or Critical (risk-rank >= High), which
drives the one-step escalation to the reasoning tier (Sol / o4-mini). Low/Medium
with adequate confidence stays on Terra.
**Why:** the product contract requires High/Critical claims to get a deeper
reasoning-tier pass; escalation is risk-driven, not a fixed starting tier.

**Routes:** `GET /api/packages/:id/claims` gated `violations:read`;
`POST /api/packages/:id/claims` gated `packages:analyze`. POST returns 502 on AI
failure (matches language-review). Persist deletes prior analysis+findings then
inserts, all in one transaction (latest-only, no mixed old/new rows).

**Naming note:** "Luna/Terra/Sol" are internal *tier codenames* (fast/standard/
reasoning), NOT model versions. There is no "GPT-5.6". Real models: fast=
gpt-5.4-mini, standard=gpt-5.4, reasoning=o4-mini (see ai-orchestration-tiers.md).
