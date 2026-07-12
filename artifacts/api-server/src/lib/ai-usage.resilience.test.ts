import test from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import {
  recordAiUsage,
  trackDirectUsage,
  aiUsageWriteHealthSnapshot,
} from "./ai-usage";
import { runTiered } from "./ai-orchestration";

// ---------------------------------------------------------------------------
// Fire-and-forget usage-logging invariant.
// ---------------------------------------------------------------------------
// AI usage telemetry must NEVER break or slow the actual AI response:
//   * recordAiUsage swallows all failures and never throws.
//   * trackDirectUsage / runTiered log usage but return the model result on
//     success, and on model failure rethrow the ORIGINAL model error (not a
//     logging error) while still attempting to record a failure row.
// These tests force the usage-write path to fail and assert the AI call is
// unaffected. `db` is a shared singleton in the bundled test, so monkeypatching
// db.insert here also swaps what the AI-usage code sees.

type DbLike = {
  insert: unknown;
  select: unknown;
};

const realInsert = (db as unknown as DbLike).insert;
const realSelect = (db as unknown as DbLike).select;

function restoreDb(): void {
  (db as unknown as DbLike).insert = realInsert;
  (db as unknown as DbLike).select = realSelect;
}

// Insert stub whose synchronous call throws (e.g. driver blew up before the
// query object was even built).
function installSyncThrowingInsert(): void {
  (db as unknown as DbLike).insert = () => {
    throw new Error("db insert threw synchronously");
  };
}

// Insert stub that builds a query whose execution rejects (e.g. DB
// unavailable / table missing). recordAiUsage attaches a .catch to swallow it.
function installRejectingInsert(): { rejections: number } {
  const state = { rejections: 0 };
  (db as unknown as DbLike).insert = () => ({
    values: () => {
      state.rejections += 1;
      return Promise.reject(new Error("db unavailable"));
    },
  });
  return state;
}

// Insert stub that records the values written (success flag etc.) without
// touching a database. Lets us assert a failure row was attempted.
function installCapturingInsert(): { rows: Record<string, unknown>[] } {
  const rows: Record<string, unknown>[] = [];
  (db as unknown as DbLike).insert = () => ({
    values: (v: Record<string, unknown>) => {
      rows.push(v);
      return { catch: () => Promise.resolve() };
    },
  });
  return { rows };
}

// Select stub so runTiered's provider lookup resolves without a real DB. Empty
// result → resolveAiClientForTier falls back to the managed provider config.
function installEmptySelect(): void {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => Promise.resolve([]);
  (db as unknown as DbLike).select = () => chain;
}

// --- recordAiUsage ---------------------------------------------------------

test("recordAiUsage never throws when the insert throws synchronously", () => {
  installSyncThrowingInsert();
  try {
    assert.doesNotThrow(() =>
      recordAiUsage({
        workload: "packaging_analysis",
        model: "gpt-5.4",
        promptTokens: 10,
        completionTokens: 5,
        durationMs: 100,
        success: true,
      }),
    );
  } finally {
    restoreDb();
  }
});

test("recordAiUsage swallows a rejected insert (no unhandled rejection)", async () => {
  const state = installRejectingInsert();
  try {
    assert.doesNotThrow(() =>
      recordAiUsage({
        workload: "ocr",
        model: "gpt-5.4-mini",
        promptTokens: 1,
        completionTokens: 1,
        durationMs: 5,
        success: true,
      }),
    );
    // Let the rejected insert promise settle; the internal .catch must absorb it.
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(state.rejections, 1);
  } finally {
    restoreDb();
  }
});

