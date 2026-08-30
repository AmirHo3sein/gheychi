# 20 — Business Rules

A consolidated reference of every enforced business rule in the platform, grouped by domain, each with the exact file/mechanism that enforces it. Where a rule is admin-tunable at runtime (via `platform_config`), that's called out explicitly — everything else is a hardcoded constant that requires a code change.

## Platform-tunable constants (`platform_config` table)

| Key | Seeded value | Consumed by |
|---|---|---|
| `deposit_percent` | 20 | `calculateDeposit()` — [11-payment-system.md](./11-payment-system.md) |
| `deposit_min_toman` | 200,000 | same |
| `cancellation_window_hours` | 24 | `BookingsService.cancel()` — [09-booking-engine.md](./09-booking-engine.md) |
| `commission_percent` | 10 | `InvoicingService.recordCommission()` — [14-commission.md](./14-commission.md) |
| `booking_hold_ttl_minutes` | 15 | `BookingExpiryJob`, and the global default payment window for manual approval — [18](./18-background-jobs.md), [28](./28-booking-approval-workflow.md) |
| `booking_approval_timeout_minutes` | 10 | `BookingApprovalExpiryJob` — [28-booking-approval-workflow.md](./28-booking-approval-workflow.md) |
| `reminder_lead_hours` | 3 | `BookingReminderJob` |
| `review_edit_window_hours` | 72 | `ReviewsService.assertWithinEditWindow()` |

`PlatformConfigService`'s numeric getter **throws a raw, unguarded `Error`** (not a NestJS exception) if a key is ever missing — a deleted config row would 500 every request path that needs it, with no schema validation to catch this earlier. See [24-technical-debt.md](./24-technical-debt.md).

## Booking rules

- A booking hold locks the whole salon (Redis, per-salon key, 5s TTL) for the duration of its create transaction — never a per-slot lock, because different-duration services can overlap without sharing a `startsAt`.
- Salon capacity and worker availability are checked **independently** — a worker is never "just one more unit of capacity."
- A worker with **zero** `worker_services` rows is eligible for every service; a worker with rows is restricted to exactly those (opt-out-by-default design, chosen so introducing the feature changed nothing for any pre-existing worker).
- `startsAt` must be strictly in the future.
- A zero-deposit booking (100%-discount or fully wallet-covered) is confirmed immediately with no `Payment` row — **unless** the salon runs manual approval, in which case it still becomes a request first.
- A salon may require **manual approval** (`salons.booking_confirmation_mode`, owner-selectable). In that mode a booking is created as `pending_approval` with **no `Payment` row and no gateway session**, so declining or expiring it can never owe a refund. The owner controls the mode and nothing else: both timeout values are admin-only, globally and per salon. See [28-booking-approval-workflow.md](./28-booking-approval-workflow.md).
- The payment-window-expired notification is sent for **manual-approval bookings only** — an abandoned automatic checkout is deliberately never texted (SMS budget).
- A customer is not texted merely for submitting a request (they are on the screen); the salon owner is, because the approval window is short and they are not.
- A `pending_approval` request blocks its slot exactly as a paid booking does (`SLOT_BLOCKING_STATUSES`) — otherwise a salon could approve a request it has no room for.
- `approve()` re-checks capacity and (when a specific worker was requested) worker availability before opening the payment window — a correctness requirement, not an optimization, since platform state can change between request and decision. A failed re-check auto-expires the request on the spot (never left pending for the same unavoidable cron-tick outcome) and is recorded distinctly from a genuine timeout.
- No provider-side reminder SMS fires before the 10-minute approval deadline — a permanent SMS-budget decision, not a gap.
- A request whose appointment time has already passed can no longer be approved — its approval deadline is independent of the booking's own `startsAt`, so a request can outlive the slot it asked for.
- A salon owner cannot decline a `pending_approval` request through the customer cancel route; they must use `reject()`, which requires a reason.
- `retry-payment` refuses once the booking's payment deadline has passed, even before the expiry cron has caught up.
- Online payment collection is gated by a global admin flag (`feature_online_payment_enabled`, seeded off). With it off, every deposit-owing booking (automatic-mode `createHold`, or manual-approval `approve()`) rides the same zero-deposit path a 100%-discounted booking already used — confirmed outright, no `Payment` row, deposit still recorded for reporting but never collected online. Wallet credit is never debited toward a deposit that won't be collected. See [29-global-payment-toggle.md](./29-global-payment-toggle.md).
- Booking deadlines (`approval_expires_at`, `payment_expires_at`) are **snapshotted onto the row** when the clock starts, never recomputed from live config, so a later admin config change cannot move a deadline someone is already counting on.
- Cancellation refunds unconditionally if the *salon* cancels; refunds for a *customer* cancellation only if `(startsAt - now) >= cancellation_window_hours`.
- A booking can only be marked `completed`/`no_show` from `confirmed`, and only by the salon owner.
- Every state transition uses a conditional CAS `UPDATE ... WHERE status = <expected>` — a lost race always produces a 409, never a silent double-apply. This idiom recurs across the codebase (salon resubmit, coupon/content moderation, blog publish/unpublish, report resolve) and should be treated as the house style for any new state-transition code. A booking-creation 409 now also carries a stable `BOOKING_UNAVAILABLE`/`WORKER_UNAVAILABLE` code (`booking-error-codes.ts`) alongside the status — see [15-api-reference.md](./15-api-reference.md).

