import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { db, aiUsageTable } from "@workspace/db";
import { logger } from "./logger";
import type { AiTier } from "./ai-client";
import type { AiWorkload } from "./ai-orchestration";

// ---------------------------------------------------------------------------
// Request-scoped identity (AsyncLocalStorage)
// ---------------------------------------------------------------------------
// AI library functions receive domain objects, not the Express request, so they
// cannot see who is acting. requireAuth runs the downstream handler chain inside
// this store, letting usage logging attribute a request to the acting tenant +
// user without threading identity through every AI call signature. When an AI
// call runs outside a request (e.g. seeding), the store is simply empty.
export type AiUsageIdentity = {
  organizationId?: number | null;
  userId?: number | null;
};

const identityStore = new AsyncLocalStorage<AiUsageIdentity>();

export function runWithAiUsageContext<T>(
  identity: AiUsageIdentity,
  fn: () => T,
): T {
  return identityStore.run(identity, fn);
}

export function currentAiUsageIdentity(): AiUsageIdentity {
  return identityStore.getStore() ?? {};
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------
// Rate card in USD per 1M tokens. This is an *estimate* for the cost dashboard,
// not billed spend (billing/invoicing is explicitly out of scope). Unknown /
// custom models fall back to DEFAULT_RATE.
type Rate = { input: number; output: number };

const MODEL_RATES: Record<string, Rate> = {
  "gpt-5.4": { input: 2.5, output: 10 },
  "gpt-5.4-mini": { input: 0.15, output: 0.6 },
  "o4-mini": { input: 1.1, output: 4.4 },
};
const DEFAULT_RATE: Rate = { input: 1.0, output: 3.0 };

export function rateForModel(model: string): Rate {
  const key = (model || "").trim().toLowerCase();
  if (MODEL_RATES[key]) return MODEL_RATES[key]!;
  // Prefix match handles versioned suffixes (e.g. "gpt-5.4-2026-01").
  const hit = Object.keys(MODEL_RATES).find((m) => key.startsWith(m));
  return hit ? MODEL_RATES[hit]! : DEFAULT_RATE;
}

export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const r = rateForModel(model);
  const cost =
    (Math.max(0, promptTokens) / 1e6) * r.input +
    (Math.max(0, completionTokens) / 1e6) * r.output;
  return Math.round(cost * 1e6) / 1e6;
}

// Normalize the loosely-typed OpenAI `usage` object into token counts. Kept
// local so this module has no runtime dependency on ai-orchestration (avoids an
// import cycle: ai-orchestration -> ai-usage).
function normalizeTokens(usage: unknown): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  const u = (usage ?? {}) as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  const promptTokens = Math.max(0, Math.round(u.prompt_tokens ?? 0));
  const completionTokens = Math.max(0, Math.round(u.completion_tokens ?? 0));
  const totalTokens = Math.max(
    0,
    Math.round(u.total_tokens ?? promptTokens + completionTokens),
  );
  return { promptTokens, completionTokens, totalTokens };
}

// ---------------------------------------------------------------------------
// Usage writer
// ---------------------------------------------------------------------------
export type RecordAiUsageInput = {
  workload: AiWorkload;
  model: string;
  tier?: AiTier | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens?: number;
  durationMs: number;
  success: boolean;
  errorMessage?: string | null;
  reviewType?: string | null;
  riskScore?: number | null;
  confidence?: number | null;
  escalated?: boolean;
  // Authoritative overrides; fall back to the ALS identity when omitted.
  organizationId?: number | null;
  userId?: number | null;
};

// Fire-and-forget usage write. This function NEVER throws and callers must NOT
// await it: recording usage must never slow down or fail the AI response. Any
// error (bad connection, missing table pre-migration, etc.) is swallowed.
export function recordAiUsage(input: RecordAiUsageInput): void {
  try {
    const identity = currentAiUsageIdentity();
    const organizationId =
      input.organizationId ?? identity.organizationId ?? null;
    const userId = input.userId ?? identity.userId ?? null;

    const promptTokens = Math.max(0, Math.round(input.promptTokens || 0));
    const completionTokens = Math.max(
      0,
      Math.round(input.completionTokens || 0),
    );
    const totalTokens = Math.max(
      0,
      Math.round(input.totalTokens ?? promptTokens + completionTokens),
    );

    void db
      .insert(aiUsageTable)
      .values({
        requestId: randomUUID(),
        organizationId,
        userId,
        workload: input.workload,
        reviewType: input.reviewType ?? null,
        model: input.model || "unknown",
        tier: input.tier ?? null,
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd: estimateCostUsd(input.model, promptTokens, completionTokens),
        durationMs: Math.max(0, Math.round(input.durationMs || 0)),
        success: input.success,
        errorMessage: input.errorMessage ?? null,
        riskScore: input.riskScore ?? null,
        confidence: input.confidence ?? null,
        escalated: input.escalated ?? false,
      })
      .catch((err) => {
        logger.debug(
          { err, workload: input.workload },
          "ai usage log failed (non-fatal)",
        );
      });
  } catch (err) {
    // Defensive: never let telemetry disturb the caller.
    logger.debug({ err }, "recordAiUsage threw (non-fatal)");
  }
}

// Wrap a single direct (non-tiered) model call so its tokens, duration and
// outcome are logged. Returns the raw response for the caller to parse. On
// failure it logs a failure row and rethrows so existing error handling is
// unchanged.
export async function trackDirectUsage<R extends { usage?: unknown }>(
  meta: {
    workload: AiWorkload;
    model: string;
    tier?: AiTier | null;
    reviewType?: string | null;
    organizationId?: number | null;
    userId?: number | null;
  },
  run: () => Promise<R>,
): Promise<R> {
  const start = Date.now();
  try {
    const response = await run();
    const { promptTokens, completionTokens, totalTokens } = normalizeTokens(
      response.usage,
    );
    recordAiUsage({
      workload: meta.workload,
      model: meta.model,
      tier: meta.tier ?? null,
      reviewType: meta.reviewType ?? null,
      promptTokens,
      completionTokens,
      totalTokens,
      durationMs: Date.now() - start,
      success: true,
      organizationId: meta.organizationId ?? null,
      userId: meta.userId ?? null,
    });
    return response;
  } catch (err) {
    recordAiUsage({
      workload: meta.workload,
      model: meta.model,
      tier: meta.tier ?? null,
      reviewType: meta.reviewType ?? null,
      promptTokens: 0,
      completionTokens: 0,
      durationMs: Date.now() - start,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      organizationId: meta.organizationId ?? null,
      userId: meta.userId ?? null,
    });
    throw err;
  }
}
