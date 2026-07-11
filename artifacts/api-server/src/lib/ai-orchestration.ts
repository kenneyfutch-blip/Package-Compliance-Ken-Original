import type OpenAI from "openai";
import { resolveAiClientForTier, type AiTier } from "./ai-client";
import { logger } from "./logger";

// The AI operations the orchestrator routes. Each maps to an initial tier and
// whether it may escalate to a stronger tier on low confidence / high risk.
export type AiWorkload =
  | "packaging_analysis"
  | "language_review"
  | "copilot"
  | "ocr"
  | "field_extraction"
  | "version_compare";

export const WORKLOAD_LABELS: Record<AiWorkload, string> = {
  packaging_analysis: "Packaging compliance analysis",
  language_review: "Language review",
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
  }) => Promise<TierAttempt<T>>;
  assess: (result: T) => TierAssessment;
}): Promise<{ result: T; orchestration: AiOrchestration }> {
  const { workload } = opts;
  const initialTier = WORKLOAD_INITIAL_TIER[workload];
  const canEscalate = WORKLOAD_ESCALATES[workload];

  const calls: AiCallRecord[] = [];
  let tier = initialTier;
  let escalations = 0;
  let escalated = false;
  let escalationReason: string | null = null;
  let finalResult!: T;
  let finalModel = "";
  let finalConfidence: number | null = null;

  while (true) {
    const resolved = await resolveAiClientForTier(tier);
    const start = Date.now();
    const attempt = await opts.run({
      client: resolved.client,
      model: resolved.model,
      tier,
    });
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
    const shouldEscalate =
      canEscalate &&
      escalations < MAX_ESCALATIONS &&
      (belowConfidence || assessment.risky);
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

  return { result: finalResult, orchestration };
}
