---
name: React Query invalidation must match generated /api-prefixed keys
description: Why hardcoded queryClient.invalidateQueries prefixes silently fail to refresh lists, making tools look broken.
---

# Query-key invalidation prefix must match the generated keys

The orval-generated query-key helpers return keys prefixed with **`/api`**, e.g.
`getListGlossaryEntriesQueryKey()` → `["/api/glossary", params]`,
`getGetResourceOverviewQueryKey()` → `["/api/resources/overview"]`.

**Rule:** any manual `queryClient.invalidateQueries({ queryKey: [...] })` must use the
same `/api`-prefixed path (or better, spread the generated helper). Invalidating a
bare path like `["/glossary"]` or `["/resources/overview"]` prefix-matches **nothing**.

**Why:** React Query `invalidateQueries` does prefix matching. A wrong prefix throws
no error — it just silently matches zero queries, so after a successful create/edit/
delete the list never refetches. The mutation succeeds server-side but the UI shows
no change, which reads to users as **"the button is broken"** (compounded when toast
feedback is also missing). This exact bug hid a working POST /api/glossary behind a
dead invalidate.

**How to apply:** When wiring a mutation's post-success invalidation, prefer
`queryClient.invalidateQueries({ queryKey: getListXQueryKey() })` from the generated
client, or if hardcoding the string, include the `/api` prefix. When a
"save/add/update doesn't work" bug appears but the network POST returns 2xx, suspect
an invalidation prefix mismatch before touching the mutation or server.
