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

// Derive a stable 32-byte key from a secret.
function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypt a plaintext secret with AES-256-GCM. Output format:
 * v1:<iv b64>:<authTag b64>:<ciphertext b64>
 */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    deriveKey(candidateSecrets()[0]!),
    iv,
    { authTagLength: 16 },
  );
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
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
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const iv = Buffer.from(parts[1]!, "base64");
  const tag = Buffer.from(parts[2]!, "base64");
  const data = Buffer.from(parts[3]!, "base64");
  // Explicit 16-byte tag length: reject truncated/forged auth tags outright.
  if (tag.length !== 16) return null;
  for (const secret of candidateSecrets()) {
    try {
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        deriveKey(secret),
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
