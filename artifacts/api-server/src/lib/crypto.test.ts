import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret } from "./crypto";

const ORIGINAL_ENV = { ...process.env };

function setSecrets(opts: { session?: string; dedicated?: string }) {
  delete process.env.SESSION_SECRET;
  delete process.env.AI_KEY_ENCRYPTION_SECRET;
  if (opts.session) process.env.SESSION_SECRET = opts.session;
  if (opts.dedicated) process.env.AI_KEY_ENCRYPTION_SECRET = opts.dedicated;
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

test("round-trips with SESSION_SECRET only", () => {
  setSecrets({ session: "session-secret-1" });
  const payload = encryptSecret("sk-test-123");
  assert.equal(decryptSecret(payload), "sk-test-123");
});

test("round-trips with dedicated secret only", () => {
  setSecrets({ dedicated: "dedicated-secret-1" });
  const payload = encryptSecret("sk-test-456");
  assert.equal(decryptSecret(payload), "sk-test-456");
});

test("mixed-key migration: old SESSION_SECRET ciphertext still decrypts after AI_KEY_ENCRYPTION_SECRET is introduced", () => {
  // Historical payload written before the dedicated secret existed.
  setSecrets({ session: "session-secret-1" });
  const legacy = encryptSecret("sk-legacy");

  // Deployment later adds a dedicated encryption secret.
  setSecrets({ session: "session-secret-1", dedicated: "dedicated-secret-1" });
  assert.equal(decryptSecret(legacy), "sk-legacy");

  // New writes use the dedicated key, and still decrypt.
  const fresh = encryptSecret("sk-fresh");
  assert.equal(decryptSecret(fresh), "sk-fresh");
});

test("fails closed when no candidate key authenticates (full rotation)", () => {
  setSecrets({ session: "session-secret-1" });
  const payload = encryptSecret("sk-gone");
  setSecrets({ session: "rotated-away", dedicated: "also-new" });
  assert.equal(decryptSecret(payload), null);
});

test("rejects malformed payloads and truncated auth tags", () => {
  setSecrets({ session: "session-secret-1" });
  assert.equal(decryptSecret(null), null);
  assert.equal(decryptSecret(""), null);
  assert.equal(decryptSecret("v2:a:b:c"), null);
  const payload = encryptSecret("sk-x");
  const parts = payload.split(":");
  // Truncate the auth tag to 8 bytes — must be rejected outright.
  const shortTag = Buffer.from(parts[2]!, "base64").subarray(0, 8).toString("base64");
  assert.equal(decryptSecret(`v1:${parts[1]}:${shortTag}:${parts[3]}`), null);
});

test("throws when no secret is configured at all", () => {
  setSecrets({});
  assert.throws(() => encryptSecret("sk-x"), /must be set/);
});
