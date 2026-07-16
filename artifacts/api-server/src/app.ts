import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { apiRateLimiter } from "./middlewares/rateLimit";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Runs behind the Replit/Clerk proxy: trust the first forwarded hop so req.ip
// reflects the real client for rate limiting rather than the proxy address.
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Clerk proxy must run before body parsers (it streams raw bytes).
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Security headers. crossOriginResourcePolicy is relaxed to "cross-origin" so
// the separately-hosted web artifact can consume the API through the proxy.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // Explicit enterprise-hardening headers (helmet defaults cover most; these
    // pin the values so a helmet upgrade can't silently weaken them).
    strictTransportSecurity: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);

// CORS: allowlist instead of blanket origin reflection. Same-origin requests
// (the web artifact reaches the API through the shared proxy) send no Origin
// or a matching one; only Replit-hosted origins for this app are permitted for
// credentialed cross-origin calls.
const corsAllowedHosts = new Set(
  [
    process.env["REPLIT_DEV_DOMAIN"],
    ...(process.env["REPLIT_DOMAINS"]?.split(",") ?? []),
  ]
    .map((d) => d?.trim())
    .filter((d): d is string => !!d),
);
app.use(
  cors({
    credentials: true,
    origin: (origin, cb) => {
      // No Origin header = same-origin / curl / server-to-server: allow.
      if (!origin) return cb(null, true);
      try {
        const { hostname, protocol } = new URL(origin);
        const allowed =
          protocol === "https:" ? corsAllowedHosts.has(hostname) : hostname === "localhost";
        return cb(null, allowed);
      } catch {
        return cb(null, false);
      }
    },
  }),
);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// Rate limiting (keyed per authenticated user, else per client IP). Applied
// after Clerk middleware so the user key is available.
app.use("/api", apiRateLimiter);

app.use("/api", router);

// JSON 404 for unmatched API routes (avoids the default HTML response).
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// Centralized error handler. Never leaks stack traces or internal messages to
// the client; the full error is logged server-side. Express 5 forwards rejected
// async handlers here automatically.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  req.log?.error({ err }, "Unhandled request error");
  if (res.headersSent) return;
  const e = err as { type?: string; status?: number; statusCode?: number };
  // Malformed JSON body (thrown by express.json()).
  if (e?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Malformed request body" });
    return;
  }
  // Payload too large.
  if (e?.type === "entity.too.large") {
    res.status(413).json({ error: "Request payload too large" });
    return;
  }
  const status = e?.status ?? e?.statusCode ?? 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: status === 500 ? "Internal server error" : "Request failed",
  });
});

export default app;
