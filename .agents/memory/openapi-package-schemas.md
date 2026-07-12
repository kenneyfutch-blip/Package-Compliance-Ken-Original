---
name: openapi.yaml Package vs PackageDetail duplicate field lists
description: Adding a package field to the API requires editing BOTH schemas; they duplicate properties rather than share them.
---

# Adding a package field: update BOTH Package AND PackageDetail

`lib/api-spec/openapi.yaml` is hand-authored. The `Package` schema (list rows) and
the `PackageDetail` schema (single-package detail) each declare their **own full
property list** — they do NOT share via `$ref`/`allOf`. The frontend list views use
the generated `Package` type; `review-workspace.tsx` and other detail views use
`PackageDetail`.

**Rule:** when adding a package field end-to-end, add the property to **both**
`Package` and `PackageDetail` in openapi.yaml, then regenerate.

**Why:** adding it to only `Package` compiles for list views but fails the compliance
`tsc -b` with "Property 'X' does not exist on type 'PackageDetail'" the moment a detail
page references it. Cost me a wasted codegen+typecheck cycle.

**How to apply:** full chain for a new package field is: Drizzle schema
(`lib/db/src/schema/packages.ts`) → persist in `packageService.applyAnalysis` (and any
producer) → `mappers.ts` `mapPackage` (explicit field list, not a spread) → openapi.yaml
**Package + PackageDetail** → `pnpm --filter @workspace/api-spec run codegen` → render →
`pnpm --filter @workspace/db run push` (nullable ADD COLUMN is safe; still check row
counts per the schema-push-data-loss note). The generated client is the only place the
frontend sees the field, so codegen is mandatory, not optional.
