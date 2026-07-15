import type { AgentProvider } from "./types";
import { openAiAgentProvider } from "./openai-provider";

// The provider registry. Providers register themselves here; the Workspace agent
// selects one via getActiveAgentProvider(). Adding Claude is: implement an
// AgentProvider, register it below, and set WORKSPACE_AGENT_PROVIDER=anthropic —
// no change to the orchestration loop.
const registry = new Map<string, AgentProvider>();

export function registerAgentProvider(provider: AgentProvider): void {
  registry.set(provider.key, provider);
}

export function getAgentProvider(key: string): AgentProvider | undefined {
  return registry.get(key);
}

export function listAgentProviders(): AgentProvider[] {
  return [...registry.values()];
}

// Built-in providers.
registerAgentProvider(openAiAgentProvider);

// The provider that answers Workspace turns. Selected by WORKSPACE_AGENT_PROVIDER
// when set to a REGISTERED key; otherwise falls back to the built-in OpenAI
// provider. Never throws for an unknown/unset value — an unrecognized override
// degrades to the default rather than breaking chat.
export function getActiveAgentProvider(): AgentProvider {
  const key = process.env.WORKSPACE_AGENT_PROVIDER?.trim();
  if (key) {
    const found = registry.get(key);
    if (found) return found;
  }
  return openAiAgentProvider;
}
