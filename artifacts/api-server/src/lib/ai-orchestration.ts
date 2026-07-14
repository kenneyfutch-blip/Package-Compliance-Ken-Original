import type OpenAI from "openai";
import {
  resolveAiClientForTier,
  type AiTier,
  type ResolvedTierClient,
} from "./ai-client";
import { logger } from "./logger";
import { recordAiUsage } from "./ai-usage";

// The AI operations the orchestrator routes. Each maps to an initial tier and
// whether it may escalate to a stronger tier on low confidence / high risk.
export type AiWorkload =
  | "packaging_analysis"
  | "language_review"
  | "claims_review"
  | "copilot"
  | "ocr"
  | "field_extraction"
  | "version_compare";

export const WORKLOAD_LABELS: Record<AiWorkload, string> = {
  packaging_analysis: "Packaging compliance analysis",
  language_review: "Language review",
  claims_review: "Claims compliance",
  copilot: "Compliance copilot",
  ocr: "Artwork OCR",
  field_extraction: "Metadata extraction",
  version_compare: "Version comparison",
};

// Initial tier per workload. Substantive reasoning starts at standard; cheap,
// high-volume utility work starts at fast.
export const WORKLOAD_INITIAL_TIER: Record<AiWorkload, AiTier> = {
  packaging_analysis: "standard",
  language_review: "standard",
  claims_review: "standard",
  copilot: "standard",
  ocr: "fast",
  field_extraction: "fast",
  version_compare: "fast",
};

// Only substantive review workloads (with real confidence/risk signals)
// escalate; utility calls run at a fixed tier.
export const WORKLOAD_ESCALATES: Record<AiWorkload, boolean> = {
  packaging_analysis: true,
  language_review: true,
  claims_review: true,
  copilot: false,
  ocr: false,
  field_extraction: false,
  version_compare: false,
};

const TIER_ORDER: AiTier[] = ["fast", "standard", "reasoning"];

// Escalate when the result's confidence is below this (percent) or the result
// is high-risk. Bounded to a single escalation so a call can never loop.
export const CONFIDENCE_ESCALATION_THRESHOLD = 85;
export const MAX_ESCALATIONS = 1;

export function nextTier(tier: AiTier): AiTier | null {
  const i = TIER_ORDER.indexOf(tier);
  return i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1]! : null;
}

export type AiUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type TierAttempt<T> = { result: T; usage: AiUsage };

export type TierAssessment = {
  confidence: number | null; // 0-100
  risky: boolean;
  reason?: string;
};

export type AiCallRecord = {
  tier: AiTier;
  codename: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
};

// Orchestration metadata attached to AI results. Auditable, and consumable by
// downstream usage-analytics/cost reporting.
export type AiOrchestration = {
  workload: AiWorkload;
  initialTier: AiTier;
  finalTier: AiTier;
  finalModel: string;
  escalated: boolean;
  escalationReason: string | null;
  confidence: number | null;
  totalTokens: number;
  totalDurationMs: number;
  calls: AiCallRecord[];
};

// Normalize an OpenAI usage object into our token record.
export function readUsage(usage: unknown): AiUsage {
  const u = (usage ?? {}) as Record<string, unknown>;
  const prompt = Number(u["prompt_tokens"] ?? 0) || 0;
  const completion = Number(u["completion_tokens"] ?? 0) || 0;
  const total = Number(u["total_tokens"] ?? prompt + completion) || 0;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
  };
}

/**
 * Run an AI workload with tiered routing and bounded confidence/risk
 * escalation. Resolves the workload's initial tier, runs the operation, and —
 * for escalatable workloads — retries once on the next tier up when the result
 * is low-confidence or high-risk. Returns the final result plus orchestration
 * metadata (tiers used, model, tokens, duration, escalation reason).
 */
