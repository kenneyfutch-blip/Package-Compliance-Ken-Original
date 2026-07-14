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

## Latency-critical pinning (packaging_analysis ~30s budget)
`packaging_analysis` is deliberately pinned to the **managed fast model**
(gpt-5.4-mini) with **no escalation** and a **hard wall-clock budget**
(`PACKAGING_ANALYSIS_DEADLINE_MS`, ~25s) — via `runTiered` opts
`initialTier:"fast"`, `escalates:false`, `resolveClient:resolveManagedFastClient`,
`deadlineMs`. `runTiered` enforces the budget with a per-attempt `AbortController`
whose signal is passed into the model `create({...},{signal,maxRetries:0})`; it
also skips escalation when remaining budget < `MIN_ESCALATION_BUDGET_MS`.

**Why:** the active provider ("Dollar Tree OPENAI 2026") maps *every* tier to a
heavy gpt-5.5 (~2 min/pass, no fast override), and escalation added a second pass
→ 2–4 min total reviews. User required ~30s and accepted the fast-model accuracy
tradeoff. Managed-fast bypasses the active provider entirely (custom fast tier
would just resolve back to gpt-5.5). Measured: 12s on gpt-5.4-mini vs 115–240s.
**How to apply:** don't "re-enable escalation" or route packaging through the
active provider without reconfirming the time budget — either reintroduces the
multi-minute regression. Deterministic accuracy safeguards (confidence downgrade,
disclaimers, human-review flags) and full regulatory context (regs/memory/
policies/eCFR/FDA) are model-independent and stay intact. On timeout the call
throws → job retry/terminal-fail releases the package (never stranded).

## Per-tier overrides
`ai_providers` has nullable `fast_model`/`reasoning_model` columns (standard tier
always = `model`). Admin AI Providers page shows the effective per-tier model per
provider (read-only display); override columns are wired through the provider
POST/PATCH bodies. Managed provider is uneditable, so its tiers show the defaults.
