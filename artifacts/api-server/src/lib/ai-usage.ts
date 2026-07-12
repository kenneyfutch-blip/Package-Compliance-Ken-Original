import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { db, aiUsageTable, aiUsageWriteHealthTable } from "@workspace/db";
import { gte } from "drizzle-orm";
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
// Usage-write health signal
// ---------------------------------------------------------------------------
// Usage logging is fire-and-forget, so a failing telemetry write is otherwise
// invisible (swallowed below the default log level). That means the AI cost /
// usage dashboards can silently under-report or go stale with nobody noticing.
// To give admins visibility WITHOUT ever blocking the AI path, every write
// outcome updates a process-local health counter, and ongoing failures emit a
// rate-limited warn-level log. This is a lightweight in-memory signal (it
// resets on restart and is per-process); it is a health hint, not an audit
// ledger.
//
// To make the signal correct when the API runs on MORE THAN ONE instance, each
// process also periodically flushes its local counters into a shared table
// (aiUsageWriteHealthTable, one row per instance) via a throttled heartbeat, and
// the /ai-usage/health endpoint aggregates across all recently-seen instances.
// The heartbeat is off the AI path, so this never adds latency to AI responses.
const WARN_INTERVAL_MS = 60_000;

// Per-process instance id: one row in the shared health table belongs to this
// process. Restarts get a fresh id; the old row goes stale and is ignored.
const INSTANCE_ID = `instance-${process.pid}-${randomUUID().slice(0, 8)}`;

// How often each instance flushes its local counters to the shared table.
const HEALTH_FLUSH_INTERVAL_MS = 20_000;
// Instances whose heartbeat is older than this are treated as gone and excluded
// from the aggregate (≈4 missed flushes of slack for GC pauses / hiccups).
const INSTANCE_STALE_MS = 90_000;

type WriteHealth = {
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureMessage: string | null;
};

const writeHealth: WriteHealth = {
  successes: 0,
  failures: 0,
  consecutiveFailures: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastFailureMessage: null,
};

let lastWarnAt = 0;
let failuresSinceLastWarn = 0;

function onWriteSuccess(): void {
  writeHealth.successes += 1;
  writeHealth.consecutiveFailures = 0;
  writeHealth.lastSuccessAt = Date.now();
}

function onWriteFailure(err: unknown, workload: string): void {
  writeHealth.failures += 1;
  writeHealth.consecutiveFailures += 1;
  writeHealth.lastFailureAt = Date.now();
  writeHealth.lastFailureMessage =
    err instanceof Error ? err.message : String(err);
  failuresSinceLastWarn += 1;

  // Keep full detail at debug for local dev.
  logger.debug({ err, workload }, "ai usage log failed (non-fatal)");

  // Escalate to warn (above the default level) at most once per interval so an
  // ongoing telemetry outage is visible without flooding logs on every AI call.
  const now = Date.now();
  if (now - lastWarnAt >= WARN_INTERVAL_MS) {
    logger.warn(
      {
        failuresSinceLastWarn,
        totalFailures: writeHealth.failures,
        consecutiveFailures: writeHealth.consecutiveFailures,
        lastFailureMessage: writeHealth.lastFailureMessage,
      },
      "AI usage telemetry writes are failing — cost/usage dashboards may under-report",
    );
    lastWarnAt = now;
    failuresSinceLastWarn = 0;
  }
}

export type AiUsageWriteHealth = {
  // True when the most recent write attempt succeeded (or none has run yet).
  // Fleet-wide: false if ANY active instance is currently failing.
  healthy: boolean;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
  // Number of running API instances currently contributing to this signal
  // (heartbeats seen within the freshness window). Always ≥ 1 (this process).
  instanceCount: number;
};

