#!/usr/bin/env node
/**
 * Load-test harness for the Compliance API.
 *
 * Proves the app meets its launch performance targets under realistic
 * concurrency. It authenticates via the dev-only load-test auth hook (see
 * src/lib/loadtest.ts) — which is hard-disabled in production — so it can call
 * real authenticated endpoints without a live Clerk browser session.
 *
 * It exercises the highest-traffic read paths (dashboard aggregates, package /
 * violation / review lists) at a target concurrency for a fixed duration, then
 * runs an AI-backed analysis flow (the Compliance Copilot) to measure cold model
 * latency and AI response-cache effectiveness.
 *
 * Usage:
 *   LOADTEST_AUTH_SECRET=... node loadtest/run.mjs [--concurrency 50] [--duration 30]
 *
 * Env / flags:
 *   LOADTEST_AUTH_SECRET   (required) must match the server's secret
 *   LOADTEST_BASE          base URL (default http://localhost:8080)
 *   LOADTEST_USER          seeded user to assume (default admin)
 *   --concurrency / -c     concurrent workers (default 50)
 *   --duration / -d        measured window in seconds (default 30)
 *   --ai-burst             identical AI requests fired to test caching (default = concurrency)
 *   --targets              JSON of {p95ReadMs,p95AiMs,errorPct} for pass/fail
 */

import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";