test("aiUsageWriteHealthSnapshot reflects a failed write then recovers on success", async () => {
  const before = aiUsageWriteHealthSnapshot();
  installRejectingInsert();
  try {
    recordAiUsage({
      workload: "ocr",
      model: "gpt-5.4-mini",
      promptTokens: 1,
      completionTokens: 1,
      durationMs: 5,
      success: true,
    });
    await new Promise((r) => setTimeout(r, 0));
    const afterFail = aiUsageWriteHealthSnapshot();
    assert.equal(afterFail.failures, before.failures + 1);
    assert.equal(afterFail.healthy, false);
    assert.ok(afterFail.consecutiveFailures >= 1);
    assert.equal(afterFail.lastFailureMessage, "db unavailable");
  } finally {
    restoreDb();
  }

  // A subsequent successful write clears the unhealthy state.
  installCapturingInsert();
  try {
    recordAiUsage({
      workload: "ocr",
      model: "gpt-5.4-mini",
      promptTokens: 1,
      completionTokens: 1,
      durationMs: 5,
      success: true,
    });
    await new Promise((r) => setTimeout(r, 0));
    const afterOk = aiUsageWriteHealthSnapshot();
    assert.equal(afterOk.healthy, true);
    assert.equal(afterOk.consecutiveFailures, 0);
  } finally {
    restoreDb();
  }
});

// --- trackDirectUsage ------------------------------------------------------

test("trackDirectUsage returns the model result even when usage logging fails", async () => {
  installSyncThrowingInsert();
  try {
    const modelResponse = { usage: { prompt_tokens: 12, completion_tokens: 8 }, text: "ok" };
    const result = await trackDirectUsage(
      { workload: "field_extraction", model: "gpt-5.4-mini" },
      async () => modelResponse,
    );
    // The exact model response is returned untouched despite the logging failure.
    assert.equal(result, modelResponse);
    assert.equal(result.text, "ok");
  } finally {
    restoreDb();
  }
});

test("trackDirectUsage rethrows the original model error and records a failure row", async () => {
  const { rows } = installCapturingInsert();
  try {
    const modelError = new Error("model call exploded");
    await assert.rejects(
      trackDirectUsage({ workload: "ocr", model: "gpt-5.4-mini" }, async () => {
        throw modelError;
      }),
      // The rejection must be the ORIGINAL model error, not a logging error.
      (err) => err === modelError,
    );
    // A failure usage row was still attempted.
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.success, false);
    assert.equal(rows[0]!.errorMessage, "model call exploded");
    assert.equal(rows[0]!.workload, "ocr");
  } finally {
    restoreDb();
  }
});

test("trackDirectUsage rethrows even when logging the failure ALSO throws", async () => {
  installSyncThrowingInsert();
  try {
    const modelError = new Error("model down");
    await assert.rejects(
      trackDirectUsage(
        { workload: "version_compare", model: "gpt-5.4" },
        async () => {
          throw modelError;
        },
      ),
      (err) => err === modelError,
    );
  } finally {
    restoreDb();
  }
});

// --- runTiered (analysis / copilot path) -----------------------------------

test("runTiered returns the analysis result even when usage logging fails", async () => {
  installEmptySelect();
  installSyncThrowingInsert();
  try {
    const analysis = { verdict: "compliant", confidence: 99 };
    const { result, orchestration } = await runTiered<typeof analysis>({
      workload: "packaging_analysis",
      run: async () => ({
        result: analysis,
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
      }),
      assess: (r) => ({ confidence: r.confidence, risky: false }),
    });
    assert.equal(result, analysis);
    assert.equal(orchestration.workload, "packaging_analysis");
  } finally {
    restoreDb();
  }
});

test("runTiered rethrows the original model error and records a failure row", async () => {
  installEmptySelect();
  const { rows } = installCapturingInsert();
  try {
    const modelError = new Error("orchestrated model failure");
    await assert.rejects(
      runTiered({
        workload: "copilot",
        run: async () => {
          throw modelError;
        },
        assess: () => ({ confidence: 100, risky: false }),
      }),
      (err) => err === modelError,
    );
    const failureRow = rows.find((r) => r.success === false);
    assert.ok(failureRow, "a failure usage row should be recorded");
    assert.equal(failureRow!.errorMessage, "orchestrated model failure");
    assert.equal(failureRow!.workload, "copilot");
  } finally {
    restoreDb();
  }
});
