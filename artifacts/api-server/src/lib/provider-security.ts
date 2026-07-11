import { promises as dns } from "node:dns";
import net from "node:net";

export const ALLOWED_PROVIDER_TYPES = ["openai", "openrouter", "custom"] as const;
export type ProviderType = (typeof ALLOWED_PROVIDER_TYPES)[number];

export function isValidProviderType(v: unknown): v is ProviderType {
  return (
    typeof v === "string" &&
    (ALLOWED_PROVIDER_TYPES as readonly string[]).includes(v)
  );
}

function ipIsPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === undefined || b === undefined) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("::ffff:")) return ipIsPrivate(lower.replace("::ffff:", ""));
  return false;
}

/**
 * Validate a provider base URL to reduce SSRF risk: require HTTPS, reject
 * localhost/internal hostnames, and ensure the host does not resolve to a
 * private/link-local address. Returns an error message, or null when safe.
 */
export async function validateBaseUrl(raw: string): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Base URL must be a valid URL.";
  }
  if (u.protocol !== "https:") return "Base URL must use HTTPS.";
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return "Base URL host is not permitted.";
  }
  if (net.isIP(host)) {
    return ipIsPrivate(host) ? "Base URL points to a private address." : null;
  }
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (addrs.length === 0) return "Base URL host could not be resolved.";
    for (const a of addrs) {
      if (ipIsPrivate(a.address)) {
        return "Base URL resolves to a private address.";
      }
    }
  } catch {
    return "Base URL host could not be resolved.";
  }
  return null;
}
