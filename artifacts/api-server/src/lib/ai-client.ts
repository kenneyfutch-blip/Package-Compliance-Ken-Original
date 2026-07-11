import OpenAI from "openai";
import { openai as managedClient } from "@workspace/integrations-openai-ai-server";
import { db, aiProvidersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptSecret } from "./crypto";

export const MANAGED_MODEL = "gpt-5.4";

export type ResolvedClient = {
  client: OpenAI;
  model: string;
  label: string;
};

/**
 * Build an OpenAI-compatible client for a provider config. The built-in
 * Replit-managed provider (managed === true) or any provider missing an API
 * key falls back to the environment-provisioned client.
 */
export function buildClient(provider: {
  name?: string | null;
  managed: boolean;
  model: string | null;
  apiKey?: string | null;
  baseUrl?: string | null;
}): ResolvedClient {
  const apiKey = provider.managed ? null : decryptSecret(provider.apiKey);
  if (provider.managed || !apiKey) {
    return {
      client: managedClient,
      model: provider.managed ? provider.model || MANAGED_MODEL : MANAGED_MODEL,
      label: provider.name || "Replit-managed OpenAI",
    };
  }
  return {
    client: new OpenAI({
      apiKey,
      baseURL: provider.baseUrl || undefined,
    }),
    model: provider.model || MANAGED_MODEL,
    label: provider.name || "Custom provider",
  };
}

/**
 * Resolve the currently active analysis engine. Falls back to the
 * Replit-managed OpenAI integration when no active provider is configured.
 */
export async function resolveAiClient(): Promise<ResolvedClient> {
  const [active] = await db
    .select()
    .from(aiProvidersTable)
    .where(eq(aiProvidersTable.active, true))
    .orderBy(aiProvidersTable.id)
    .limit(1);

  if (!active) {
    return {
      client: managedClient,
      model: MANAGED_MODEL,
      label: "Replit-managed OpenAI",
    };
  }
  return buildClient(active);
}
