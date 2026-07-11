import test from "node:test";
import assert from "node:assert/strict";
import {
  tierModelFor,
  DEFAULT_TIER_MODELS,
  MANAGED_MODEL,
  type AiTier,
} from "./ai-client";

// Regression guard for tiered model resolution. `tierModelFor` must never emit
// a custom provider's model name when the resolved client has fallen back to
// the managed OpenAI endpoint (keyless/undecryptable custom provider) — doing
// so would send an unknown model to the managed endpoint and fail. The
// `usingManaged` flag mirrors buildClient()'s client selection.

type Row = Parameters<typeof tierModelFor>[0];

function provider(overrides: Partial<Row> = {}): Row {
  return {
    name: "Test",
    managed: false,
    model: null,
    fastModel: null,
    reasoningModel: null,
    apiKey: null,
    baseUrl: null,
    ...overrides,
  };
}

const TIERS: AiTier[] = ["fast", "standard", "reasoning"];

test("managed provider uses managed model + tier defaults", () => {
  const p = provider({ managed: true, model: MANAGED_MODEL });
  assert.equal(tierModelFor(p, "standard", true), MANAGED_MODEL);
  assert.equal(tierModelFor(p, "fast", true), DEFAULT_TIER_MODELS.fast);
  assert.equal(tierModelFor(p, "reasoning", true), DEFAULT_TIER_MODELS.reasoning);
});

test("custom provider with a working key uses its own model for every tier", () => {
  const p = provider({ model: "custom-model" });
  // usingManaged=false → real custom endpoint.
  assert.equal(tierModelFor(p, "standard", false), "custom-model");
  assert.equal(tierModelFor(p, "fast", false), "custom-model");
  assert.equal(tierModelFor(p, "reasoning", false), "custom-model");
});

test("custom provider overrides are honored on a working endpoint", () => {
  const p = provider({
    model: "custom-model",
    fastModel: "custom-fast",
    reasoningModel: "custom-reason",
  });
  assert.equal(tierModelFor(p, "standard", false), "custom-model");
  assert.equal(tierModelFor(p, "fast", false), "custom-fast");
  assert.equal(tierModelFor(p, "reasoning", false), "custom-reason");
});

test("keyless custom provider never leaks its model to the managed endpoint", () => {
  // No usable key → buildClient falls back to managed client (usingManaged=true)
  // even though the row is a non-managed provider with its own model/overrides.
  const p = provider({
    model: "custom-model",
    fastModel: "custom-fast",
    reasoningModel: "custom-reason",
  });
  for (const tier of TIERS) {
    const resolved = tierModelFor(p, tier, true);
    assert.notEqual(resolved, "custom-model");
    assert.notEqual(resolved, "custom-fast");
    assert.notEqual(resolved, "custom-reason");
  }
  assert.equal(tierModelFor(p, "standard", true), MANAGED_MODEL);
  assert.equal(tierModelFor(p, "fast", true), DEFAULT_TIER_MODELS.fast);
  assert.equal(tierModelFor(p, "reasoning", true), DEFAULT_TIER_MODELS.reasoning);
});

test("managed provider honors its own tier overrides", () => {
  const p = provider({
    managed: true,
    model: MANAGED_MODEL,
    fastModel: "managed-fast-override",
    reasoningModel: "managed-reason-override",
  });
  assert.equal(tierModelFor(p, "fast", true), "managed-fast-override");
  assert.equal(tierModelFor(p, "reasoning", true), "managed-reason-override");
});
