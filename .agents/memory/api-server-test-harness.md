---
name: api-server test harness (test.mjs) pino bundling
description: Why a node:test file that imports the logger crashes with "__dirname is not defined", and the harness fix.
---

# api-server test.mjs must bundle pino like build.mjs

`artifacts/api-server` tests are bundled by `test.mjs` with esbuild (native TS
loader can't resolve extension-less imports inside generated `@workspace/*`
packages) and run with the Node test runner.

**Symptom:** A test that imports anything pulling in `./lib/logger` (pino) fails
at module load with `ReferenceError: __dirname is not defined in ES module
scope`, thrown from pino's `createWorker` / `ThreadStream`. In dev/non-production
the logger constructs a `pino-pretty` transport, which spawns a worker thread —
and the bundle lacked both the worker file and the `__dirname` global.

**Why:** `build.mjs` handles this with `esbuildPluginPino({ transports:
["pino-pretty"] })` plus a banner defining `globalThis.__dirname/__filename`.
`test.mjs` originally had neither, so only tests that never touched the logger
passed; the first logger-importing test crashed the whole test file.

**How to apply:** Keep `test.mjs` in lockstep with `build.mjs` for pino — the
esbuild-plugin-pino plugin and the `__dirname`/`__filename` banner globals. If a
new api-server test crashes on `__dirname` at import, this drift is the cause,
not the test code.
