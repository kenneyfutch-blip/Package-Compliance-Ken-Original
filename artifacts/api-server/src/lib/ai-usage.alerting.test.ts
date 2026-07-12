import test from "node:test";
import assert from "node:assert/strict";
import { db, aiUsageTable, notificationsTable } from "@workspace/db";
import { recordAiUsage } from "./ai-usage";

// ---------------------------------------------------------------------------
// Proactive admin alerting on sustained telemetry-write failure.
// ---------------------------------------------------------------------------
// When AI usage writes fail repeatedly, admins must be notified in-app WITHOUT
// the AI path ever blocking on (or being broken by) that alerting. These tests
// force the usage write to keep failing, then assert:
//   * a critical notification is inserted for every admin once the failure
//     streak crosses the threshold (fired once per incident, not per write),
//   * a subsequent successful write auto-dismisses (marks read) that alert.
// `db` is a shared singleton in the bundled test, so monkeypatching db.insert /
// db.select / db.update here also swaps what the alerting code sees. Each test
// file runs in its own process, so the module-level incident state starts fresh.

type DbLike = {
  insert: unknown;
  select: unknown;
  update: unknown;
};

const real = {
  insert: (db as unknown as DbLike).insert,
  select: (db as unknown as DbLike).select,
  update: (db as unknown as DbLike).update,
};

function restoreDb(): void {
  (db as unknown as DbLike).insert = real.insert;
  (db as unknown as DbLike).select = real.select;
  (db as unknown as DbLike).update = real.update;
}

// Two active admins in the same org, returned by the alerting admin lookup.
const ADMINS = [
  { id: 101, organizationId: 1 },
  { id: 102, organizationId: 1 },
];

function installStubs(usageWriteFails: boolean) {
  const captured: {
    notifications: Record<string, unknown>[];
    updates: number;
  } = { notifications: [], updates: 0 };

  (db as unknown as DbLike).insert = (table: unknown) => {
    if (table === aiUsageTable) {
      // The actual usage write — succeeds or fails depending on the scenario.
      return {
        values: () =>
          usageWriteFails
            ? Promise.reject(new Error("db unavailable"))
            : Promise.resolve([{ id: 1 }]),
      };
    }
    if (table === notificationsTable) {
      // The alert emit — record what admins would be notified with.
      return {
        values: (rows: Record<string, unknown>[]) => ({
          returning: async () => {
            captured.notifications.push(...rows);
            return rows.map((_, i) => ({ id: i + 1 }));
          },
        }),
      };
    }
    throw new Error("unexpected insert target");
  };

  // Admin lookup: db.select({...}).from(usersTable).where(...)
  (db as unknown as DbLike).select = () => ({
    from: () => ({ where: async () => ADMINS }),
  });

  // Auto-dismiss: db.update(notificationsTable).set({read:true}).where(...)
  (db as unknown as DbLike).update = () => ({
    set: () => ({
      where: async () => {
        captured.updates += 1;
      },
    }),
  });

  return captured;
}

const flush = () => new Promise((r) => setTimeout(r, 10));

function failingWrite(): void {
  recordAiUsage({
    workload: "packaging_analysis",
    model: "gpt-5.4",
    promptTokens: 1,
    completionTokens: 1,
    durationMs: 5,
    success: true,
  });
}

