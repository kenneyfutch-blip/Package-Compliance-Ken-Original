import test from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import {
  recordAiUsage,
  trackDirectUsage,
  aiUsageWriteHealthSnapshot,
  aiUsageWriteHealthFleet,
  INSTANCE_ID,
  type AiUsageWriteHealth,
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

// ---------------------------------------------------------------------------
// Fleet-wide write-health aggregation (aiUsageWriteHealthFleet).
// ---------------------------------------------------------------------------
// The endpoint aggregates the shared health table across every recently-seen
// API instance and overlays THIS process's live in-memory counters. These tests
// stub db.select (same shared-singleton trick used above) to feed the aggregator
// a controlled set of instance rows, and drive the local counters via
// recordAiUsage so we can reason about the overlay. Because the local counters
// are module-global and accumulate across the tests above, each test reads the
// current local snapshot and asserts RELATIVE to it rather than absolute values.

// Shape of a row as projected by aiUsageWriteHealthFleet's select. `updatedAt`
// is carried only so the freshness stub can emulate the DB's WHERE clause; the
// aggregator itself never reads it (it trusts the DB to have filtered).
type HealthRow = {
  instanceId: string;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastFailureMessage: string | null;
  updatedAt?: Date;
};

// Select stub that returns exactly `rows` from `.from(...).where(...)`,
// emulating a DB whose freshness WHERE has already been applied.
function installFleetSelect(rows: HealthRow[]): void {
  (db as unknown as DbLike).select = () => ({
    from: () => ({
      where: () => Promise.resolve(rows),
    }),
  });
}

// Mirrors INSTANCE_STALE_MS in ai-usage.ts. Used only by the freshness stub to
// stand in for the DB-side `updatedAt >= cutoff` filter.
const STALE_WINDOW_MS = 90_000;

// Select stub that emulates the DB's freshness WHERE: only rows whose updatedAt
// is within the staleness window are returned to the aggregator.
function installFleetSelectWithFreshness(rows: HealthRow[]): void {
  (db as unknown as DbLike).select = () => ({
    from: () => ({
      where: () => {
        const cutoff = Date.now() - STALE_WINDOW_MS;
        return Promise.resolve(
          rows.filter((r) => (r.updatedAt?.getTime() ?? 0) >= cutoff),
        );
      },
    }),
  });
}

// Select stub whose call throws (e.g. DB unreachable), to exercise the
// fail-safe fallback to the local snapshot.
function installThrowingSelect(): void {
  (db as unknown as DbLike).select = () => {
    throw new Error("db select threw");
  };
}

// Force THIS process's local write-health into a known-healthy state (a single
// successful write clears consecutiveFailures) and return the resulting snapshot
// so callers can assert relative to the live local counters.
async function setLocalHealthy(): Promise<AiUsageWriteHealth> {
  installCapturingInsert();
  try {
    recordAiUsage({
      workload: "ocr",
      model: "gpt-5.4-mini",
      promptTokens: 1,
      completionTokens: 1,
      durationMs: 1,
      success: true,
    });
    await new Promise((r) => setTimeout(r, 0));
  } finally {
    restoreDb();
  }
  return aiUsageWriteHealthSnapshot();
}

test("aiUsageWriteHealthFleet: one failing instance makes the whole fleet unhealthy and sums counts", async () => {
  const local = await setLocalHealthy();
  const failAt = new Date();
  installFleetSelect([
    {
      instanceId: "instance-A",
      successes: 5,
      failures: 0,
      consecutiveFailures: 0,
      lastSuccessAt: new Date(failAt.getTime() - 1000),
      lastFailureAt: null,
      lastFailureMessage: null,
    },
    {
      instanceId: "instance-B",
      successes: 2,
      failures: 3,
      consecutiveFailures: 3,
      lastSuccessAt: null,
      lastFailureAt: failAt,
      lastFailureMessage: "boom",
    },
  ]);
  try {
    const fleet = await aiUsageWriteHealthFleet();
    // Any single failing instance turns the whole signal unhealthy, and the
    // reported consecutiveFailures is the WORST across the fleet.
    assert.equal(fleet.healthy, false);
    assert.equal(fleet.consecutiveFailures, 3);
    // successes/failures are summed across the two rows plus this process.
    assert.equal(fleet.successes, local.successes + 5 + 2);
    assert.equal(fleet.failures, local.failures + 0 + 3);
    // instance-A, instance-B, and this process.
    assert.equal(fleet.instanceCount, 3);
    // Most-recent failure wins; instance-B's failure is the newest.
    assert.equal(fleet.lastFailureMessage, "boom");
    assert.equal(fleet.lastFailureAt, failAt.toISOString());
  } finally {
    restoreDb();
  }
});

test("aiUsageWriteHealthFleet: instances past the freshness window are excluded", async () => {
  const local = await setLocalHealthy();
  const now = Date.now();
  installFleetSelectWithFreshness([
    {
      instanceId: "instance-fresh",
      successes: 4,
      failures: 1,
      consecutiveFailures: 0,
      lastSuccessAt: new Date(now),
      lastFailureAt: null,
      lastFailureMessage: null,
      updatedAt: new Date(now),
    },
    {
      // Old heartbeat: this instance is gone and must not contribute.
      instanceId: "instance-stale",
      successes: 1000,
      failures: 500,
      consecutiveFailures: 9,
      lastSuccessAt: null,
      lastFailureAt: new Date(now),
      lastFailureMessage: "stale-boom",
      updatedAt: new Date(now - 200_000),
    },
  ]);
  try {
    const fleet = await aiUsageWriteHealthFleet();
    // Only the fresh instance and this process contribute.
    assert.equal(fleet.successes, local.successes + 4);
    assert.equal(fleet.failures, local.failures + 1);
    assert.equal(fleet.instanceCount, 2);
    // The stale instance's unhealthy state (consecutiveFailures: 9) is dropped.
    assert.equal(fleet.healthy, true);
    assert.equal(fleet.consecutiveFailures, 0);
    assert.notEqual(fleet.lastFailureMessage, "stale-boom");
  } finally {
    restoreDb();
  }
});

test("aiUsageWriteHealthFleet: the responding process's live counters override its persisted row", async () => {
  const local = await setLocalHealthy();
  // A stale/lagging persisted row for THIS instance with wildly different
  // counts. The live in-memory counters must win, and the row must NOT be
  // double-counted as a separate instance.
  installFleetSelect([
    {
      instanceId: INSTANCE_ID,
      successes: 999_999,
      failures: 888_888,
      consecutiveFailures: 42,
      lastSuccessAt: new Date(0),
      lastFailureAt: new Date(0),
      lastFailureMessage: "persisted-stale",
    },
  ]);
  try {
    const fleet = await aiUsageWriteHealthFleet();
    // Live local counters win — persisted row is overwritten, not summed.
    assert.equal(fleet.successes, local.successes);
    assert.equal(fleet.failures, local.failures);
    assert.equal(fleet.consecutiveFailures, local.consecutiveFailures);
    // The persisted row and the live overlay collapse to a single instance.
    assert.equal(fleet.instanceCount, 1);
    // The stale row's consecutiveFailures: 42 is discarded, so we stay healthy.
    assert.equal(fleet.healthy, true);
  } finally {
    restoreDb();
  }
});

test("aiUsageWriteHealthFleet: a DB read failure falls back to the local snapshot", async () => {
  const local = await setLocalHealthy();
  installThrowingSelect();
  try {
    // The endpoint must never error just because the shared table is unreadable.
    const fleet = await aiUsageWriteHealthFleet();
    assert.deepEqual(fleet, local);
  } finally {
    restoreDb();
  }
});
