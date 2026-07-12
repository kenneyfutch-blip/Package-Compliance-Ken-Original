import crypto from "node:crypto";
import { createTtlCache } from "./ttl-cache";
import { resolveAiClientForTier } from "../ai-client";
import type { AiWorkload } from "../ai-orchestration";
import { logger } from "../logger";

// Tenant-scoped, TTL'd cache for repeatable AI calls (packaging analysis,
// language review, copilot). Keyed on the full prompt content + workload +
// prompt version + the active model, so:
//  - identical requests within the TTL reuse the result (no repeat model spend);
//  - concurrent identical requests collapse into one model call (single-flight);
//  - a prompt edit (bump the version constant) or a provider/model swap misses
//    the old entries automatically.
//
// Image OCR / field extraction already have their own content-hash cache
// (see document-ai) and are intentionally not routed through here.

// AI results are moderately large JSON; keep a bounded number and a generous
// TTL since the same package rarely changes between back-to-back reviews.
const AI_CACHE_TTL_MS = Number(process.env.AI_CACHE_TTL_MS) || 60 * 60 * 1000;
const AI_CACHE_MAX_ENTRIES = Number(process.env.AI_CACHE_MAX_ENTRIES) || 500;

const cache = createTtlCache<unknown>({
  ttlMs: AI_CACHE_TTL_MS,
  maxEntries: AI_CACHE_MAX_ENTRIES,
});

export function clearAiCache(): void {
  cache.clear();
}

/**
 * Run (or reuse) a cached AI computation. The cache key folds in the tenant
 * (`orgId`) so one org can never read another's cached result, the workload and
 * its prompt version so prompt changes invalidate cleanly, the active
 * model/provider so a model swap doesn't serve stale output, and a hash of the
 * exact prompt content.
 */
export async function cachedAiCall<T>(opts: {
  orgId: number | string | null | undefined;
  workload: AiWorkload;
  promptVersion: number;
  // The exact prompt content that determines the output (system + user, etc.).
  keyParts: string[];
  compute: () => Promise<T>;
}): Promise<T> {
  // Resolve the active model/provider identity so the key changes when an admin
  // swaps engines. This is a small, indexed provider read (config is tiny).
  const { model, label } = await resolveAiClientForTier("standard");

  const hash = crypto
    .createHash("sha256")
    .update(opts.keyParts.join("\u0000"))
    .digest("hex");
  const key = `${opts.workload}|org=${opts.orgId ?? "none"}|v=${opts.promptVersion}|m=${label}:${model}|${hash}`;

  let hit = true;
  const compute = () => {
    hit = false;
    return opts.compute();
  };
  const value = (await cache.get(key, compute)) as T;
  if (hit) {
    logger.debug({ workload: opts.workload, orgId: opts.orgId }, "AI cache hit");
  }
  return value;
}
