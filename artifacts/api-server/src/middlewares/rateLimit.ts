import type { Request, Response, NextFunction } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { getAuth } from "@clerk/express";

// Rate limiting for the API. Requests are keyed by the authenticated Clerk user
// when present (fair per-user limits behind the shared Replit/Clerk proxy) and
// fall back to the client IP for unauthenticated traffic. `trust proxy` is set
// in app.ts so the forwarded client IP is used rather than the proxy's.
function keyByUserOrIp(req: Request, res: Response): string {
  const userId = getAuth(req)?.userId;
  if (userId) return `user:${userId}`;
  // ipKeyGenerator normalizes IPv6 addresses into a stable subnet key.
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function tooMany(res: Response) {
  res.status(429).json({ error: "Too many requests. Please slow down and try again shortly." });
}

// General ceiling across every authenticated API call. Set high enough not to
// disrupt a normal dashboard session (which fans out many reads per page) while
// still stopping runaway automation or scraping.
export const generalLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  handler: (_req, res) => tooMany(res),
});

// Expensive AI / document-processing operations (OCR, Document AI extraction,
// package analysis, language review, policy ingestion). Much stricter.
export const aiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  handler: (_req, res) => tooMany(res),
});

// Upload URL issuance. Prevents mass presigned-URL generation.
export const uploadLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  handler: (_req, res) => tooMany(res),
});

// POST paths that trigger AI or document processing.
const AI_POST_PATHS: RegExp[] = [
  /^\/api\/ocr$/,
  /^\/api\/packages$/,
  /^\/api\/packages\/[^/]+\/(analyze|reprocess|copilot|language-review)$/,
  /^\/api\/packages\/(bulk-analyze|bulk-language-review)$/,
  /^\/api\/policies$/,
  /^\/api\/policies\/[^/]+\/reprocess$/,
];

const UPLOAD_POST_PATHS: RegExp[] = [/^\/api\/storage\/uploads\/request-url$/];

// Single dispatcher applied before the router: routes each sensitive POST to its
// stricter limiter, everything else to the general limiter. Keeping the routing
// in one place avoids sprinkling limiter middleware across every route file.
export function apiRateLimiter(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "POST") {
    // This runs mounted at "/api", so req.path has that prefix stripped;
    // recombine with baseUrl to match the full "/api/..." patterns. Strip any
    // trailing slash so path variants (/api/packages/ vs /api/packages) can't
    // slip past the strict limiters into the general one.
    const raw = (req.baseUrl || "") + req.path;
    const path = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
    if (AI_POST_PATHS.some((re) => re.test(path))) {
      aiLimiter(req, res, next);
      return;
    }
    if (UPLOAD_POST_PATHS.some((re) => re.test(path))) {
      uploadLimiter(req, res, next);
      return;
    }
  }
  generalLimiter(req, res, next);
}