test("alerts admins after sustained failures, once per incident, then auto-dismisses on recovery", async () => {
  const captured = installStubs(true);
  try {
    // Below the threshold: no alert yet.
    for (let i = 0; i < 4; i++) failingWrite();
    await flush();
    assert.equal(
      captured.notifications.length,
      0,
      "should not alert before the failure streak crosses the threshold",
    );

    // Crossing the threshold fires exactly one alert per admin.
    failingWrite();
    await flush();
    assert.equal(
      captured.notifications.length,
      ADMINS.length,
      "one critical notification per admin once the threshold is crossed",
    );
    for (const n of captured.notifications) {
      assert.equal(n["type"], "critical");
      assert.equal(n["title"], "AI cost logging is failing");
      assert.ok(typeof n["userId"] === "number");
      assert.ok(typeof n["organizationId"] === "number");
    }

    // Further failures during the same incident must NOT re-alert.
    for (let i = 0; i < 5; i++) failingWrite();
    await flush();
    assert.equal(
      captured.notifications.length,
      ADMINS.length,
      "rate-limited: no duplicate alerts while the incident is still open",
    );
  } finally {
    restoreDb();
  }

  // A successful write clears the incident and auto-dismisses the alert.
  const recovered = installStubs(false);
  try {
    recordAiUsage({
      workload: "packaging_analysis",
      model: "gpt-5.4",
      promptTokens: 1,
      completionTokens: 1,
      durationMs: 5,
      success: true,
    });
    await flush();
    assert.equal(
      recovered.updates,
      1,
      "recovery should mark the incident notifications read exactly once",
    );
  } finally {
    restoreDb();
  }
});

test("auto-dismisses when recovery happens while the alert emit is still in flight", async () => {
  // Regression guard for the resolve/emit race: a successful write that lands
  // WHILE the alert notification is still being written must still auto-dismiss
  // the incident, not leave it open with unread notifications forever.
  let usageFails = true;
  let releaseSelect!: () => void;
  const selectGate = new Promise<void>((r) => {
    releaseSelect = r;
  });
  const captured = { notifications: [] as Record<string, unknown>[], updates: 0 };

  (db as unknown as DbLike).insert = (table: unknown) => {
    if (table === aiUsageTable) {
      return {
        values: () =>
          usageFails
            ? Promise.reject(new Error("db unavailable"))
            : Promise.resolve([{ id: 1 }]),
      };
    }
    return {
      values: (rows: Record<string, unknown>[]) => ({
        returning: async () => {
          captured.notifications.push(...rows);
          return rows.map((_, i) => ({ id: i + 1 }));
        },
      }),
    };
  };
  // Admin lookup blocks until we release it, keeping the emit "in flight".
  (db as unknown as DbLike).select = () => ({
    from: () => ({
      where: async () => {
        await selectGate;
        return ADMINS;
      },
    }),
  });
  (db as unknown as DbLike).update = () => ({
    set: () => ({
      where: async () => {
        captured.updates += 1;
      },
    }),
  });

  try {
    // Cross the threshold — the emit starts but parks on the admin lookup.
    for (let i = 0; i < 5; i++) failingWrite();
    await flush();
    assert.equal(
      captured.notifications.length,
      0,
      "emit is still in flight, nothing written yet",
    );

    // Recovery lands WHILE the emit is still in flight.
    usageFails = false;
    recordAiUsage({
      workload: "packaging_analysis",
      model: "gpt-5.4",
      promptTokens: 1,
      completionTokens: 1,
      durationMs: 5,
      success: true,
    });
    await flush();
    assert.equal(
      captured.updates,
      0,
      "resolve is deferred while the emit is still in flight",
    );

    // Let the emit finish; the reconciliation must auto-dismiss the incident.
    releaseSelect();
    await flush();
    assert.equal(
      captured.notifications.length,
      ADMINS.length,
      "the alert is emitted once the lookup resolves",
    );
    assert.equal(
      captured.updates,
      1,
      "recovery during an in-flight emit still auto-dismisses the alert",
    );
  } finally {
    restoreDb();
  }
});

test("alerting never throws into the AI path even if the alert emit fails", async () => {
  // Usage write fails AND the notification insert also blows up: the caller must
  // still never see an error.
  (db as unknown as DbLike).insert = (table: unknown) => {
    if (table === aiUsageTable) {
      return { values: () => Promise.reject(new Error("db unavailable")) };
    }
    return {
      values: () => ({
        returning: async () => {
          throw new Error("notification insert also down");
        },
      }),
    };
  };
  (db as unknown as DbLike).select = () => ({
    from: () => ({ where: async () => ADMINS }),
  });
  try {
    for (let i = 0; i < 6; i++) {
      assert.doesNotThrow(() => failingWrite());
    }
    await flush();
  } finally {
    restoreDb();
  }
});
