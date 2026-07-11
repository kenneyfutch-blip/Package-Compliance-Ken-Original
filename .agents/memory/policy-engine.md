---
name: Internal Policy & Standards Engine
description: Company-authored policies that act as first-class compliance rules alongside FDA/EPA/eCFR; recall, versioning, and non-obvious decisions.
---

# Internal Policy & Standards Engine

Compliance managers/admins author org-specific standards ("internal policies") that
participate in every package review with **equal authority to government regs**,
producing violations under the engine string **"Internal Standard"** (regulationRef =
the policy's `source`/name). Backend routes live behind `policies:read` / `policies:write`.

## Non-obvious decisions
- **Authored rule text is authoritative, document is optional.** The human-written
  `summary` field is what the AI reasons over. A policy with no parseable file still
  works. `extractedText` (from an uploaded doc) is only extra search/context.
  **Why:** DOCX/PPTX OCR was deferred; a policy must never be dead weight without a file.
- **Recall reuses the existing hashed lexical embedder** (`lib/memory/embedding.ts`,
  EMBED_DIM=512), not an external embeddings provider. Policy recall mirrors the
  compliance-memory pgvector pattern and is **non-fatal** — a recall miss must never
  break package analysis (see `relevantPoliciesFor` in packages.ts, org-scoped).
- **Document ingestion trusts client-supplied `documentUrl`** validated only by the
  `/objects/` prefix, exactly like package `artworkUrl`. This matches the platform's
  documented "presigned uploads, no per-object ACL, by design" stance for this
  single-org, domain-gated app. Do NOT add per-object ACL here unless the whole app
  adopts it — diverging would be inconsistent.

## Version publishing must be concurrency-safe
Publishing a version snapshots the current policy row into `policy_versions` then bumps
`policies.version`. This is done inside one transaction that **re-reads the policy row
`.for("update")`** so concurrent publishes serialize. Backstopped by a unique index
`(organization_id, policy_id, version)`.
**Why:** reading `version` outside the txn and writing `version+1` inside races — two
publishes could snapshot the same version and set the same next number.
**How to apply:** any future "snapshot then increment" flow needs the row lock + unique
constraint, not just a plain transaction.

## Index creation race (fixed)
`ensurePolicyIndexes()` (HNSW `CREATE INDEX IF NOT EXISTS`) must be called from exactly
ONE place (server startup in index.ts). Calling it also at route-module load raced the
startup call and threw `duplicate key ... pg_class_relname_nsp_index` — `IF NOT EXISTS`
does not protect against two concurrent creates.
