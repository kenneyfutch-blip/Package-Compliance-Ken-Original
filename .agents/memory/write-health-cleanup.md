---
name: Write-health row cleanup
description: Why the ai_usage_write_health table needs periodic pruning and the safety constraint on the delete threshold.
---

# Fleet write-health row cleanup

Each API process uses a fresh per-process instance id, so every restart/redeploy
strands one row in `ai_usage_write_health`. The fleet aggregator already ignores
stale rows via a short freshness window, so this is unbounded growth, not a
correctness bug. Cleanup is folded into the existing daily maintenance pass
(`runMaintenance`), which deletes rows whose heartbeat is far older than the
aggregate freshness window.

**Why the delete threshold must be FAR larger than the aggregate freshness window:**
the aggregate's freshness window only governs which rows count toward the live
signal; the delete threshold governs which rows are physically removed. Keep the
delete threshold at least orders of magnitude larger (a full day vs. ~90s) so
cleanup can never race a briefly-paused-but-still-alive instance — a row that old
belongs to a process that has been gone for a day and is already excluded from
the aggregate.

**How to apply:** the prune, like every part of the health plumbing, must be
non-fatal (swallow errors, log at debug, return 0). A failing prune — e.g. the
table missing pre-migration — must never fail the whole maintenance pass.
