import type { Request } from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { logger } from "./logger";

// Dev-only load-test support.
//
// This module lets the performance load-test harness authenticate as a seeded
// user and bypass anti-abuse rate limiting so it can measure the raw throughput
// and latency of the API. It is HARD-disabled in production:
//
//   1. It never activates when NODE_ENV === "production".
//   2. It only activates when a load-test secret (>= 16 chars) is configured.
//   3. Every request must present that exact secret in the x-loadtest-secret
//      header, plus the seeded identity to assume in x-loadtest-user.
//
// The secret is NEVER stored in tracked config. It is read from the gitignored
// file loadtest/.secret (or the LOADTEST_AUTH_SECRET env var if injected at
// runtime). A fresh checkout has no secret file, so the whole hook is inert by
// default — it must be deliberately enabled locally to load-test.

const MIN_SECRET_LEN = 16;

function readSecret(): string {
  // Never read a load-test secret in production — neither from the environment
  // nor from disk. This guarantees the bypass secret is unset even if
  // LOADTEST_AUTH_SECRET is accidentally configured in a production deployment.
  if (process.env.NODE_ENV === "production") return "";
  const fromEnv = process.env.LOADTEST_AUTH_SECRET;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const candidates = [path.resolve(process.cwd(), "loadtest/.secret")];
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(here, "../loadtest/.secret"));
  } catch {
    // import.meta.url unavailable in this context; the cwd candidate is enough.
  }
  for (const file of candidates) {
    try {
      const value = readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {
      // File not present at this candidate — try the next one.
    }
  }
  return "";
}

const SECRET = readSecret();

export function loadTestEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && SECRET.length >= MIN_SECRET_LEN;
}

// Returns the seeded identity a load-test request is authorized to assume, or
// null if the request is not a valid, secret-bearing load-test request.
export function loadTestIdentity(req: Request): { email: string } | null {
  if (!loadTestEnabled()) return null;
  const provided = req.header("x-loadtest-secret");
  if (!provided || provided !== SECRET) return null;
  const email = req.header("x-loadtest-user");
  if (!email || !email.trim()) return null;
  return { email: email.trim() };
}

export function isLoadTestRequest(req: Request): boolean {
  return loadTestIdentity(req) !== null;
}

// Startup guard: make it loud when the dev-only load-test bypass is active so it
// can never be enabled unnoticed. It cannot activate under NODE_ENV=production,
// but this warns for any non-production deployment that has a secret configured.
if (loadTestEnabled()) {
  logger.warn(
    "Load-test auth/rate-limit bypass is ENABLED (NODE_ENV != production and a load-test secret is configured). " +
      "This must never be enabled in a production deployment.",
  );
}
