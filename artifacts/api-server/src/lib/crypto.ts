import crypto from "node:crypto";

// Key selection: a dedicated AI_KEY_ENCRYPTION_SECRET (when configured)
// decouples key-at-rest encryption from session signing (defense in depth:
// rotating one doesn't silently break the other, and compromise of one isn't
// compromise of both). SESSION_SECRET remains supported so deployments that
// predate the dedicated secret keep working.
//
// New ciphertext is always written with the preferred (first) key. Decryption
// tries every candidate key in order, so historical payloads encrypted under
// SESSION_SECRET still decrypt after AI_KEY_ENCRYPTION_SECRET is introduced —
// GCM authentication guarantees a wrong key fails loudly, never silently
// returns garbage.
function candidateSecrets(): string[] {
  const secrets = [
    process.env.AI_KEY_ENCRYPTION_SECRET,
    process.env.SESSION_SECRET,
  ].filter((s): s is string => !!s);
  if (secrets.length === 0) {
    throw new Error(
      "AI_KEY_ENCRYPTION_SECRET or SESSION_SECRET must be set to encrypt/decrypt provider API keys.",
    );
  }
  return secrets;
}

// scrypt parameters for v2 payloads. N=2^15 keeps derivation ~50-100ms —
// expensive enough to make offline brute-force of the application secret
// impractical at GPU speeds, cheap enough for the rare encrypt/decrypt of
// provider API keys. maxmem must cover 128 * N * r bytes.
const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SALT_BYTES = 16;

// Legacy (v1) derivation: single unsalted SHA-256. Kept ONLY to decrypt
// payloads written before v2; never used for new ciphertext.
function deriveKeyLegacy(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

// v2 derivation: scrypt with a per-payload random salt. The salt is stored in
// the payload, so identical secrets never produce correlatable keys across
// payloads or deployments, and rainbow tables are useless.
// Cache derived keys (secret is only identified by index, never stored) so
// repeated decrypts with the same salt don't pay scrypt each time.
const keyCache = new Map<string, Buffer>();
function deriveKeyScrypt(secret: string, salt: Buffer): Buffer {
  const cacheKey = `${crypto.createHash("sha256").update(secret).digest("base64")}:${salt.toString("base64")}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;
  const key = crypto.scryptSync(secret, salt, 32, SCRYPT_PARAMS);
  // Bound the cache; entries are tiny but avoid unbounded growth.
  if (keyCache.size > 256) keyCache.clear();
  keyCache.set(cacheKey, key);
  return key;
}

/**
 * Encrypt a plaintext secret with AES-256-GCM using a scrypt-derived key.
 * Output format: v2:<salt b64>:<iv b64>:<authTag b64>:<ciphertext b64>
 */
export function encryptSecret(plain: string): string {
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    deriveKeyScrypt(candidateSecrets()[0]!, salt),
    iv,
    { authTagLength: 16 },
  );
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2:${salt.toString("base64")}:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/**
 * Decrypt a payload produced by encryptSecret. Tries each candidate key in
 * order (dedicated secret first, then SESSION_SECRET) for backward
 * compatibility with payloads written before a dedicated secret existed.
 * Returns null when the payload is missing, malformed, or fails
 * authentication under every key (e.g. fully rotated secrets).
 */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const parts = payload.split(":");
  let salt: Buffer | null = null;
  let iv: Buffer;
  let tag: Buffer;
  let data: Buffer;
  if (parts.length === 5 && parts[0] === "v2") {
    salt = Buffer.from(parts[1]!, "base64");
    iv = Buffer.from(parts[2]!, "base64");
    tag = Buffer.from(parts[3]!, "base64");
    data = Buffer.from(parts[4]!, "base64");
    if (salt.length !== SALT_BYTES) return null;
  } else if (parts.length === 4 && parts[0] === "v1") {
    // Legacy unsalted-SHA-256 payload written before v2.
    iv = Buffer.from(parts[1]!, "base64");
    tag = Buffer.from(parts[2]!, "base64");
    data = Buffer.from(parts[3]!, "base64");
  } else {
    return null;
  }
  // Explicit 16-byte tag length: reject truncated/forged auth tags outright.
  if (tag.length !== 16) return null;
  for (const secret of candidateSecrets()) {
    try {
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        salt ? deriveKeyScrypt(secret, salt) : deriveKeyLegacy(secret),
        iv,
        { authTagLength: 16 },
      );
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString(
        "utf8",
      );
    } catch {
      // Wrong key (auth failure) — try the next candidate.
    }
  }
  return null;
}
