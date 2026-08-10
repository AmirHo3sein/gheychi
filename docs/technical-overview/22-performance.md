# 22 — Performance & Scalability

This document consolidates every self-declared or observed scaling limit in the codebase. None of these are urgent at current traffic; all are worth knowing about before the platform grows meaningfully.

## Search pagination re-fetches, rather than seeks, on every page

`SearchService.search()` is now cursor-paginated (`{items, nextCursor, hasMore}`, 50/page default, 1000-row `MAX_FETCH_ROWS` ceiling — see [23-known-limitations.md](./23-known-limitations.md)), not the old flat `LIMIT 50` with no continuation. The pagination mechanism itself has a real cost, though: because the featured-boost re-ranking (`FEATURED_CAP`) has to run over the *whole* fetched set to stay correct, each page request re-fetches every row from page 1 through the requested page (`page * pageSize`, capped at `MAX_FETCH_ROWS`) and re-derives the full order from scratch, rather than seeking directly to an offset. Fine at today's per-radius row counts (bounded by the 1000-row ceiling either way), but page *N* is genuinely *N* times the query cost of page 1, not constant — worth knowing before assuming "paginated" means "cheap at any page depth."

## Availability computation loads the full booking set into memory

`AvailabilityService.computeFor` fetches **every** overlapping booking for the entire 14-day window and filters/aggregates in application code (`computeAvailableSlots`) rather than pushing the capacity/overlap check into SQL. Fine at current per-salon booking volumes; a plausible cliff for a very high-capacity, high-volume salon. See [10-scheduling.md](./10-scheduling.md).

## Monthly invoice generation groups in application memory

`MonthlyInvoiceGenerationJob` buckets unlinked `financial_transactions` rows by Jalali month **in JavaScript**, not SQL — justified by "no native Jalali calendar function in Postgres, and the table is small enough this is simpler than a stored procedure." A latent risk if the unlinked-transaction backlog ever grows large (e.g. after an extended outage of the job itself). See [14-commission.md](./14-commission.md).

## `Redis` distributed lock has a fixed, short TTL

`lock:booking:{salonId}` uses a hardcoded `LOCK_TTL_MS = 5000`, not config-driven, with **no lock-extension/heartbeat mechanism**. A `createHold` transaction (coupon validation, wallet debit, multiple inserts) that takes longer than 5 seconds under real load would let a second concurrent request acquire the lock while the first is still inside its critical section — undermining the "double-booking is impossible" guarantee the lock exists to provide. See [09-booking-engine.md](./09-booking-engine.md).

## N+1 map-coordinate fetch on the search page

`user-app`'s `index.vue` issues one `GET /salons/:slug` request **per visible search result** to backfill map coordinates for the map view — explicitly self-acknowledged in code as an "accepted tradeoff at today's scale... revisit if result-set sizes grow."

## No pagination on two sitemap sources

`GET /sitemap/salon-slugs` and `GET /sitemap/blog-posts` are both fetch-all, capped only at a hardcoded 50,000-row safety ceiling (Google's single-sitemap-file limit) — a real sitemap-index (multi-file) replacement is flagged as needed before the platform approaches that many rows in either domain.

## Database indexing

Every hot-path query reviewed during this audit has a supporting index: `salons_location_gist` (PostGIS GIST, backs `ST_DWithin`), `bookings (salon_id, starts_at, ends_at)` + `(user_id)` + `(status)`, `reviews_salon_status_idx`, `admin_notifications_unread_idx` (partial), `worker_services_service_idx`, `salon_categories(category_id)`, etc. — see [04-database.md](./04-database.md) for the full migration-by-migration list. No missing-index issue was identified during this audit.

## Horizontal scaling considerations

- Every cron job (`@nestjs/schedule`) now runs through `CronJobRunner`/`CronLockService` (`common/cron-job-runner.service.ts`, `common/cron-lock.service.ts`), which wraps each tick in the same `SET NX PX` Redis primitive the booking-hold lock uses (`cron-lock:{jobName}`, self-healing TTL, no queuing/retry — a losing instance just skips that tick). Running more than one API instance no longer risks every instance running every cron job redundantly; this was the one horizontal-scaling gap flagged in an earlier pass and it's now closed.
- The booking-hold Redis lock is correctly cluster-safe as written (a shared Redis instance), so horizontal API scaling does not break booking correctness on its own either. With the cron-duplication concern above also closed, nothing self-declared in the codebase currently blocks running more than one API instance.

## Related documents

- [09-booking-engine.md](./09-booking-engine.md), [10-scheduling.md](./10-scheduling.md), [14-commission.md](./14-commission.md), [18-background-jobs.md](./18-background-jobs.md) — the subsystems each limit above belongs to
- [24-technical-debt.md](./24-technical-debt.md) — the non-performance-related debt findings
