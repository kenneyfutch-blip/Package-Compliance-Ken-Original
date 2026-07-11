---
name: root tsconfig must list every referenced composite lib
description: Why api-server typecheck fails with TS6305 unless the root tsconfig references every composite lib any artifact consumes.
---

# Root tsconfig references must include every composite lib an artifact references

`pnpm run typecheck` = `typecheck:libs` (`tsc --build` on root `tsconfig.json`) then per-artifact
`tsc -p tsconfig.json --noEmit`. The per-artifact typecheck is NOT build mode, so it never builds
its own composite references — it only *checks* them and emits `TS6305 "Output file ... has not been
built from source"` for any referenced composite lib whose `dist` wasn't produced by `typecheck:libs`.

Therefore every composite lib referenced by ANY artifact must ALSO be listed in the root
`tsconfig.json` `references`, or that artifact's typecheck fails.

**Why:** `artifacts/api-server/tsconfig.json` references `lib/integrations-openai-ai-server`, but the
root `tsconfig.json` only listed `lib/db`, `lib/api-client-react`, `lib/api-zod`,
`lib/object-storage-web`. So `typecheck:libs` never built the integrations lib, and
`pnpm run typecheck` failed with a single TS6305 on it (`src/lib/ai-client.ts`). This defect existed
on `main` too — a truly pristine checkout of main fails `pnpm run typecheck` identically. Adding
`{ "path": "./lib/integrations-openai-ai-server" }` to root refs makes the whole repo typecheck 0-error.

**How to apply:** When a `tsc -p <artifact>` run reports TS6305 for a `@workspace/*` lib right after a
clean `typecheck:libs`, the fix is usually to add that lib to root `tsconfig.json` references — NOT to
rebuild dist manually. Verify by nuking all non-node_modules `*.tsbuildinfo` + `lib/*/dist` and running
`pnpm run typecheck` once; a partial/incremental build gives false cascades (100+ phantom errors) that
a clean single run collapses to the real one.
