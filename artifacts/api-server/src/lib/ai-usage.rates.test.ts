import test from "node:test";
import assert from "node:assert/strict";
import { rateForModel, estimateCostUsd } from "./ai-usage";

// ---------------------------------------------------------------------------
// Rate-card resolution invariants.
// ---------------------------------------------------------------------------
// The cost dashboard is only as accurate as rateForModel(). Two things must
// hold, and both have bitten us before:
//   1. Versioned model names ("gpt-5.4-mini-2026-03-17") must resolve to the
//      LONGEST matching prefix, not the first one that happens to match. A
//      "gpt-5.4-mini-*" name must NOT be priced at the pricier "gpt-5.4" rate.
//   2. Unknown / custom models must fall back to DEFAULT_RATE, never throw.

test("exact + versioned models resolve to their own rate", () => {
  assert.deepEqual(rateForModel("gpt-5.5"), { input: 5, output: 25 });
  assert.deepEqual(rateForModel("gpt-5.5-2026-04-23"), { input: 5, output: 25 });
  assert.deepEqual(rateForModel("gpt-5.4-2026-03-05"), { input: 2.5, output: 10 });
  assert.deepEqual(rateForModel("gpt-4o-2024-08-06"), { input: 2.5, output: 10 });
  assert.deepEqual(rateForModel("o4-mini-2025-04-16"), { input: 1.1, output: 4.4 });
});

test("longest-prefix wins: gpt-5.4-mini is NOT priced as gpt-5.4", () => {
  // Regression guard for the prefix-order bug (mini would be charged ~16x too
  // much if it matched the shorter "gpt-5.4" prefix first).
  assert.deepEqual(rateForModel("gpt-5.4-mini"), { input: 0.15, output: 0.6 });
  assert.deepEqual(rateForModel("gpt-5.4-mini-2026-03-17"), {
    input: 0.15,
    output: 0.6,
  });
});

test("unknown/custom/empty models fall back to DEFAULT_RATE", () => {
  const def = { input: 1.0, output: 3.0 };
  assert.deepEqual(rateForModel("some-custom-model"), def);
  assert.deepEqual(rateForModel(""), def);
  // Case-insensitive + trimmed.
  assert.deepEqual(rateForModel("  GPT-5.5  "), { input: 5, output: 25 });
});

test("estimateCostUsd applies input+output rates per 1M tokens", () => {
  // gpt-5.5: 1M input @ $5 + 1M output @ $25 = $30.
  assert.equal(estimateCostUsd("gpt-5.5", 1_000_000, 1_000_000), 30);
  // Negative token counts are clamped to 0.
  assert.equal(estimateCostUsd("gpt-5.5", -100, -100), 0);
});