// Snapshot of THIS process's usage-write health. Reflects only the local,
// in-memory counters (resets on restart, per-process). Used as the fleet
// aggregator's fresh view of this instance and as the fail-safe fallback when
// the shared table is unreadable.
export function aiUsageWriteHealthSnapshot(): AiUsageWriteHealth {
  return {
    healthy: writeHealth.consecutiveFailures === 0,
    successes: writeHealth.successes,
    failures: writeHealth.failures,
    consecutiveFailures: writeHealth.consecutiveFailures,
    lastSuccessAt: writeHealth.lastSuccessAt
      ? new Date(writeHealth.lastSuccessAt).toISOString()
      : null,
    lastFailureAt: writeHealth.lastFailureAt
      ? new Date(writeHealth.lastFailureAt).toISOString()
      : null,
    lastFailureMessage: writeHealth.lastFailureMessage,
    instanceCount: 1,
  };
}

// ---------------------------------------------------------------------------
// Fleet-wide health (multi-instance)
// ---------------------------------------------------------------------------
// The in-memory counters above only describe THIS process. Once the API runs on
// several instances, an admin polling /ai-usage/health could hit a healthy
// process while another is silently dropping writes. To close that gap each
// instance heartbeats its counters into a shared table and the endpoint
// aggregates across all instances seen recently.

// Per-instance view used while aggregating (numeric timestamps for easy max()).
type InstanceHealth = {
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastSuccessMs: number | null;
  lastFailureMs: number | null;
  lastFailureMessage: string | null;
};

function localInstanceHealth(): InstanceHealth {
  return {
    successes: writeHealth.successes,
    failures: writeHealth.failures,
    consecutiveFailures: writeHealth.consecutiveFailures,
    lastSuccessMs: writeHealth.lastSuccessAt,
    lastFailureMs: writeHealth.lastFailureAt,
    lastFailureMessage: writeHealth.lastFailureMessage,
  };
}

// Flush this instance's current counters to its row in the shared table. Called
// on a throttled heartbeat (never on the AI path). Non-throwing: a failed flush
// is logged at debug and otherwise ignored so telemetry-health plumbing can
// never disturb request handling. Note we do NOT feed a failed flush back into
// the write-health counters (those track ai_usage ledger writes, not this
// heartbeat) to avoid a self-referential failure loop.
export async function flushAiUsageWriteHealth(): Promise<void> {
  try {
    const now = new Date();
    const row = {
      successes: writeHealth.successes,
      failures: writeHealth.failures,
      consecutiveFailures: writeHealth.consecutiveFailures,
      lastSuccessAt: writeHealth.lastSuccessAt
        ? new Date(writeHealth.lastSuccessAt)
        : null,
      lastFailureAt: writeHealth.lastFailureAt
        ? new Date(writeHealth.lastFailureAt)
        : null,
      lastFailureMessage: writeHealth.lastFailureMessage,
      updatedAt: now,
    };
    await db
      .insert(aiUsageWriteHealthTable)
      .values({ instanceId: INSTANCE_ID, ...row })
      .onConflictDoUpdate({
        target: aiUsageWriteHealthTable.instanceId,
        set: row,
      });
  } catch (err) {
    logger.debug({ err }, "ai usage write-health heartbeat failed (non-fatal)");
  }
}

let healthHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

// Start the periodic heartbeat that flushes this instance's write-health into
// the shared table. Idempotent; the timer is unref'd so it never keeps the
// process alive on its own.
export function initAiUsageWriteHealthHeartbeat(): void {
  if (healthHeartbeatTimer) return;
  // Publish an initial row promptly so a fresh instance shows up in the fleet
  // aggregate without waiting a full interval.
  void flushAiUsageWriteHealth();
  healthHeartbeatTimer = setInterval(() => {
    void flushAiUsageWriteHealth();
  }, HEALTH_FLUSH_INTERVAL_MS);
  if (typeof healthHeartbeatTimer.unref === "function") {
    healthHeartbeatTimer.unref();
  }
}

