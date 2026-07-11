---
name: Compliance Memory & Scalability
description: Semantic finding-recall engine + push-safe audit archiving/retention for the Packaging Compliance AI.
---

# Compliance Memory & Scalability

## Embeddings are self-contained by necessity
No external embeddings are available in this environment: the managed OpenAI proxy
rejects `/embeddings` (INVALID_ENDPOINT), the Gemini proxy lists embeddings
unsupported, and local transformers.js is blocked by the package firewall
(protobufjs critical-CVE 403). So the embedder is a **deterministic, dependency-free
hashed bag-of-words** (512-dim, unigrams+bigrams, signed FNV-1a, L2-normalized) in
`lib/memory/embedding.ts`. Stored in a pgvector `vector(512)` column with an HNSW
`vector_cosine_ops` index created at startup.
**Why:** it must run offline and never block a review.
**How to apply:** if a real embeddings provider becomes available, swap `embed()`
and re-embed existing rows; keep the same dim or rebuild the column + index.

## Memory capture/recall is non-fatal and tenant+supplier scoped
Capture (on Approved / Needs Revision review decisions) and recall (injected into
the AI analysis prompt, and the `/compliance-memory` search endpoint) are wrapped
in try/catch and must never block package create/analyze/review.
Recall is always `organization_id`-scoped. **Supplier isolation:** when the caller
is `supplier_user`, recall MUST also filter `vendor = supplierName` — both in the
search endpoint and in the AI-review recall path (`priorKnowledgeFor` derives this
from the request auth context). Without it, one supplier can read another's
approved findings via semantic search, which is a cross-tenant leak.
**Why:** a code review caught exactly this leak (endpoint used `packages:read`,
which suppliers hold, but retrieval was only org-scoped).

## Push-safe partitioning lives in a separate `archive` schema
Native range partitioning of `public.audit_events` is **forbidden**: the deploy
pipeline runs `drizzle-kit push`, which introspects only `public` and will try to
DROP any child partition it doesn't manage (and refuses in non-TTY, breaking
deploy). So cold audit rows roll into a **yearly RANGE-partitioned
`archive.audit_events`** in a dedicated `archive` schema that drizzle never sees.
Hot recent rows stay in `public.audit_events` (drizzle-managed, indexed).
Retention = `DROP TABLE archive.audit_events_<year>` beyond the horizon.
The per-package audit endpoint **unions hot + archive** so full history stays
queryable. Orphaned violations are pruned as a safety net.
**Why:** keeps deploy working while supporting 5+ years of history and fast reads.
**How to apply:** never move partitioning into `public`; verify `db push` still
succeeds after any archive change.

## Audit immutability has a governed-delete bypass
`audit_events` has a BEFORE UPDATE/DELETE trigger that rejects all mutations. The
archival routine is the only exception: it runs `SET LOCAL app.audit_archival='on'`
inside its own transaction, and the trigger permits DELETE only when that GUC is
set (UPDATEs stay forbidden always). Bypass is transaction-local.

## drizzle `sql` template collapses `$$` → `$`
Dollar-quoted function bodies written as `$$ ... $$` inside a drizzle `sql`
template (and via the edit tooling) get mangled to a single `$`, producing
`syntax error at or near "$"`. Use a **named tag** like `$fn$ ... $fn$` instead —
no doubled `$` to collapse.

## Dashboard aggregations are SQL, and semantics must match the old JS
Dashboard endpoints were rewritten from load-all-rows-then-reduce-in-JS to SQL
`GROUP BY`/`FILTER`. Watch parity traps: trends `avgRisk` must treat NULL risk as
0 and divide by the day's **total** package count
(`sum(coalesce(risk,0)) / count(*)`), not SQL `avg()` which drops NULLs.
