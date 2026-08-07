# 22 — Performance & Scalability

This document consolidates every self-declared or observed scaling limit in the codebase. None of these are urgent at current traffic; all are worth knowing about before the platform grows meaningfully.

## Search has no pagination

`SearchService.search()` — hard `LIMIT 50`, explicitly commented as an "MVP cap, no pagination yet. Revisit if a single search radius can plausibly exceed 50 approved salons." In a dense city with a small radius, results silently truncate with no `hasMore`/cursor for the client to continue from. See [10-scheduling.md](./10-scheduling.md)... actually see the salons/search domain in [20-business-rules.md](./20-business-rules.md).

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

## Duplicate SQL for worker eligibility

The exact same "opt-out" worker-eligibility predicate (`NOT EXISTS(worker_services) OR EXISTS(worker_services WHERE service_id=...)`) is hand-written independently in `BookingsService.createHold`, `AvailabilityService.computeFor`, and `PublicSalonContentController.listWorkers` — not a performance issue per se, but a maintenance-cost multiplier that makes future rule changes error-prone across three call sites. See [09-booking-engine.md](./09-booking-engine.md) and [24-technical-debt.md](./24-technical-debt.md).

## Storage cleanup has no reconciliation pass (except stories)

Salon photos and portfolio items have **no GC/reconciliation job** for orphaned storage objects left behind by a failed best-effort delete — only the stories domain has this, because it already needed an hourly cron for TTL expiry. Over a long platform lifetime this accumulates orphaned S3/disk objects with real (if small) storage cost and zero automated cleanup.

## Database indexing

Every hot-path query reviewed during this audit has a supporting index: `salons_location_gist` (PostGIS GIST, backs `ST_DWithin`), `bookings (salon_id, starts_at, ends_at)` + `(user_id)` + `(status)`, `reviews_salon_status_idx`, `admin_notifications_unread_idx` (partial), `worker_services_service_idx`, `salon_categories(category_id)`, etc. — see [04-database.md](./04-database.md) for the full migration-by-migration list. No missing-index issue was identified during this audit.

## Horizontal scaling considerations

- The API is a single NestJS process reading `@nestjs/schedule` cron jobs **in-process** — running more than one API instance in production would need an external scheduler lock (e.g. a Redis-based leader-election) to avoid every instance running every cron job redundantly. **No such mechanism currently exists** — this is worth flagging before ever scaling the API horizontally.
- The booking-hold Redis lock is correctly cluster-safe as written (a shared Redis instance), so horizontal API scaling would not break booking correctness on its own — only the cron-duplication concern above.

## Related documents

- [09-booking-engine.md](./09-booking-engine.md), [10-scheduling.md](./10-scheduling.md), [14-commission.md](./14-commission.md), [18-background-jobs.md](./18-background-jobs.md) — the subsystems each limit above belongs to
- [24-technical-debt.md](./24-technical-debt.md) — the non-performance-related debt findings
