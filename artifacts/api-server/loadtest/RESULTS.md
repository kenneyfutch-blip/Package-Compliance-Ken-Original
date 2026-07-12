# Load Test Results — Launch Performance Targets

**Verdict: PASS** (all targets met, with substantial headroom).

Measured against the hardened API (consistent clamped pagination + single-flight
TTL AI cache + short-TTL dashboard aggregate cache) using the harness in this
directory (`node loadtest/run.mjs`). Re-run any time to reproduce.

## Targets (confirmed with the user)

| Target | Threshold |
| --- | --- |
| Sustained concurrent users | 50 (stretch 100) |
| p95 latency, read endpoints | ≤ 500 ms |
| p95 latency, AI-backed analysis request | ≤ 12 000 ms |
| Error rate at target concurrency | < 1 % |
| AI cache effectiveness | repeated identical requests served from cache |

## Environment

- In-container run against the live dev server on `localhost:8080` (no proxy hop),
  authenticated as the seeded `platform_admin` via the dev-only load-test hook.
- Single API process (as deployed in dev). Postgres is the shared dev database.
- Two 30 s read stages (target = 50 workers, stretch = 100), then the AI stage.

## Results vs targets (@ 50 concurrent)

| Check | Measured | Target | Result |
| --- | --- | --- | --- |
| Read p95 latency | **148 ms** | ≤ 500 ms | ✅ PASS |
| Error rate | **0 %** (0 / 17,374) | < 1 % | ✅ PASS |
| AI cold p95 latency | **5,431 ms** | ≤ 12,000 ms | ✅ PASS |
| AI cache hit rate (identical reqs) | **100 %** (50 / 50) | served from cache | ✅ PASS |

## Read stage detail

### Target — 50 concurrent, 30 s
- **17,374 requests**, **578 req/s**, **0 errors**.
- Overall latency: p50 79 ms · p95 148 ms · p99 198 ms · max 368 ms.

### Stretch — 100 concurrent, 30 s
- **17,547 requests**, **584 req/s**, **0 errors**.
- Overall latency: p50 161 ms · p95 289 ms · p99 363 ms · max 452 ms.
- Even at 2× target concurrency, read p95 (289 ms) stays under the 500 ms target.

Per-endpoint p95 (target run): dashboard aggregates ~104–109 ms; package /
violation / supplier / regulation lists ~135–140 ms; review lists
(`/reviews/metrics`, `/reviews/my-work`) ~220 ms — the slowest reads but still
well within target.

## AI-backed analysis (Compliance Copilot)

- **Cold** (3 unique questions, real model calls): p50 5,391 ms · p95 5,431 ms.
- **Cached burst** (50 identical concurrent requests): p50 245 ms · p95 278 ms.
- **100 % of identical requests were served from cache** (all < 2,696 ms, ~20×
  faster than a cold call), with **0 errors**. The single-flight TTL cache
  collapses concurrent identical analysis requests so duplicate model calls are
  effectively zero — the exact cache-effectiveness target.

## Bottlenecks & observations

All targets pass, so these are headroom notes rather than blockers:

1. **Single-process throughput ceiling ≈ 580 req/s.** Completed throughput is
   nearly identical at 50 and 100 concurrent workers (578 vs 584 req/s) while
   latency roughly doubles (p50 79 → 161 ms). That plateau is the signature of a
   service reaching its concurrency ceiling: extra offered load queues rather
   than increasing throughput. For one Node process this is expected; it is bound
   by the single event loop and the Postgres connection pool, not by any slow
   query. **Recommended fix if higher throughput is ever required:** run multiple
   API instances behind the proxy (horizontal scale) and size the DB pool to
   match — this is a scaling change, out of scope here, and would be its own task.

2. **Review list endpoints are ~2× the other reads** (`/reviews/metrics`,
   `/reviews/my-work` ≈ 220 ms p95 vs ≈ 105 ms for dashboard aggregates). Still
   inside target; a candidate for query/index review only if they become hot
   paths.

3. **AI cold latency (~5.4 s) is dominated by the upstream model**, not app code.
   The cache is what keeps the AI path far under target under load; if the cold
   number ever needs to drop, that is a model/provider-tier decision.

## Reproduce

```bash
cd artifacts/api-server
LOADTEST_AUTH_SECRET=$(cat loadtest/.secret) node loadtest/run.mjs \
  --concurrency 50 --duration 30 \
  --targets '{"p95ReadMs":500,"p95AiMs":12000,"errorPct":1}'
```

Raw machine-readable output is written to `loadtest/last-run.json`.
