---
name: Review Assignment & Workload Engine
description: Auto-assignment, SLA/escalation, and the durable Postgres job queue for the Packaging Compliance AI app.
---

# Review Assignment & Workload Engine

Backend engine that routes packages to review teams, load-balances onto members,
tracks SLA/workload, escalates overdue critical reviews, and runs recurring work
via a durable queue. Consumed by the (separate) Operations Console task.

## Durable job queue = the `jobs` table
**Rule:** background/recurring work runs through the Postgres-backed `jobs` queue,
not `setInterval` business logic. A single in-process poller claims due rows with
`FOR UPDATE SKIP LOCKED`, runs a handler registered by `type`, retries with
exponential backoff up to `maxAttempts`, and requeues stale "running" rows on
restart.
**Why:** survives restarts/crashes without losing or double-running work; reusable
for any future async job.
**How to apply:** register a handler + start the worker at server bootstrap. For a
*recurring* job, the handler must reschedule its own next run — but with
`ensurePendingJob` (pending-only dedupe), NOT `enqueueJob`, or a crash + stale
requeue replay stacks duplicate future jobs. Use `ensureScheduledJob` (pending OR
running) only at startup.

## Escalation must be atomic + monotonic
**Rule:** the escalation sweep raises `escalationLevel` (0 none → 1 manager@24h →
2 director@48h → 3 leadership@72h) with the guard `escalationLevel < targetTier`
inside the UPDATE WHERE, and only emits the notification + history row when that
UPDATE actually affects a row (check `.returning()`).
**Why:** tier eligibility computed before the txn is racy; without the in-UPDATE
guard a duplicate/replayed sweep double-notifies the same tier.
**How to apply:** clock runs from `assignedAt` (member-assigned reviews only);
team-only/unassigned rows are intentionally excluded. Notifications are org-scoped
(no per-user targeting — that belongs to the notifications/mentions task); the tier
is conveyed in the notification title.

## Assignment state machine
**Rule:** one active `review_assignments` row per package (unique `packageId`);
reassignment mutates in place. Reassigning to a *different* member restarts the SLA
clock (`assignedAt`/`dueAt`) and resets `escalationLevel`/`lastEscalatedAt` to 0.
Completion (`completeReview`) is triggered by a human decision (package status →
Approved / Needs Revision) and captures a `review_metrics` row for reporting.
**Why:** the new owner deserves a fresh window; metrics must be snapshotted at
completion because package/violation state keeps changing afterward.
**How to apply:** mutation reads (assign/complete) select the row `FOR UPDATE` and
include an `organizationId` predicate (defense-in-depth tenant scoping), even
though routes already scope by package access.

## Per-user notifications fire AFTER the assignment txn commits
**Rule:** assignment-change notifications are emitted after the assignment
transaction commits, never inside it, and the acting user is excluded from
recipients. A notification row's `userId` being null means org-wide (backward
compatible); listing returns org-wide OR the current user's rows.
**Why:** a notification failure must never roll back the assignment it describes.
**How to apply:** escalation notifications are the exception — emitted inside the
escalation txn (assignee/manager already loaded), org-wide fallback when unset.

## "Approval required" = manager notification on the escalate decision
**Rule:** there is no explicit approval-workflow entity, so "approval required" is
interpreted as: a proofing *escalate* decision notifies the review's responsible
manager (fallback assignee). Only the single-decision path has an escalate option —
the bulk action path supports approve/reject/assign/rescan only, so there is no bulk
escalate to reach parity with.
**Why:** escalation is the only point where manager sign-off is implied.

## Category → team routing
Keyword rules (case-insensitive) map a package category to a seeded team *name*,
resolved to a team row per org. Unmatched categories produce a team-less
assignment flagged for manual triage (no crash).

## RBAC reuse (no reseed)
Reads gated `packages:read`, mutations `packages:write`, metrics/reporting
`reports:read`. **Deliberately reused existing permission keys** so no permission
reseed is needed. Do not invent new keys for this surface.
