---
name: Vite PORT/BASE_PATH build blocker
description: Static web artifact vite.config must not hard-require PORT at build time, or the production deploy build fails.
---

# Vite config env requirements vs. static production build

A web artifact's `vite.config.ts` that hard-throws when `process.env.PORT` is
missing will **fail the production deploy build** (`vite build`), because a
static build has no server to bind and the deploy build step is not guaranteed
to inject `PORT`.

**Rule:** require `PORT` only in `serve` mode (dev/preview). Use the function
form `defineConfig(({ command }) => ...)` and enforce `PORT` only when
`command === 'serve'`. For `BASE_PATH`, default to `'/'` when absent so the
build never fails on a missing env var (the artifact's `[services.env]` still
supplies it in dev/preview and prod-serve).

**Why:** `vite build` loads the full config; any top-level `throw` on a missing
env var aborts the build. Dev worked because the platform injects `PORT` for the
running service, masking the latent build-time failure until deploy.

**How to apply:** when auditing a web artifact for deploy, run the production
build in a clean env (`env -u PORT -u BASE_PATH pnpm --filter <pkg> run build`)
and confirm it emits `dist/public/index.html`. If it throws on env vars, gate
those requirements behind `command === 'serve'`.

**Contrast:** the api-server artifact explicitly duplicates env into
`[services.production.build.env]` / `[services.production.run.env]` rather than
relying on top-level `[services.env]` — a hint that top-level service env is not
reliably applied to prod build/run steps.