// ---- config ---------------------------------------------------------------
function arg(name, short, fallback) {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` || (short && argv[i] === `-${short}`)) {
      return argv[i + 1];
    }
  }
  return fallback;
}

const BASE = (process.env.LOADTEST_BASE || "http://localhost:8080").replace(/\/$/, "");
const SECRET = process.env.LOADTEST_AUTH_SECRET || "";
const USER = process.env.LOADTEST_USER || "dana.whitfield@dollartree.com";
const CONCURRENCY = Number(arg("concurrency", "c", process.env.LOADTEST_CONCURRENCY || 50));
const DURATION_MS = Number(arg("duration", "d", process.env.LOADTEST_DURATION || 30)) * 1000;
const AI_BURST = Number(arg("ai-burst", null, CONCURRENCY));
const TARGETS = JSON.parse(
  arg("targets", null, process.env.LOADTEST_TARGETS ||
    '{"p95ReadMs":500,"p95AiMs":12000,"errorPct":1}'),
);

if (!SECRET) {
  console.error("ERROR: LOADTEST_AUTH_SECRET is required (must match the server).");
  process.exit(1);
}

const HEADERS = {
  "x-loadtest-secret": SECRET,
  "x-loadtest-user": USER,
  "content-type": "application/json",
};

// ---- helpers --------------------------------------------------------------
async function call(method, path, body) {
  const start = performance.now();
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: HEADERS,
      body: body ? JSON.stringify(body) : undefined,
    });
    // Drain the body so timing reflects a full response, like a real client.
    await res.arrayBuffer();
    return { ms: performance.now() - start, status: res.status, ok: res.ok };
  } catch (err) {
    return { ms: performance.now() - start, status: 0, ok: false, err: String(err) };
  }
}

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function stats(latencies) {
  const s = [...latencies].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    count: s.length,
    min: Math.round(s[0] || 0),
    mean: Math.round(sum / (s.length || 1)),
    p50: Math.round(pct(s, 50)),
    p95: Math.round(pct(s, 95)),
    p99: Math.round(pct(s, 99)),
    max: Math.round(s[s.length - 1] || 0),
  };
}

function weightedPool(entries) {
  const pool = [];
  for (const [path, weight] of entries) {
    for (let i = 0; i < weight; i++) pool.push(path);
  }
  return pool;
}

// Highest-traffic read endpoints, weighted by how often a real session hits them.
const READ_ENDPOINTS = [
  ["/api/dashboard/stats", 3],
  ["/api/dashboard/trends", 2],
  ["/api/dashboard/violation-distribution", 2],
  ["/api/dashboard/category-distribution", 2],
  ["/api/dashboard/vendor-performance", 2],
  ["/api/packages?limit=50", 4],
  ["/api/violations?limit=50", 4],
  ["/api/reviews/assignments?limit=50", 2],
  ["/api/reviews/my-work", 1],
  ["/api/reviews/metrics", 1],
  ["/api/regulations", 1],
  ["/api/suppliers", 1],
];

// ---- read load stage ------------------------------------------------------
async function runReadStage(concurrency, durationMs) {
  const pool = weightedPool(READ_ENDPOINTS);
  const perPath = new Map(); // path -> { lat:[], errors:n }
  let total = 0;
  let errors = 0;

  const endAt = Date.now() + durationMs;
  async function worker() {
    while (Date.now() < endAt) {
      const path = pool[Math.floor(Math.random() * pool.length)];
      const r = await call("GET", path);
      total++;
      let bucket = perPath.get(path);
      if (!bucket) {
        bucket = { lat: [], errors: 0 };
        perPath.set(path, bucket);
      }
      bucket.lat.push(r.ms);
      if (!r.ok) {
        errors++;
        bucket.errors++;
      }
    }
  }

  const wallStart = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const wallSec = (performance.now() - wallStart) / 1000;

  const allLat = [];
  const byEndpoint = {};
  for (const [path, b] of perPath) {
    allLat.push(...b.lat);
    byEndpoint[path] = { ...stats(b.lat), errors: b.errors };
  }

  return {
    concurrency,
    durationSec: Math.round(wallSec),
    totalRequests: total,
    throughputRps: Math.round(total / wallSec),
    errorCount: errors,
    errorPct: Number(((errors / (total || 1)) * 100).toFixed(3)),
    overall: stats(allLat),
    byEndpoint,
  };
}

// ---- AI-backed analysis stage (Compliance Copilot) ------------------------
async function runAiStage(burst) {
  // Find a package to analyze.
  const listRes = await fetch(BASE + "/api/packages?limit=1", { headers: HEADERS });
  if (!listRes.ok) {
    return { skipped: true, reason: `could not list packages (HTTP ${listRes.status})` };
  }
  const pkgs = await listRes.json();
  const pkg = Array.isArray(pkgs) ? pkgs[0] : null;
  if (!pkg?.id) return { skipped: true, reason: "no packages available to analyze" };

  const path = `/api/packages/${pkg.id}/copilot`;
  const cold = [];
  // A few unique questions => guaranteed cache misses => real model latency.
  for (let i = 0; i < 3; i++) {
    const r = await call("POST", path, {
      question: `Load test cold question ${Date.now()}-${i}: what are the top compliance risks?`,
    });
    cold.push({ ...r });
    if (!r.ok) {
      return {
        skipped: true,
        reason: `copilot returned HTTP ${r.status} (AI provider may be unconfigured)`,
        packageId: pkg.id,
      };
    }
  }

  // Cache-effectiveness: one warm-up with a fixed question (now cached), then a
  // burst of identical requests. With the single-flight TTL cache these should be
  // served without duplicate model calls, i.e. far faster than a cold call.
  const cachedQuestion = `Load test cached question ${Date.now()}: summarize the compliance status.`;
  const warmup = await call("POST", path, { question: cachedQuestion });
  const burstResults = await Promise.all(
    Array.from({ length: burst }, () => call("POST", path, { question: cachedQuestion })),
  );

  const coldLat = cold.map((r) => r.ms);
  const okBurst = burstResults.filter((r) => r.ok);
  const warmLat = okBurst.map((r) => r.ms);
  const coldStats = stats(coldLat);
  // A cache/dedup hit is a SUCCESSFUL response served materially faster than a
  // cold model call. Only successful responses count — a fast failure is not a
  // cache hit and must never inflate the hit rate.
  const cacheThresholdMs = Math.max(1000, Math.round(coldStats.p50 * 0.5));
  const cacheHits = warmLat.filter((ms) => ms < cacheThresholdMs).length;
  const burstErrors = burstResults.length - okBurst.length;

  return {
    skipped: false,
    packageId: pkg.id,
    coldSampleCount: coldLat.length,
    cold: coldStats,
    warmupMs: Math.round(warmup.ms),
    burst,
    warm: stats(warmLat),
    cacheThresholdMs,
    cacheHits,
    cacheHitPct: Number(((cacheHits / (burst || 1)) * 100).toFixed(1)),
    burstErrors,
  };
}

// ---- reporting ------------------------------------------------------------
function line(w = 78) {
  return "-".repeat(w);
}

function printReadStage(label, s) {
  console.log(`\n${label} — ${s.concurrency} concurrent, ${s.durationSec}s`);
  console.log(line());
  console.log(
    `requests=${s.totalRequests}  throughput=${s.throughputRps} req/s  ` +
      `errors=${s.errorCount} (${s.errorPct}%)`,
  );
  const o = s.overall;
  console.log(
    `latency ms  p50=${o.p50}  p95=${o.p95}  p99=${o.p99}  mean=${o.mean}  max=${o.max}`,
  );
  console.log("\nper endpoint (p50 / p95 / p99 ms, errors):");
  for (const [path, e] of Object.entries(s.byEndpoint).sort()) {
    console.log(
      `  ${path.padEnd(46)} ${String(e.p50).padStart(5)} / ` +
        `${String(e.p95).padStart(5)} / ${String(e.p99).padStart(6)}  err=${e.errors}`,
    );
  }
}

function printAiStage(ai) {
  console.log(`\nAI-backed analysis (Compliance Copilot)`);
  console.log(line());
  if (ai.skipped) {
    console.log(`SKIPPED: ${ai.reason}`);
    return;
  }
  console.log(
    `cold (${ai.coldSampleCount} unique):  p50=${ai.cold.p50}ms  p95=${ai.cold.p95}ms  max=${ai.cold.max}ms`,
  );
  console.log(
    `cached burst (${ai.burst} identical):  p50=${ai.warm.p50}ms  p95=${ai.warm.p95}ms  max=${ai.warm.max}ms`,
  );
  console.log(
    `cache hits: ${ai.cacheHits}/${ai.burst} (${ai.cacheHitPct}%) under ${ai.cacheThresholdMs}ms  ` +
      `burstErrors=${ai.burstErrors}`,
  );
}

function verdict(name, pass, detail) {
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
  return pass;
}

// ---- main -----------------------------------------------------------------
(async () => {
  console.log(line());
  console.log(`Compliance API load test`);
  console.log(`base=${BASE}  user=${USER}`);
  console.log(
    `targets: p95 read <= ${TARGETS.p95ReadMs}ms, p95 AI <= ${TARGETS.p95AiMs}ms, ` +
      `error rate < ${TARGETS.errorPct}%`,
  );
  console.log(line());

  // Warm up: hit each endpoint once so caches/JIT are primed before measuring.
  for (const [path] of READ_ENDPOINTS) await call("GET", path);

  const target = await runReadStage(CONCURRENCY, DURATION_MS);
  printReadStage("READ STAGE @ TARGET", target);

  const stretch = await runReadStage(CONCURRENCY * 2, DURATION_MS);
  printReadStage("READ STAGE @ STRETCH", stretch);

  const ai = await runAiStage(AI_BURST);
  printAiStage(ai);

  // Pass/fail against targets (target concurrency is the contract; stretch is
  // informational headroom).
  console.log(`\nVERDICT vs targets (@ target concurrency ${CONCURRENCY})`);
  console.log(line());
  const checks = [];
  checks.push(
    verdict(
      "read p95 latency",
      target.overall.p95 <= TARGETS.p95ReadMs,
      `${target.overall.p95}ms vs <= ${TARGETS.p95ReadMs}ms`,
    ),
  );
  checks.push(
    verdict(
      "error rate",
      target.errorPct < TARGETS.errorPct,
      `${target.errorPct}% vs < ${TARGETS.errorPct}%`,
    ),
  );
  if (!ai.skipped) {
    checks.push(
      verdict(
        "AI-backed p95 latency (cold)",
        ai.coldSampleCount > 0 && ai.cold.p95 <= TARGETS.p95AiMs,
        `${ai.cold.p95}ms vs <= ${TARGETS.p95AiMs}ms`,
      ),
    );
    checks.push(
      verdict(
        "AI cache effectiveness",
        ai.cacheHitPct >= 90 && ai.burstErrors === 0,
        `${ai.cacheHitPct}% served from cache, burstErrors=${ai.burstErrors}`,
      ),
    );
  } else {
    // AI-backed analysis is in scope for this task: a stage that could not run
    // does not prove the target and must not yield an overall PASS.
    checks.push(
      verdict("AI-backed analysis", false, `stage did not run: ${ai.reason}`),
    );
  }
  const allPass = checks.every(Boolean);
  console.log(`\nOVERALL: ${allPass ? "PASS" : "FAIL"}`);

  const out = {
    ranAt: new Date().toISOString(),
    base: BASE,
    user: USER,
    targets: TARGETS,
    target,
    stretch,
    ai,
    pass: allPass,
  };
  const file = new URL(`./last-run.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${file.pathname}`);
  process.exit(allPass ? 0 : 2);
})();
