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

## Per-tier overrides
`ai_providers` has nullable `fast_model`/`reasoning_model` columns (standard tier
always = `model`). Admin AI Providers page shows the effective per-tier model per
provider (read-only display); override columns are wired through the provider
POST/PATCH bodies. Managed provider is uneditable, so its tiers show the defaults.
