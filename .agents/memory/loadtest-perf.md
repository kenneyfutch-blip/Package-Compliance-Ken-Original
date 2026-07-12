---
name: Load test harness & performance baseline
description: How authenticated load tests are run against the API and the measured launch baseline / throughput ceiling to compare future work against.
---

# Load test harness & performance baseline

A repeatable load-test harness lives under `artifacts/api-server/loadtest/`.

## Authenticating a load test (dev only)
All `/api` routes need a Clerk session and seed users don't exist in Clerk, so
the harness relies on a **dev-only, production-disabled auth + rate-limit
bypass**: it authenticates as a *seeded* user (read-only, no mutation) and skips
the limiter, gated on `NODE_ENV != production` + a configured secret + matching
request headers.

**Secret handling decision:** the load-test secret must live ONLY in the
gitignored `loadtest/.secret` file, never in tracked config. Do NOT use
`setEnvVars` for it — that writes plaintext into `.replit`, which is a committed
file, and a completion review will reject it as a leaked auth-bypass secret.
**Why:** a bypass secret in source control weakens the very protection it gates.
A fresh checkout has no secret file, so the hook is inert by default — the safest
state.

## Measured baseline (2026-07, single dev process)
- Reads: p95 ~148 ms @ 50 concurrent, ~289 ms @ 100, 0 errors — well under the
  500 ms / <1% targets.
- AI copilot: cold ~5.4 s (real model call, target ≤12 s); repeated identical
  requests are ~100% served from the single-flight cache (~250 ms), no duplicate
  model calls.
- **Throughput ceiling ≈ 580 req/s per process:** completed throughput is flat
  from 50→100 concurrency while latency doubles. This is event-loop / DB-pool
  bound, NOT a slow endpoint.

**How to apply:** compare future perf work against these numbers. To beat the
ceiling, scale out (more API instances) + size the Postgres pool — don't go
hunting for a "slow query," there isn't one.