## Availability rules

- 14-day rolling window (`AVAILABILITY_WINDOW_DAYS`).
- Slots are a fixed grid at exact multiples of the service's duration, starting at each working-hour range's open time — never staggered.
- Iran is treated as a fixed UTC+3:30 offset year-round (no DST since 2022) — see [10-scheduling.md](./10-scheduling.md) for the full wall-clock↔instant conversion algorithm.
- A `schedule_exceptions` row with `isClosed=true` blacks out that entire calendar date.
- A worker ineligible for the requested service returns zero availability outright, rather than slots that would fail at booking time.

## Discount & coupon rules

- A salon service's own `discountPercent` and an applied coupon's discount (percent or fixed) are **never stacked** — the one producing the strictly lower resulting price wins; on a tie the service's own discount wins and the coupon is not consumed.
- One redemption per user per coupon code, DB-enforced (`UNIQUE(coupon_id, user_id)`).
- A capped coupon's redemption count is checked under a row lock on the coupon itself (needed specifically for platform-wide coupons, which can be redeemed concurrently from unrelated salons).
- A referral-issued coupon (`issued_to_user_id` set) is usable only by that one recipient — probing whether it exists for someone else returns the same generic "invalid code" message as a nonexistent code.

## Wallet rules

- A debit is always capped at the available balance — it **never** throws and never goes negative; any shortfall is recorded and (for a referral reversal) paged to an operator.
- `wallet_balances` is a cache, always recomputed under a `SELECT ... FOR UPDATE` row lock inside the same transaction as the ledger insert — never trusted standalone.
- Currencies (`toman`, `points`) never convert into each other.

## Referral rules

- One lifetime referral code per person, redeemable exactly once (as the *referred* party) per person, ever.
- Referral type (`user`/`salon_owner`/`worker`) resolves dynamically from the referrer's role **at redemption time** (worker beats salon_owner beats plain user) and is then frozen forever on the `referrals` row.
- Reward terms are snapshotted at redemption time — a later admin change to `referral_reward_types` never retroactively affects an existing referral.
- A `first_paid_booking` reward requires a 72-hour (config) holdback from `payments.paid_at` before granting, to close the pay→reward→refund fraud loop.
- `max_referrals_per_referrer`, when set, is enforced under a row lock on the referrer's own code row — verified adversarially to hold under concurrent redemption attempts.
- Reward granting is idempotent per `(referral, beneficiary_role)`, DB-backstopped by a unique constraint.
- On a confirmed refund, a wallet-kind reward is clawed back (capped, per the never-negative rule); a coupon-kind reward is voided **only if still unredeemed** — an already-redeemed discount coupon is explicitly, deliberately not reversible.

## Review rules

