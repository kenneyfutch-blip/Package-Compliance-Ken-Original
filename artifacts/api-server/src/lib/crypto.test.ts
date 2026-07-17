import crypto from "node:crypto";
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

test("new ciphertext uses v2 scrypt format with a per-payload random salt", () => {
  setSecrets({ session: "session-secret-1" });
  const a = encryptSecret("sk-same");
  const b = encryptSecret("sk-same");
  const pa = a.split(":");
  const pb = b.split(":");
  assert.equal(pa.length, 5);
  assert.equal(pa[0], "v2");
  assert.equal(Buffer.from(pa[1]!, "base64").length, 16);
  // Salts must differ between payloads of the same plaintext/secret.
  assert.notEqual(pa[1], pb[1]);
  assert.equal(decryptSecret(a), "sk-same");
  assert.equal(decryptSecret(b), "sk-same");
});

test("legacy v1 (unsalted SHA-256) payloads still decrypt", () => {
  setSecrets({ session: "session-secret-1" });
  // Recreate a historical v1 payload exactly as the old code wrote it.
  const key = crypto.createHash("sha256").update("session-secret-1").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const enc = Buffer.concat([cipher.update("sk-legacy-v1", "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const legacy = `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
  assert.equal(decryptSecret(legacy), "sk-legacy-v1");
});

test("rejects malformed payloads and truncated auth tags", () => {
  setSecrets({ session: "session-secret-1" });
  assert.equal(decryptSecret(null), null);
  assert.equal(decryptSecret(""), null);
  assert.equal(decryptSecret("v2:a:b:c"), null);
  assert.equal(decryptSecret("v3:a:b:c:d"), null);
  const payload = encryptSecret("sk-x");
  const parts = payload.split(":");
  // Truncate the auth tag to 8 bytes — must be rejected outright.
  const shortTag = Buffer.from(parts[3]!, "base64").subarray(0, 8).toString("base64");
  assert.equal(decryptSecret(`v2:${parts[1]}:${parts[2]}:${shortTag}:${parts[4]}`), null);
  // Wrong-length salt must be rejected outright.
  const shortSalt = Buffer.alloc(8).toString("base64");
  assert.equal(decryptSecret(`v2:${shortSalt}:${parts[2]}:${parts[3]}:${parts[4]}`), null);
});

test("throws when no secret is configured at all", () => {
  setSecrets({});
  assert.throws(() => encryptSecret("sk-x"), /must be set/);
});
