import OpenAI from "openai";
import { openai as managedClient } from "@workspace/integrations-openai-ai-server";
import { db, aiProvidersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptSecret } from "./crypto";

export const MANAGED_MODEL = "gpt-5.4";

// AI model tiers. Codenames map capability/cost tiers to concrete models:
//   fast (Luna)      — low-cost, high-volume utility work  → gpt-5.4-mini
//   standard (Terra) — default production analysis model    → gpt-5.4
//   reasoning (Sol)  — advanced reasoning for hard/risky work → o4-mini
export type AiTier = "fast" | "standard" | "reasoning";

export const TIER_CODENAMES: Record<AiTier, string> = {
  fast: "Luna",
  standard: "Terra",
  reasoning: "Sol",
};

// Default model backing each tier for the Replit-managed provider (and any
// provider that has not overridden a tier). Chosen from the models available
// through the workspace OpenAI integration.
export const DEFAULT_TIER_MODELS: Record<AiTier, string> = {
  fast: "gpt-5.4-mini",
  standard: MANAGED_MODEL,
  reasoning: "o4-mini",
};

export type ResolvedClient = {
  client: OpenAI;
  model: string;
  label: string;
};

export type ResolvedTierClient = ResolvedClient & {
  tier: AiTier;
  codename: string;
};

type ProviderConfig = {
  name?: string | null;
  managed: boolean;
  model: string | null;
  fastModel?: string | null;
  reasoningModel?: string | null;
  apiKey?: string | null;
  baseUrl?: string | null;
};

/**
 * Build an OpenAI-compatible client for a provider config. Falls back to the
 * Replit-managed OpenAI integration for the managed provider (managed === true)
 * or any provider missing a usable API key.
 */
export function buildClient(provider: ProviderConfig): ResolvedClient {
  const apiKey = provider.managed ? null : decryptSecret(provider.apiKey);
  if (provider.managed || !apiKey) {
    return {
      client: managedClient,
      model: provider.managed ? provider.model || MANAGED_MODEL : MANAGED_MODEL,
      label: provider.name || "Replit-managed OpenAI",
    };
  }
  return {
    client: new OpenAI({ apiKey, baseURL: provider.baseUrl || undefined }),
    model: provider.model || MANAGED_MODEL,
    label: provider.name || "Custom provider",
  };
}

/**
 * Resolve the concrete model that backs a tier for a given provider config.
 *
 * `usingManaged` must reflect the client that was actually resolved (see
 * `buildClient`): true for the managed provider AND for any custom provider
 * whose key is missing/undecryptable (which falls back to the managed client).
 *
 * When the resolved client is the managed OpenAI:
 *  - standard  → the managed provider's own model, else the managed default;
 *  - fast/reasoning → the managed provider's override, else the managed default.
 * A keyless custom provider's own model/overrides target its (unreachable)
 * endpoint, so they are ignored in the managed-fallback path — otherwise a
 * custom model name would be sent to the managed endpoint and fail.
 *
 * When the resolved client is a real custom endpoint (working key):
 *  - standard  → the provider's model;
 *  - fast/reasoning → the provider's override, else its single model (so an
 *    endpoint that hosts only one model still works).
 */
export function tierModelFor(
  provider: ProviderConfig,
  tier: AiTier,
  usingManaged: boolean,
): string {
  const standard = usingManaged
    ? provider.managed
      ? provider.model || MANAGED_MODEL
      : MANAGED_MODEL
    : provider.model || MANAGED_MODEL;
  if (tier === "standard") return standard;

  const override = tier === "fast" ? provider.fastModel : provider.reasoningModel;
  const fallback =
    tier === "fast" ? DEFAULT_TIER_MODELS.fast : DEFAULT_TIER_MODELS.reasoning;
  if (usingManaged) {
    return provider.managed ? override || fallback : fallback;
  }
  return override || standard;
}

const MANAGED_DEFAULT: ProviderConfig = {
  name: "Replit-managed OpenAI",
  managed: true,
  model: MANAGED_MODEL,
  fastModel: null,
  reasoningModel: null,
  apiKey: null,
  baseUrl: null,
};

async function loadActiveProviderConfig(): Promise<ProviderConfig> {
  const [active] = await db
    .select()
    .from(aiProvidersTable)
    .where(eq(aiProvidersTable.active, true))
    .orderBy(aiProvidersTable.id)
    .limit(1);
  return active ?? MANAGED_DEFAULT;
}

/**
 * Resolve the active engine's client plus the model that backs the requested
 * tier. Falls back to the Replit-managed OpenAI integration when no active
 * provider is configured.
 */
export async function resolveAiClientForTier(
  tier: AiTier,
): Promise<ResolvedTierClient> {
  const provider = await loadActiveProviderConfig();
  const base = buildClient(provider);
  const usingManaged = base.client === managedClient;
  const model = tierModelFor(provider, tier, usingManaged);
  return {
    client: base.client,
    model,
    label: base.label,
    tier,
    codename: TIER_CODENAMES[tier],
  };
}

/**
 * Resolve the currently active analysis engine at the standard tier.
 */
export async function resolveAiClient(): Promise<ResolvedClient> {
  const { client, model, label } = await resolveAiClientForTier("standard");
  return { client, model, label };
}

/**
 * Resolve a client pinned to the Replit-managed fast model (gpt-5.4-mini),
 * bypassing whichever provider is active. Used for latency-critical workloads
 * (e.g. packaging analysis under a hard time budget): the active engine may be
 * a heavy/slow model with no fast tier configured, which can't finish in time.
 */
export function resolveManagedFastClient(): ResolvedTierClient {
  return {
    client: managedClient,
    model: DEFAULT_TIER_MODELS.fast,
    label: "Replit-managed OpenAI (fast)",
    tier: "fast",
    codename: TIER_CODENAMES.fast,
  };
}
