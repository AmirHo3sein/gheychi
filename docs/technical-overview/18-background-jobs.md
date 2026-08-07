# 18 — Background Jobs

Every scheduled job is a `@Injectable()` class registered as a provider in its owning module, with a thin `@Cron()`-decorated `handleCron()` delegating to a plain `async run()` method (kept independently unit-testable). Powered by `@nestjs/schedule`'s `ScheduleModule.forRoot()` (registered once, globally, in `AppModule`).

`handleCron()` never calls `run()` directly — it goes through `CronJobRunner.run(jobName, fn, {lockTtlMs?, warnAfterMs?})` (`common/cron-job-runner.service.ts`, `@Global()` via `CommonModule`), which wraps every run in `CronLockService`'s distributed Redis lock (`SET NX PX` / `DEL`, so no two instances run the same job concurrently), pages `AlertsService` on an uncaught failure, and raises a non-cancelling "still running past `warnAfterMs`" warning (it does NOT abandon or cancel the job — that's deliberate, to avoid opening a duplicate-execution window).

## Consolidated cron table

| Job | File | Schedule | Purpose |
|---|---|---|---|
| Booking expiry | `booking/booking-expiry.job.ts` | `*/1 * * * *` (every minute) | Expires `pending_payment` bookings past their hold TTL (`booking_hold_ttl_minutes`, seeded 15); releases any consumed coupon/wallet balance atomically |
| Payment reconciliation | `booking/payment-reconciliation.job.ts` | `*/5 * * * *` | Re-verifies `initiated` payments older than 20 minutes against every authority ever issued; confirms, fails, or queues a late-capture refund + alert |
| Booking reminder | `booking/booking-reminder.job.ts` | `*/5 * * * *` | SMS + push appointment reminders for `confirmed` bookings inside the configured lead window (`reminder_lead_hours`, seeded 3); claims each row via a guarded conditional UPDATE to avoid double-sending |
| Refund retry | `booking/refund-retry.job.ts` | `*/5 * * * *` | Retries `refund_pending` payments (2-min grace period first); pages a critical/daily-dedup alert once stuck past 24h |
| Referral grant sweep | `booking/referral-grant.job.ts` | `0 * * * *` (hourly) | Sweeps referrals awaiting a `first_paid_booking` qualifying event past their holdback window; retries `partially_granted` referrals |
| Referral expiry | `booking/referral-expiry.job.ts` | `0 * * * *` (hourly) | Flips `awaiting_qualifying_event`/`partially_granted` referrals past their `expires_at` to `expired`; batched 500/run |
| Story cleanup (GC) | `salons/story-cleanup.job.ts` | `0 * * * *` (hourly) | Deletes expired salon Stories: storage object first, then DB row (self-healing on partial failure); skips stories pinned by an open report; 1h grace past `expires_at`; batched 200/run |
| Storage reconciliation | `storage/storage-reconciliation.job.ts` | `0 * * * *` (hourly) | Two independent passes: logs (never auto-deletes) a DB row whose storage object 404s; deletes an orphaned storage object under a known prefix with no DB row, past a 24h grace period. Existence checks batched 2000/run, 20-way concurrent (not fully serial); deletes batched 500/run |
| Monthly invoice generation | `invoicing/monthly-invoice-generation.job.ts` | `0 3 * * *` (daily, 03:00) | Rolls up unlinked `financial_transactions` into per-(salon, closed Jalali month) `Invoice` rows; idempotent via unique constraints + `ON CONFLICT`; a per-salon failure now also pages `AlertsService` (warning), not just a log line |

All nine follow the same reliability idiom: **per-item `try/catch` isolation** (one bad row never blocks the rest of a batch), `CronJobRunner`'s lock/warn/page wrapper described above, and, for the money-adjacent ones, additional `AlertsService` integration on genuine failure/escalation conditions beyond a bare job crash.

## Notable design decisions

- **`referral-grant.job.ts` physically lives under `src/booking/`, not `src/referrals/`** — worth remembering when searching for it.
- **The 15-minute hold TTL and 20-minute reconciliation threshold are a deliberately-coupled pair** — the reconciliation window is intentionally longer so a genuinely-late-but-successful payment commonly finds its booking already expired, which is handled (payment still ends up paid/refunded correctly) rather than a bug. Do not change either number without re-checking the relationship. See [11-payment-system.md](./11-payment-system.md).
- **Story cleanup deletes storage before the DB row** — the inverse of the interactive delete path (DB row first, storage best-effort after) — because in this job the DB row *is* the retry-tracking record; a storage failure leaves the row in place so the next hourly run retries it, rather than orphaning the object with nothing left to retry from.
- **Monthly invoicing runs daily, not monthly** — so a late-completing booking or a skipped run is swept the very next day rather than waiting up to a month.

## Redis usage (locks, rate limits, dedup)

Redis is used for short-lived coordination primitives, never as a queue of record or durable state.

| Key pattern | Purpose | TTL |
|---|---|---|
| `otp:{phone}` | current OTP code | 120s |
| `otp:rl:{phone}` | OTP request rate limit (max 3) | 3600s |
| `otp:att:{phone}` | OTP verify-attempt counter (max 5) | 120s |
| `lock:booking:{salonId}` | distributed mutex around the booking-hold critical section | 5000ms (`SET NX PX`), explicit `DEL` on release |
| `cron-lock:{jobName}` | `CronJobRunner`/`CronLockService`'s per-job mutex (see above) — a second instance's overlapping tick 409s out (no-ops) rather than double-running | 60s default (`SET NX PX`), per-job override (e.g. storage reconciliation: 10min), explicit `DEL` on release |
| `referral:validate:rl:{ip}` | rate-limits the public `GET /referrals/validate` code-enumeration surface (max 20) | 3600s |
| `alert:dedup:{alertKey}` | one alert per condition per window | default 6h, up to 24h for some |
| `alert:sms-count:{hourBucket}` | hourly SMS-paging circuit breaker (default cap 30) | 3600s |

Full detail on the alert keys: [16-notifications.md](./16-notifications.md). In production, Redis has **no persistence volume** configured (`docker-compose.prod.yml`) — acceptable given its only durable-ish use is dedup/rate-limit state, whose worst-case failure mode on restart is re-paging some already-acknowledged incidents or briefly relaxing a rate limit.

## Related documents

- [09-booking-engine.md](./09-booking-engine.md), [11-payment-system.md](./11-payment-system.md), [13-financial-system.md](./13-financial-system.md), [14-commission.md](./14-commission.md) — each job's owning subsystem, with full business-rule context
- [22-performance.md](./22-performance.md) — batch sizing and scaling notes for the heavier jobs