- Exactly one review per booking, ever — DB-enforced on `booking_id`, independent of the review's `status`, so a withdrawn review permanently closes that booking to further reviews.
- A review is only creatable from a `completed` booking.
- A worker rating is required if and only if the booking had an assigned worker.
- Editable/deletable only by the reviewing customer, only within `review_edit_window_hours` (72h) of creation, inclusive of the boundary instant.
- Salon `rating_avg`/`rating_count` (and the equivalent worker aggregate) are always recomputed from scratch under a row lock — never incremented/decremented in place, specifically to avoid a lost-update race across concurrent recomputes.
- Moderation is reactive only — content is visible immediately on creation; an admin can only ever act *after the fact*.

## Salon moderation rules

- New salons start `pending`; only `approved` salons are ever publicly visible.
- An admin cannot approve a salon whose owner account is currently suspended.
- Suspending a user cascades to suspend their `approved` salon (`suspended_cause='owner_suspended'`); reactivating the user only restores a salon suspended by that cascade, never one an admin suspended directly (`suspended_cause='admin'`).
- A rejected salon can only return to `pending` via the owner's own resubmit action — there is no admin-side transition back to `pending`.
- Featured placement (`is_featured`/`featured_until`) boosts at most 2 salons to the top of search results per query, and can never bypass the gender/geo/category/status filters (the boost logic runs strictly after, and only reorders within, the filtered result set).

## Content rules (photos, stories, portfolio)

- A story expires exactly 24 hours after creation, enforced as a **DB-clock** predicate (`expires_at > now()`) on every visibility read — never an app-clock check, eliminating clock drift as a failure mode. A missed GC cron run only delays cleanup, never causes a stale story to reappear.
- Story cap: 10 active (counted including admin-removed-but-not-yet-expired rows, to prevent an upload-remove-upload churn loophole). Portfolio cap: 40 (same anti-churn counting).
- The first photo uploaded to a salon is automatically the cover; setting a new cover unsets every other cover row in the same transaction.
- Reported content (open report) is pinned — never garbage-collected — until the report resolves.

## Subscription & plan rules

- Every salon has exactly one `salon_subscriptions` row, from the instant it's created (inserted in the same transaction as the salon insert) — never momentarily unresolvable.
- Exactly one plan may be `is_default` at a time, DB-backstopped by a partial unique index — the fallback every salon's entitlements resolve to when its own subscription is `canceled`.
- A plan referenced by any salon's subscription cannot be deleted, enforced by the database's own foreign-key restrict behavior — same pattern as category delete.
- The default plan itself cannot be deleted, and its `is_default` flag cannot be unset without moving it to another plan first — the platform must never be left with zero resolvable default.
- A plan's `key` (internal identifier) is set at creation only — never editable, since later phases branch on it in code.
- A salon's resolved entitlements are its active plan's entitlements with any admin-set salon-specific override merged in key-by-key (override wins); a canceled subscription resolves to the default plan alone, with no override applied.
- Entitlement enforcement does not exist yet — `SubscriptionsService.getEntitlements()` is a resolution seam only, not wired into any feature gate. See [30-subscription-plan-foundation.md](./30-subscription-plan-foundation.md).

## Public handle & attribution rules

- A salon's public handle (`slug`) is provider-editable, checked against a reserved-word list (route collisions + platform-page-lookalikes) before every write, and DB-unique-backstopped.
- `Booking.attributionSource` ('qr'/'direct'/'search'/null) is distinct from `Booking.source` ('online'/'manual') — the former is a marketing channel, the latter is how the row was created. Resolved once client-side, never recomputed.
- Attribution is best-effort and additive only — never blocks or alters a booking's own creation logic, and an unrecognized/malformed value is silently dropped rather than rejected loudly on this specific field.

## Salon CRM rules

