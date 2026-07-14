---
name: AI model orchestration (tiers + escalation)
description: Tiered AI routing (Luna/Terra/Sol), bounded confidence/risk escalation, and the keyless-custom-fallback model-resolution rule.
---

# AI model orchestration — tiers & escalation

Central routing lives in `ai-orchestration.ts` (workload→tier map, `runTiered`,
thresholds) built on tier resolution in `ai-client.ts`.

## Tier taxonomy
- Codenames map to capability/cost tiers: **fast=Luna, standard=Terra, reasoning=Sol**.
- Default managed-provider models per tier: fast=`gpt-5.4-mini`, standard=`gpt-5.4`
  (the managed default), reasoning=`o4-mini`. These are the models available via
  the workspace OpenAI integration — do not assume arbitrary models exist on a
  custom endpoint.
- Reasoning-tier calls bump `max_completion_tokens` (8192→16384) because o-series
  reasoning tokens count against the completion budget and can truncate JSON.

## Escalation policy
- Only substantive review workloads escalate (packaging_analysis, language_review);
  OCR/field-extraction/version-compare/copilot run at a fixed tier.
- Escalate one step up when result confidence < 85% OR result is high-risk.
- **Bounded**: `MAX_ESCALATIONS=1` + monotonic `nextTier` — a call can never loop.
- Orchestration metadata (tiers used, model, tokens, duration, escalation reason)
  is attached as an optional `orchestration` field on `AnalysisResult` /
  `LanguageReviewResult`. Additive only — client-facing output shapes unchanged.
  Downstream usage-analytics/cost work consumes this field.

## tierModelFor gotcha (regression source)
`buildClient` falls back to the managed OpenAI client for the managed provider
**and** for any custom provider whose key is missing/undecryptable. Model
resolution MUST honor that fallback: when the resolved client is managed
(`usingManaged`), never return a keyless custom provider's own model/overrides —
they target the (unreachable) custom endpoint and would send an unknown model to
the managed endpoint. In the managed-fallback path use the managed default
(standard→`gpt-5.4`, fast/reasoning→tier defaults), honoring overrides only for a
genuinely managed provider. Guarded by `ai-client.tiers.test.ts`.

**Why:** first implementation recomputed standard tier as `provider.model` from
the raw row, which broke standard-tier calls under keyless-custom fallback.
**How to apply:** keep `usingManaged` in `tierModelFor` in sync with
`buildClient`'s client selection; any change to one must be reflected in the other.

## Packaging analysis: fast triage vs deep review (two modes)
`analyzePackaging(..., {deep})` picks one of two modes per call:
- **Fast triage** (default; automatic on upload): pinned to the **managed fast
  model** (gpt-5.4-mini) via `resolveManagedFastClient`, **no escalation**, hard
  **~25s budget** (`PACKAGING_ANALYSIS_DEADLINE_MS`). ~10–12s measured.
- **Deep review** (`deep:true`; the manual "Deep Analysis" button →
  `POST /packages/:id/analyze` background path): the **active engine** at the
  standard tier, **escalation-capable** (standard→reasoning on low-confidence /
  high-risk), **no time cap** — the original thorough path. ~2–4 min on gpt-5.5.

Mechanism: `runTiered` opts `initialTier`/`escalates`/`resolveClient`/`deadlineMs`
select the mode. `deadlineMs` is enforced with a per-attempt `AbortController`
whose signal is passed to `create({...},{signal,maxRetries:0})`; escalation is
skipped when remaining budget < `MIN_ESCALATION_BUDGET_MS`.

**Why:** the active provider ("Dollar Tree OPENAI 2026") maps *every* tier to a
heavy gpt-5.5 (~2 min/pass, no fast override) → 2–4 min reviews. User wanted
upload to be a fast ~30s triage and the explicit re-run to be the deep review.

**How to apply / gotchas:**
- The `deep` flag threads through the **durable job payload**; a missing flag =
  fast (backward-compat for jobs enqueued before the split). Keep it optional.
- The AI cache key MUST include a `deep|fast` discriminator — the base key's model
  component is the active *standard* model for BOTH modes (fast silently bypasses
  to managed gpt-5.4-mini), so without it a fast result could be served to a deep
  request and vice versa.
- **Only the background-enqueued path may be deep.** Synchronous in-request paths
  (metadata-only `/analyze`, `/reprocess`) must stay fast — a multi-minute deep
  pass there hangs the HTTP response.
- Accuracy safeguards (confidence downgrade, disclaimers, human-review flags) and
  full regulatory context (regs/memory/policies/eCFR/FDA) are model-independent
  and identical in both modes.
- Client stepper copy infers mode from `pkg.analyzedAt` (set→deep "few minutes",
  null→fast "~30s"); correct for common flows, wrong only if a package's
  first-ever successful run is deep. UX-only.

## Per-tier overrides
`ai_providers` has nullable `fast_model`/`reasoning_model` columns (standard tier
always = `model`). Admin AI Providers page shows the effective per-tier model per
provider (read-only display); override columns are wired through the provider
POST/PATCH bodies. Managed provider is uneditable, so its tiers show the defaults.

## Unset-override trap (custom providers) — "every AI tool is slow"
For a **custom** (BYO-key) provider, `tierModelFor` resolves fast/reasoning to
`override || standard` — so when `fast_model`/`reasoning_model` are **null, every
tier collapses onto the provider's single `model`.** A provider configured with
only `model` (e.g. the heaviest `gpt-5.5`) therefore runs that heavy model on
*every* workload: not just standard reviews, but the high-volume **fast/utility
tiers** (`ocr`, `field_extraction`, `version_compare`) and **copilot** — and
substantive reviews (language/claims/packaging-deep) that escalate standard→
reasoning do *two* heavy passes. Symptom the user reports: "all the AI tools are
too slow," reviews take minutes, OCR/extraction crawl. It is NOT staging and NOT
per-call infra latency — it's the model, resolved from an unconfigured provider.

**Fix (config, no code):** set the provider's per-tier overrides. Sane OpenAI
mapping: `fast_model=gpt-5.4-mini` (utility + triage), `model` (standard) = a fast
flagship like `gpt-5.4`, `reasoning_model` = a strong model for the rare escalation
(kept `gpt-5.5` here so high-risk/low-confidence copy still gets max rigor).
**Do NOT** make substantive review primary passes a *mini* model (initial tier
`fast`): for a compliance tool a mini model can miss a violation *and* report high
confidence, so it never escalates → false negative. Keep a flagship on every
primary review; only utility/triage rides the mini model.

**Why:** the fallback-to-`standard` is deliberate (an arbitrary custom endpoint
may host only one model name), but for an OpenAI-type provider it silently defeats
the entire tier system. **How to apply:** when a custom provider "feels slow
across the board," first check `fast_model`/`reasoning_model` are set, not null.
The provider PATCH is a *partial* update (writes only fields present in the body),
so direct override edits survive Settings saves unless explicitly cleared. Model
is part of the AI cache key, so changing it serves fresh results with no restart
(provider config is read from the DB on every call).
