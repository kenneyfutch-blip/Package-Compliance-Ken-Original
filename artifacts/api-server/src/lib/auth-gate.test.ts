import test from "node:test";
import assert from "node:assert/strict";
import { classifyAuthGate, isEmailAllowed } from "./auth-gate";

// Regression guard for the server-side authentication + domain gate that every
// authed request passes through (see middlewares/requireAuth.ts). It locks in
// the exact HTTP contract requireAuth produces:
//   - no Clerk session            -> 401 (genuinely unauthenticated)
//   - Clerk lookup fails/unreachable -> 503 (retryable; NOT a forced logout)
//   - email outside allowed domains  -> 403
//   - allowed Dollar Tree associate  -> 200
// These are the failure modes that, if they regress, either lock associates out
// mid-work (401/503 confusion) or let outsiders in (403 bypass).

const okLookup = (email: string | null) => async () => ({ email, name: "U" });
const throwingLookup = async () => {
  throw new Error("clerk unreachable");
};

test("missing session (no userId) => 401", async () => {
  assert.deepEqual(await classifyAuthGate(undefined, okLookup("u@dollartree.com")), {
    status: 401,
  });
  assert.deepEqual(await classifyAuthGate(null, okLookup("u@dollartree.com")), {
    status: 401,
  });
  assert.deepEqual(await classifyAuthGate("", okLookup("u@dollartree.com")), {
    status: 401,
  });
});

test("transient Clerk lookup failure => 503 (retryable, not a logout)", async () => {
  const r = await classifyAuthGate("clerk_1", throwingLookup);
  assert.equal(r.status, 503);
  // The underlying error is carried through so requireAuth can log it.
  assert.ok(r.status === 503 && r.error instanceof Error);
});

test("email outside allowed domains => 403", async () => {
  const r = await classifyAuthGate("clerk_1", okLookup("attacker@gmail.com"));
  assert.equal(r.status, 403);
  // Identity is returned on 403 so the caller can cache the blocked decision
  // instead of re-hitting Clerk for every request from a blocked user.
  assert.ok(r.status === 403 && r.email === "attacker@gmail.com");
});

test("missing email => 403 (deny by default)", async () => {
  const r = await classifyAuthGate("clerk_1", okLookup(null));
  assert.equal(r.status, 403);
});

test("allowed Dollar Tree associate => 200 with identity", async () => {
  const r = await classifyAuthGate("clerk_1", okLookup("kfutch@dollartree.com"));
  assert.equal(r.status, 200);
  assert.ok(r.status === 200 && r.email === "kfutch@dollartree.com" && r.name === "U");
});

// --- isEmailAllowed unit coverage (the domain-matching primitive) ---

test("isEmailAllowed: exact allowed domain, case-insensitive", () => {
  assert.equal(isEmailAllowed("a@dollartree.com"), true);
  assert.equal(isEmailAllowed("A@DollarTree.COM"), true);
});

test("isEmailAllowed: rejects null/empty/malformed", () => {
  assert.equal(isEmailAllowed(null), false);
  assert.equal(isEmailAllowed(undefined), false);
  assert.equal(isEmailAllowed(""), false);
  assert.equal(isEmailAllowed("no-at-sign"), false);
});

test("isEmailAllowed: rejects look-alike / subdomain spoofs", () => {
  // Must be an exact domain match — not a suffix — so these are all denied.
  assert.equal(isEmailAllowed("a@dollartree.com.evil.com"), false);
  assert.equal(isEmailAllowed("a@notdollartree.com"), false);
  assert.equal(isEmailAllowed("a@sub.dollartree.com"), false);
  assert.equal(isEmailAllowed("a@gmail.com"), false);
});
