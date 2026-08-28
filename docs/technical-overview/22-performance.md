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

The lock's *release* is now ownership-aware (`acquireSalonLock`/`releaseSalonLock` in `bookings.service.ts`): each acquisition sets a random per-call token as the lock's value, and release deletes it only if that exact token is still current, via one atomic Lua `EVAL` (a GET-then-DEL from application code would reopen the identical race one level up). This closes a real compounding failure mode the fixed-TTL risk above used to create: a caller whose critical section outran the TTL would previously `DEL` unconditionally in its `finally`, which — if a second caller had legitimately re-acquired the now-expired key in the meantime — deleted that second caller's *live* lock, letting a third caller in while the second was still mid-transaction. The underlying TTL-race this section describes (a slow critical section losing its lock outright) is unchanged; only the "wrong lock gets deleted" pileup on top of it is fixed.

Real concurrent-request e2e tests (`Promise.all`-driven, against real Postgres/Redis, not mocked) now cover this lock plus three other money-critical races: two customers racing the same salon-capacity slot, two customers racing the same worker at `createHold` time, one coupon redeemed twice by the same user across two different salons (isolating the DB unique constraint from the per-salon lock), a wallet debit racing another debit past the balance cap, and a duplicate Zarinpal callback for one authority arriving twice. Every mechanism (lock, DB unique constraint, `SELECT FOR UPDATE`, CAS `UPDATE`) held under real concurrency; no gap found beyond the missing tests themselves.

## Load testing exists but has never been run against a real instance

`load-tests/` (k6 scripts, not part of the pnpm workspace, not wired into CI): `search.js`, `availability.js`, `booking-burst.js` (deliberately fires concurrent identical booking attempts — a high 409 rate under that script is the expected, correct outcome, not a failure). Baselines only, on purpose: no `thresholds` are defined anywhere in them, since inventing a pass/fail target before a real baseline exists would just bake in a guess. An operator runs these on demand against a real instance and decides thresholds from the actual numbers.

## N+1 map-coordinate fetch on the search page

`user-app`'s `index.vue` issues one `GET /salons/:slug` request **per visible search result** to backfill map coordinates for the map view — explicitly self-acknowledged in code as an "accepted tradeoff at today's scale... revisit if result-set sizes grow."

## Database indexing

Every hot-path query reviewed during this audit has a supporting index: `salons_location_gist` (PostGIS GIST, backs `ST_DWithin`), `bookings (salon_id, starts_at, ends_at)` + `(user_id)` + `(status)`, `reviews_salon_status_idx`, `admin_notifications_unread_idx` (partial), `worker_services_service_idx`, `salon_categories(category_id)`, etc. — see [04-database.md](./04-database.md) for the full migration-by-migration list. No missing-index issue was identified during this audit.

## Horizontal scaling considerations

- Every cron job (`@nestjs/schedule`) now runs through `CronJobRunner`/`CronLockService` (`common/cron-job-runner.service.ts`, `common/cron-lock.service.ts`), which wraps each tick in the same `SET NX PX` Redis primitive the booking-hold lock uses (`cron-lock:{jobName}`, self-healing TTL, no queuing/retry — a losing instance just skips that tick). Running more than one API instance no longer risks every instance running every cron job redundantly; this was the one horizontal-scaling gap flagged in an earlier pass and it's now closed.
- The booking-hold Redis lock is correctly cluster-safe as written (a shared Redis instance), so horizontal API scaling does not break booking correctness on its own either. With the cron-duplication concern above also closed, nothing self-declared in the codebase currently blocks running more than one API instance.

## Related documents

- [09-booking-engine.md](./09-booking-engine.md), [10-scheduling.md](./10-scheduling.md), [14-commission.md](./14-commission.md), [18-background-jobs.md](./18-background-jobs.md) — the subsystems each limit above belongs to
- [24-technical-debt.md](./24-technical-debt.md) — the non-performance-related debt findings

## Booking approval workflow

- Both expiry crons run every minute and batch 1000 rows/tick via the
  `id IN (SELECT ... ORDER BY ... LIMIT n)` idiom — never a full-table scan, never all rows in memory.
- Each is backed by a **partial** index scoped to the single status it scans
  (`bookings_approval_expiry_idx WHERE status = 'pending_approval'`,
  `bookings_payment_expiry_idx WHERE status = 'pending_payment'`). Indexing the whole table would
  be mostly dead weight: every terminal booking — the vast majority, forever — can never match.
- Notifications are sent **after** the transaction commits, one `try/catch` per booking, so a
  slow or failing SMS gateway holds no DB locks and cannot stall the batch.
- `BookingSettingsService` resolves timeouts from the Redis-cached `platform_config` (60s TTL)
  and is called once per booking creation, outside the per-salon Redis lock.
