import crypto from "node:crypto";

const SECRET = process.env.SESSION_SECRET;

function getKey(): Buffer {
  if (!SECRET) {
    throw new Error(
      "SESSION_SECRET must be set to encrypt/decrypt provider API keys.",
    );
  }
  // Derive a stable 32-byte key from the session secret.
  return crypto.createHash("sha256").update(SECRET).digest();
}

/**
 * Encrypt a plaintext secret with AES-256-GCM. Output format:
 * v1:<iv b64>:<authTag b64>:<ciphertext b64>
 */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/**
 * Decrypt a payload produced by encryptSecret. Returns null when the payload
 * is missing, malformed, or fails authentication (e.g. rotated secret).
 */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const iv = Buffer.from(parts[1]!, "base64");
    const tag = Buffer.from(parts[2]!, "base64");
    const data = Buffer.from(parts[3]!, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null;
  }
}