// Aggregate write-health across every recently-seen instance. Reads the shared
// table, overlays THIS process's live in-memory counters (which may be ahead of
// its last flush), and folds them into a single fleet snapshot:
//   * successes/failures  — summed across instances
//   * consecutiveFailures — the worst (max) across instances
//   * healthy             — true only if NO active instance is failing
//   * last*/message       — most recent across instances
// Fail-safe: if the shared table can't be read, fall back to the local snapshot
// so the endpoint never errors.
export async function aiUsageWriteHealthFleet(): Promise<AiUsageWriteHealth> {
  try {
    const cutoff = new Date(Date.now() - INSTANCE_STALE_MS);
    const rows = await db
      .select({
        instanceId: aiUsageWriteHealthTable.instanceId,
        successes: aiUsageWriteHealthTable.successes,
        failures: aiUsageWriteHealthTable.failures,
        consecutiveFailures: aiUsageWriteHealthTable.consecutiveFailures,
        lastSuccessAt: aiUsageWriteHealthTable.lastSuccessAt,
        lastFailureAt: aiUsageWriteHealthTable.lastFailureAt,
        lastFailureMessage: aiUsageWriteHealthTable.lastFailureMessage,
      })
      .from(aiUsageWriteHealthTable)
      .where(gte(aiUsageWriteHealthTable.updatedAt, cutoff));

    const byInstance = new Map<string, InstanceHealth>();
    for (const r of rows) {
      byInstance.set(r.instanceId, {
        successes: r.successes,
        failures: r.failures,
        consecutiveFailures: r.consecutiveFailures,
        lastSuccessMs: r.lastSuccessAt ? r.lastSuccessAt.getTime() : null,
        lastFailureMs: r.lastFailureAt ? r.lastFailureAt.getTime() : null,
        lastFailureMessage: r.lastFailureMessage,
      });
    }
    // Overlay this process's live counters so the responding instance always
    // reports its freshest state (its persisted row may lag by up to one flush).
    byInstance.set(INSTANCE_ID, localInstanceHealth());

    let successes = 0;
    let failures = 0;
    let maxConsecutive = 0;
    let lastSuccessMs: number | null = null;
    let lastFailureMs: number | null = null;
    let lastFailureMessage: string | null = null;
    for (const h of byInstance.values()) {
      successes += h.successes;
      failures += h.failures;
      if (h.consecutiveFailures > maxConsecutive) {
        maxConsecutive = h.consecutiveFailures;
      }
      if (
        h.lastSuccessMs != null &&
        (lastSuccessMs == null || h.lastSuccessMs > lastSuccessMs)
      ) {
        lastSuccessMs = h.lastSuccessMs;
      }
      if (
        h.lastFailureMs != null &&
        (lastFailureMs == null || h.lastFailureMs > lastFailureMs)
      ) {
        lastFailureMs = h.lastFailureMs;
        lastFailureMessage = h.lastFailureMessage;
      }
    }

    return {
      healthy: maxConsecutive === 0,
      successes,
      failures,
      consecutiveFailures: maxConsecutive,
      lastSuccessAt: lastSuccessMs ? new Date(lastSuccessMs).toISOString() : null,
      lastFailureAt: lastFailureMs ? new Date(lastFailureMs).toISOString() : null,
      lastFailureMessage,
      instanceCount: byInstance.size,
    };
  } catch (err) {
    logger.debug(
      { err },
      "ai usage fleet write-health read failed; using local snapshot",
    );
    return aiUsageWriteHealthSnapshot();
  }
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

    const write = db.insert(aiUsageTable).values({
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
    });
    // Record the write outcome for the health signal without awaiting: a
    // resolved write bumps the success counter, a rejected one is swallowed and
    // counted as a failure (which may emit a rate-limited warn).
    void Promise.resolve(write).then(
      () => onWriteSuccess(),
      (err) => onWriteFailure(err, input.workload),
    );
  } catch (err) {
    // Defensive: never let telemetry disturb the caller. A synchronous throw
    // (e.g. driver blew up before the query was built) still counts as a failed
    // write for the health signal.
    onWriteFailure(err, input.workload);
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
