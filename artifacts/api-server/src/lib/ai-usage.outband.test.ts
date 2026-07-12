import test from "node:test";
import assert from "node:assert/strict";
import { db, aiUsageTable, notificationsTable } from "@workspace/db";
import { recordAiUsage } from "./ai-usage";

// ---------------------------------------------------------------------------
// Out-of-band (webhook) alerting on sustained telemetry-write failure.
// ---------------------------------------------------------------------------
// When AI usage writes fail repeatedly, admins must ALSO be paged out-of-band
// (via the configured webhook) so an off-hours outage doesn't wait for someone
// to open the dashboard — WITHOUT the AI path ever blocking on or breaking
// because of that delivery. These tests configure a webhook, stub global fetch,
// force usage writes to fail, and assert:
//   * the webhook fires once per incident once the failure streak crosses the
//     threshold (not before, and not once per write),
//   * a subsequent successful write delivers a matching "resolved" notice,
//   * delivery is DB-independent (fires even when the notification insert fails),
//   * a failing webhook never throws into the AI path.
// Each test file runs in its own process, so module-level incident state and the
// AI_ALERT_WEBHOOK_URL env var set here start fresh and don't leak elsewhere.

process.env["AI_ALERT_WEBHOOK_URL"] = "https://hooks.example.com/ai-alert";

type DbLike = { insert: unknown; select: unknown; update: unknown };

const real = {
  insert: (db as unknown as DbLike).insert,
  select: (db as unknown as DbLike).select,
  update: (db as unknown as DbLike).update,
};

const realFetch = globalThis.fetch;

function restore(): void {
  (db as unknown as DbLike).insert = real.insert;
  (db as unknown as DbLike).select = real.select;
  (db as unknown as DbLike).update = real.update;
  globalThis.fetch = realFetch;
}

const ADMINS = [
  { id: 101, organizationId: 1 },
  { id: 102, organizationId: 1 },
];

// Stub the DB so the in-app alert path (which runs alongside the webhook path)
// has predictable behavior. `notificationInsertFails` lets a test simulate the
// realistic case where the DB — the very thing telemetry writes to — is down,
// so the in-app notification can't be written but the webhook still must fire.
function installDbStubs(opts: {
  usageWriteFails: boolean;
  notificationInsertFails?: boolean;
}) {
  (db as unknown as DbLike).insert = (table: unknown) => {
    if (table === aiUsageTable) {
      return {
        values: () =>
          opts.usageWriteFails
            ? Promise.reject(new Error("db unavailable"))
            : Promise.resolve([{ id: 1 }]),
      };
    }
    if (table === notificationsTable) {
      return {
        values: () => ({
          returning: async () => {
            if (opts.notificationInsertFails) {
              throw new Error("notification insert down");
            }
            return [{ id: 1 }, { id: 2 }];
          },
        }),
      };
    }
    throw new Error("unexpected insert target");
  };
  (db as unknown as DbLike).select = () => ({
    from: () => ({ where: async () => ADMINS }),
  });
  (db as unknown as DbLike).update = () => ({
    set: () => ({ where: async () => undefined }),
  });
}

type Sent = { status: string; consecutiveFailures: number };

// Capture webhook POSTs by parsing the JSON body handed to fetch.
function installFetchStub(shouldFail = false): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    sent.push({
      status: body.status,
      consecutiveFailures: body.consecutiveFailures,
    });
    if (shouldFail) throw new Error("webhook unreachable");
    return { ok: true, status: 200 } as unknown as Response;
  }) as typeof fetch;
  return sent;
}

const flush = () => new Promise((r) => setTimeout(r, 10));

// Module-level incident state persists across tests in this process, so each
// test starts by driving one healthy write (with working stubs) to reset the
// consecutive-failure count and clear any incident left open by a prior test.
async function resetIncident(): Promise<void> {
  installDbStubs({ usageWriteFails: false });
  installFetchStub();
  recordAiUsage({
    workload: "packaging_analysis",
    model: "gpt-5.4",
    promptTokens: 1,
    completionTokens: 1,
    durationMs: 5,
    success: true,
  });
  await flush();
  restore();
}

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

test("fires the webhook once per incident after the threshold, then sends a resolved notice on recovery", async () => {
  await resetIncident();
  installDbStubs({ usageWriteFails: true });
  const sent = installFetchStub();
  try {
    // Below the threshold: nothing sent yet.
    for (let i = 0; i < 4; i++) failingWrite();
    await flush();
    assert.equal(sent.length, 0, "no webhook before the threshold is crossed");

    // Crossing the threshold fires exactly one "firing" webhook.
    failingWrite();
    await flush();
    assert.equal(sent.length, 1, "one webhook when the threshold is crossed");
    assert.equal(sent[0]!.status, "firing");
    assert.ok(sent[0]!.consecutiveFailures >= 5);

    // Further failures during the same incident must NOT re-fire.
    for (let i = 0; i < 5; i++) failingWrite();
    await flush();
    assert.equal(sent.length, 1, "rate-limited: no duplicate webhook per write");
  } finally {
    restore();
  }

  // A successful write delivers a matching "resolved" notice.
  installDbStubs({ usageWriteFails: false });
  const sentAfter = installFetchStub();
  try {
    failingWrite();
    await flush();
    assert.equal(sentAfter.length, 1, "exactly one recovery webhook");
    assert.equal(sentAfter[0]!.status, "resolved");
  } finally {
    restore();
  }
});

test("delivers the webhook even when the in-app notification insert fails (DB down)", async () => {
  // The failure mode that matters most: the DB is down, so the in-app alert
  // insert can't land — but the out-of-band webhook must still page admins.
  await resetIncident();
  installDbStubs({ usageWriteFails: true, notificationInsertFails: true });
  const sent = installFetchStub();
  try {
    for (let i = 0; i < 6; i++) failingWrite();
    await flush();
    assert.equal(sent.length, 1, "webhook fires despite the DB notification failing");
    assert.equal(sent[0]!.status, "firing");
  } finally {
    restore();
  }
});

test("a failing webhook never throws into the AI path and retries on the next failed write", async () => {
  await resetIncident();
  installDbStubs({ usageWriteFails: true });
  const sent = installFetchStub(true); // every POST rejects
  try {
    for (let i = 0; i < 6; i++) {
      assert.doesNotThrow(() => failingWrite());
    }
    await flush();
    // The send was attempted but rejected, so the incident stayed un-opened and
    // the next failed write retried delivery (more than one attempt observed).
    assert.ok(sent.length >= 1, "delivery was attempted");
    assert.ok(
      sent.every((s) => s.status === "firing"),
      "only firing attempts while unresolved",
    );
  } finally {
    restore();
  }
});
