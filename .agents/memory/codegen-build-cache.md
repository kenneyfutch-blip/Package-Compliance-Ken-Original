---
name: orval codegen + tsc build cache staleness
description: Why api-server typecheck can see OLD generated api-zod types after regenerating the OpenAPI client, and how to force-refresh.
---

# Stale tsc build output after orval codegen

After changing `lib/api-spec/openapi.yaml` and running `pnpm --filter @workspace/api-spec run codegen`
(orval regenerates `lib/api-client-react` + `lib/api-zod` **source**, then runs `tsc --build`),
a consumer like `@workspace/api-server` can still typecheck against the **previous** generated
types and fail with errors that contradict the current generated source (e.g. a request body
showing an old field name).

**Why:** `@workspace/api-zod` package `exports` map points `.` at `./src/index.ts`, but api-server's
project-reference typecheck resolves the referenced project's **built declarations** (`lib/api-zod/dist/*.d.ts`).
`tsc --build` is incremental and its `.tsbuildinfo` sometimes decides the dist is up to date and does
NOT recompile, so `dist/generated/api.d.ts` keeps the old shape while `src/generated/api.ts` is already new.

**How to apply:** When a post-codegen typecheck error names a generated symbol whose shape does not
match the current `src/generated`, don't hand-edit — force a clean rebuild:
`find lib/api-zod -name "*.tsbuildinfo" -delete && rm -rf lib/api-zod/dist && pnpm -w run typecheck:libs`,
then re-run the consumer's typecheck. The same applies to any generated workspace lib consumed via
project references.