- A "customer" is not a separate entity — anyone with at least one `Booking` at a salon is that salon's customer, and ownership isolation is enforced by the booking-history query's own `WHERE salon_id = ... AND user_id = ...` shape, not a separate access check.
- Customer segment (`new`/`returning`/`lapsed`) is a fixed heuristic (≤1 booking → new; no visit in 60+ days → lapsed; otherwise returning) — not admin/owner-configurable.
- Dashboard figures are filtered by *when the activity happened* (`created_at`/`paid_at`), never a booking's own `starts_at` (almost always a future appointment date) — the same "when did this happen" lens across gross value, online-collected, and commission.
- `grossBookingValue` is the full service price (`bookings.price_snapshot`); it is never conflated with `financial_transactions.gross_amount`, which is the online deposit only. `estimatedSalonRevenue` (gross − commission) is explicitly labeled estimated — the salon's own cash portion is never actually observed by the platform.
- Customer notes are owner-only (create/delete, no edit), salon-scoped, and never audited — self-service data about the caller's own customers, matching the codebase's "audit_log = which admin did what" semantics.

## Salon SMS + quota rules

- `entitlements.smsMonthlyQuota` is a plain number resolved through the existing entitlement engine; a missing or non-numeric value means **0 (blocked)**, never unlimited — the opposite default from the referral system's `maxReferralsPerReferrer: null → unlimited` convention, deliberately, since an SMS quota bounds a real per-message platform cost.
- Usage is derived, not stored — `COUNT(*)` of `salon_sms_messages` rows within the current Jalali calendar month, the same period boundary `MonthlyInvoiceGenerationJob` uses. There is no separate counter to reset or drift out of sync.
- A send is quota-checked, then actually sent, then logged — in that order, so a failed send never consumes quota. Unlike every automated notification SMS in this codebase, a real send failure is NOT swallowed; it's the owner's own primary action, so it must surface as a real error.

## Subscription coupons + billing rules

- Subscription coupons are a separate entity from the booking `Coupon` (the redeeming identity is the salon, not a user); billing stays architecture-only, so an admin manually records what was actually paid/comp'd rather than any real payment gateway charging a subscription.
- A `SubscriptionBillingPeriod`'s `baseAmountToman` is the plan's price frozen at creation time — a later plan-price change never retroactively alters an existing period.
- A billing period is only resolvable (paid/comped/void) from `pending` — a settled period is never overwritten; a genuine correction is a fresh period, not an edit.
- No cron ever creates a billing period — every one is admin-created, deliberately, so nothing about this scaffolding reads as real automated billing.

## Category rules

- A salon must have at least one category tag from creation onward — `categoryIds` requires `@ArrayMinSize(1)` on both create and (when supplied) update.
- A category referenced by any service or any salon tag cannot be deleted — enforced by the database's own foreign-key restrict behavior, not an app-level pre-check.
- Category tags are owner-curated and **independent** of the salon's current service list (post multi-category migration) — removing all services in a category does not remove the tag, and adding a genuinely new kind of service does not automatically add a tag.

## Search rules

- Gender filter (`women`/`men`) is mandatory and applied unconditionally — no result ever bypasses it.
- Default search radius is 15km (raised from an original 5km after real salons were found being silently excluded in large metros).
- Results are hard-capped at 50, with no pagination — an explicit MVP cut.
- The minimum-price figure shown per salon reflects the *post-discount* minimum across active services, computed with the exact same rounding rule as checkout (`applyDiscount`) so the two numbers can never disagree by a rounding unit.

## Commission & invoicing rules

- Commission accrues only against the online **deposit**, never the full service price.
- Commission rate is frozen at the moment of accrual — a later config change never retroactively affects an already-accrued row.
- An invoice is only generated once its Jalali month has fully closed; it is always recomputed from scratch (never incrementally) from its linked ledger rows.
- Settlement is entirely manual — no automated payout exists anywhere in the system.

## Related documents

Every rule above is explained in full mechanical detail, with sequence/state diagrams, in its owning subsystem document: [09](./09-booking-engine.md), [10](./10-scheduling.md), [11](./11-payment-system.md), [12](./12-wallet.md), [13](./13-financial-system.md), [14](./14-commission.md), [30](./30-subscription-plan-foundation.md), [31](./31-public-handle-and-attribution.md), [32](./32-salon-crm.md), [33](./33-salon-sms-quota.md), [34](./34-subscription-coupons-and-billing.md).
