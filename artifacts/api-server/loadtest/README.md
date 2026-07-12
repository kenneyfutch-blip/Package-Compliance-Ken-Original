# Compliance API — Load Test Harness

Proves the API meets its launch performance targets under realistic concurrency.
It measures the hottest read paths (dashboard aggregates, package / violation /
review lists) plus an AI-backed analysis flow (the Compliance Copilot), and
reports latency percentiles, throughput, error rate, and AI cache effectiveness
with pass/fail per target.

## How authentication works (dev only)

The API requires a Clerk session. To run authenticated load without a live
browser login, the server has a **dev-only auth hook** (`src/lib/loadtest.ts`):

- It is **hard-disabled in production** — it never activates when
  `NODE_ENV === "production"`.
- It only activates when a load-test secret (≥ 16 chars) is configured.
- Every request must present that exact secret (`x-loadtest-secret`) plus the
  seeded identity to assume (`x-loadtest-user`).

When active, a request is authenticated as the named **seeded** user, reusing
that user's real role, permissions, and tenant scope (read-only lookup — no user
rows are created or mutated). The same gate lets the harness bypass anti-abuse
rate limiting so it measures raw server throughput rather than the limiter.

Because production sets `NODE_ENV=production` and configures no load-test secret,
this hook can never be used against the deployed app.

## Setup — the secret

The secret lives **only** in the gitignored file `loadtest/.secret` — never in
tracked config. Both the server and the harness read it from there. A fresh
checkout has no secret file, so the hook is inert until you create one:

```bash
cd artifacts/api-server
openssl rand -hex 24 > loadtest/.secret   # generate a fresh secret
# restart the API server so it picks up the new secret
```

To rotate, overwrite the file and restart the API. Never commit this file.

## Run

```bash
cd artifacts/api-server
LOADTEST_AUTH_SECRET=$(cat loadtest/.secret) node loadtest/run.mjs \
  --concurrency 50 --duration 30 \
  --targets '{"p95ReadMs":500,"p95AiMs":12000,"errorPct":1}'
```

The harness runs the read stage at the target concurrency, again at 2× (stretch),
then the AI stage. Results are printed and written to `loadtest/last-run.json`.
Exit code is `0` on pass, `2` on fail.

### Flags / env

| Flag / env | Default | Meaning |
| --- | --- | --- |
| `--concurrency` / `-c` | 50 | Concurrent workers at target |
| `--duration` / `-d` | 30 | Measured window (seconds) per stage |
| `--ai-burst` | = concurrency | Identical AI requests fired to test caching |
| `--targets` | `{p95ReadMs:500,p95AiMs:12000,errorPct:1}` | Pass/fail thresholds |
| `LOADTEST_BASE` | `http://localhost:8080` | API base URL |
| `LOADTEST_USER` | `dana.whitfield@dollartree.com` | Seeded user to assume |

Latest measured results and analysis live in `RESULTS.md`.