export async function runTiered<T>(opts: {
  workload: AiWorkload;
  run: (ctx: {
    client: OpenAI;
    model: string;
    tier: AiTier;
    // Abort signal set when a deadlineMs budget is active — pass it to the model
    // request so a slow call is cancelled at the deadline.
    signal?: AbortSignal;
  }) => Promise<TierAttempt<T>>;
  assess: (result: T) => TierAssessment;
  // Optional attribution + telemetry hooks for usage/cost logging. organizationId
  // is authoritative when the caller knows it (from the domain object); userId
  // falls back to the request's AsyncLocalStorage identity.
  context?: {
    organizationId?: number | null;
    userId?: number | null;
    reviewType?: string | null;
  };
  // Extract a 0-100 compliance risk score from the final result, if meaningful.
  riskScoreOf?: (result: T) => number | null;
  // Override the workload's default starting tier.
  initialTier?: AiTier;
  // Override whether this call may escalate a tier on low confidence/high risk.
  escalates?: boolean;
  // Override per-tier client/model resolution — e.g. pin a latency-critical
  // workload to the managed fast model regardless of the active provider.
  resolveClient?: (
    tier: AiTier,
  ) => Promise<ResolvedTierClient> | ResolvedTierClient;
  // Hard wall-clock budget (ms) for the AI call(s). Each attempt is aborted if
  // it would run past the remaining budget, and escalation is skipped when the
  // budget can't fit another call — so the workload returns (or fails fast)
  // within the budget instead of running for minutes.
  deadlineMs?: number;
}): Promise<{ result: T; orchestration: AiOrchestration }> {
  const { workload } = opts;
  const initialTier = opts.initialTier ?? WORKLOAD_INITIAL_TIER[workload];
  const canEscalate = opts.escalates ?? WORKLOAD_ESCALATES[workload];
  const resolve = opts.resolveClient ?? resolveAiClientForTier;
  const deadline = opts.deadlineMs != null ? Date.now() + opts.deadlineMs : null;
  // Only escalate when a second call can plausibly finish in the remaining
  // budget; otherwise keep the first (low-confidence) result.
  const MIN_ESCALATION_BUDGET_MS = 8_000;

  const calls: AiCallRecord[] = [];
  let tier = initialTier;
  let escalations = 0;
  let escalated = false;
  let escalationReason: string | null = null;
  let finalResult!: T;
  let finalModel = "";
  let finalConfidence: number | null = null;
  const overallStart = Date.now();

  try {
    while (true) {
      const resolved = await resolve(tier);
      // Bound this attempt to the remaining budget (if any) via an abort signal
      // the caller passes to the model request, so a slow model can't overrun.
      let signal: AbortSignal | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (deadline != null) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new Error(
            `AI ${workload} exceeded its ${opts.deadlineMs}ms time budget`,
          );
        }
        const controller = new AbortController();
        signal = controller.signal;
        timer = setTimeout(() => controller.abort(), remaining);
        if (typeof timer.unref === "function") timer.unref();
      }
      const start = Date.now();
      let attempt: TierAttempt<T>;
      try {
        attempt = await opts.run({
          client: resolved.client,
          model: resolved.model,
          tier,
          signal,
        });
      } finally {
        if (timer) clearTimeout(timer);
      }
      const durationMs = Date.now() - start;
      calls.push({
        tier,
        codename: resolved.codename,
        model: resolved.model,
        promptTokens: attempt.usage.promptTokens,
        completionTokens: attempt.usage.completionTokens,
        totalTokens: attempt.usage.totalTokens,
        durationMs,
      });

      const assessment = opts.assess(attempt.result);
      finalResult = attempt.result;
      finalModel = resolved.model;
      finalConfidence = assessment.confidence;

      const belowConfidence =
        assessment.confidence != null &&
        assessment.confidence < CONFIDENCE_ESCALATION_THRESHOLD;
      const budgetForEscalation =
        deadline == null || deadline - Date.now() > MIN_ESCALATION_BUDGET_MS;
      const shouldEscalate =
        canEscalate &&
        escalations < MAX_ESCALATIONS &&
        (belowConfidence || assessment.risky) &&
        budgetForEscalation;
      const target = shouldEscalate ? nextTier(tier) : null;

      if (!target) break;

      escalations += 1;
      escalated = true;
      escalationReason =
        assessment.reason ??
        (belowConfidence
          ? `Confidence ${assessment.confidence}% below ${CONFIDENCE_ESCALATION_THRESHOLD}% threshold`
          : "High-risk result");
      tier = target;
    }

    const orchestration: AiOrchestration = {
      workload,
      initialTier,
      finalTier: tier,
      finalModel,
      escalated,
      escalationReason,
      confidence: finalConfidence,
      totalTokens: calls.reduce((a, c) => a + c.totalTokens, 0),
      totalDurationMs: calls.reduce((a, c) => a + c.durationMs, 0),
      calls,
    };

    logger.info(
      {
        workload,
        initialTier,
        finalTier: orchestration.finalTier,
        finalModel,
        escalated,
        escalationReason,
        confidence: finalConfidence,
        totalTokens: orchestration.totalTokens,
      },
      "AI orchestration",
    );

    // Fire-and-forget usage row (real model calls only; cache hits never reach
    // here). Never awaited — logging must not slow or fail the AI response.
    recordAiUsage({
      workload,
      model: finalModel,
      tier: orchestration.finalTier,
      promptTokens: calls.reduce((a, c) => a + c.promptTokens, 0),
      completionTokens: calls.reduce((a, c) => a + c.completionTokens, 0),
      totalTokens: orchestration.totalTokens,
      durationMs: orchestration.totalDurationMs,
      success: true,
      escalated,
      confidence: finalConfidence,
      riskScore: opts.riskScoreOf ? opts.riskScoreOf(finalResult) : null,
      reviewType: opts.context?.reviewType ?? null,
      organizationId: opts.context?.organizationId ?? null,
      userId: opts.context?.userId ?? null,
    });

    return { result: finalResult, orchestration };
  } catch (err) {
    recordAiUsage({
      workload,
      model: finalModel || "unknown",
      tier,
      promptTokens: calls.reduce((a, c) => a + c.promptTokens, 0),
      completionTokens: calls.reduce((a, c) => a + c.completionTokens, 0),
      durationMs: Date.now() - overallStart,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      escalated,
      reviewType: opts.context?.reviewType ?? null,
      organizationId: opts.context?.organizationId ?? null,
      userId: opts.context?.userId ?? null,
    });
    throw err;
  }
}
