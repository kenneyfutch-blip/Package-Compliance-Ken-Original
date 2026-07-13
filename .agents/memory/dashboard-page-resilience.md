---
name: Multi-widget page loading resilience
description: Why analytics/dashboard pages must not gate all content behind one combined isLoading flag.
---

# Multi-widget page loading resilience

A page that fires N independent react-query hooks must NOT gate its whole body
behind `isLoading = a || b || c || ...`. Give each card/section its own
per-query loading + empty state instead.

**Why:** the Usage & Analytics page (`admin/usage-analytics.tsx`) OR'd six
dashboard queries into one gate. When a single query stalled (a transient
multi-second slow request — a dashboard aggregate that occasionally contends on
the connection pool, not a data-volume problem; the data is tiny), the entire
page showed one spinner forever with no partial render and no error recovery.
User reported it as "stuck loading / not working."

**How to apply:** order each card's branches loading → has-data → empty (so it
never flashes "no data" mid-fetch). Backend aggregates were already fast in
isolation, so don't chase a query-tuning fix for a "stuck page" — first check
whether one hook is freezing the shared gate. Optional future add: per-card
`isError` messaging.
