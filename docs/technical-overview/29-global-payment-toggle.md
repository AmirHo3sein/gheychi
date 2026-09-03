# 29 — Global online payment toggle

Phase 1 of the monetization/subscription initiative (`docs/superpowers/specs/2026-08-30-monetization-platform-design.md`).
An admin-controlled, platform-wide on/off switch for online (Zarinpal) payment collection —
no code deploy needed to flip it. Seeded **off**: launch behavior is unchanged (every deposit
collected in cash at the salon, as if online payment didn't exist yet).

## Mechanism

A sixth entry in `PlatformConfigService`'s existing feature-flag machinery
(`platform-config/platform-config.service.ts`) — `feature_online_payment_enabled`, field name
`onlinePaymentEnabled`. No new admin infrastructure: `GET`/`PATCH /admin/feature-flags` already
handle every flag generically once the key is registered in `FEATURE_FLAG_KEYS` and its DTO
field is added (`dto/admin-feature-flags.dto.ts`). Seeded via migration
`1755500000000-online-payment-feature-flag.ts`.

## Enforcement — two sites, one flag

`BookingsService` computes "does this booking require online payment" independently in two
places; both now AND in the live flag value:

- **`createHold`** (booking creation): `requiresPayment = deposit > 0 && onlinePaymentEnabled`.
  With the flag off, every deposit-owing automatic-mode booking rides the *same* zero-deposit
  code path that already existed for a 100%-discounted booking — confirmed outright, no
  `Payment` row, `notifyConfirmed` sent. `depositAmount` is still stored on the row (needed
  later for CRM "gross booking value" reporting) even though it was never collected online.
  Manual-approval mode is unaffected at creation time — it always lands on `pending_approval`
  regardless of the flag, exactly as before.
- **`approve()`** (salon accepts a manual-approval request): re-reads the flag live (not the
  value in force when the request was submitted) — `requiresPayment = booking.depositAmount >
  0 && onlinePaymentEnabled`. If an admin turns payment off while a request is pending, the
  salon's approval confirms it outright instead of opening a payment window for a capability
  that's no longer enabled. This falls through the *existing* zero-deposit branch of
  `approve()` (already used for a genuinely-free manual-approval booking) — with one addition:
  when `!onlinePaymentEnabled && booking.walletAmountUsed`, `approve()` calls
  `reverseWalletSpend()` (`booking-hold-release.util.ts`, the wallet half of
  `releaseBookingHold` — coupon left in place) inside the same transaction as its status CAS.
  The request staked wallet balance while collection was on; nothing will ever be captured
  against it now, and `createHold`'s own flag-off path never takes that debit, so leaving it
  would make the customer pay the full price in cash *and* lose real wallet credit.
- **Wallet debit** (inside `createHold`): gated on the same flag. With payment collection off,
  there is no online deposit for a wallet credit to reduce, so the debit is skipped entirely —
  otherwise a customer's wallet balance would be silently spent for zero effect (the salon
  still collects the full price in cash, unaware any wallet credit was applied).
- **Commission** (`InvoicingService.recordCommission`, on `completed`/`no_show`): keys off the
  booking's `paid` `Payment` row, not `booking.depositAmount` — with the flag off there is no
  Payment row, so no `financial_transactions` row is written. Before this, every flag-off
  completed booking accrued commission and a salon "net payout" on money the platform never
  held, feeding both monthly invoices and `GET /salons/mine/earnings`. See
  [14-commission.md](./14-commission.md).

The post-commit branch in `createHold` that decides "is there a payment session to open" was
changed from checking `depositAmount === 0` to checking `booking.status === 'confirmed'` —
strictly more general (every pre-existing zero-deposit case already implied `status ===
'confirmed'`; the new flag-off-with-a-real-deposit case now also does, and needs the same
"nothing to open" handling).

No new booking status, no new migration on the `bookings` table, no change to cancellation,
refund, or reconciliation logic — a `Payment` row's absence already degrades every one of
those paths to a no-op, which is exactly the state a payment-disabled booking is in. Commission
accrual did **not** originally share that property (it read `depositAmount` straight off the
booking row) and was brought in line on 2026-09-03; it now degrades the same way, pinned by
`test/booking-payment-toggle.e2e-spec.ts` alongside the `approve()` wallet-reversal case.

## `depositPaid` — what the customer is told

Customer booking responses (`GET /bookings/mine` list and `GET /bookings/:id` detail) carry
`depositPaid: boolean` — `true` iff a `Payment` row for the booking reached `paid` (including
one since moved on to `refund_pending`/`refunded`), computed in one batched `depositPaidFor()`
query for the list. The user-app branches its deposit/refund copy on this (plus `refundStatus`
and `walletAmountUsed`) rather than inferring "you paid a deposit" from `paymentExpiresAt`, so
a flag-off booking — which has a `depositAmount` but no Payment — never shows a deposit as
collected, and the salon page's deposit callout branches on the live `onlinePaymentEnabled`
flag for the same reason.

## Frontend

All three apps' `useFeatureFlags` composables/`FeatureFlagsView.vue` gained the new flag,
defaulting `true` on fetch failure like every other flag (fail-open) — safe here specifically
because this flag only steers *pre-submit copy*, never the actual outcome: the booking
creation response's own `paymentRequired` field is what the post-submit flow branches on,
unchanged.

`apps/user-app`'s booking checkout page (`booking/[slug]/[serviceId].vue`) hides all
online-deposit-specific UI when the flag is off: the wallet-apply checkbox, the "پیش‌پرداخت
آنلاین" deposit preview, the cancellation-window/non-refundable disclosures, and adjusts the
submit button label (`رزرو` instead of `پرداخت و رزرو`) and the manual-approval note (cash-at-
salon copy instead of "payment happens after the salon approves").

## Re-enabling later

Flipping the flag back on needs no migration or backfill — the very next `createHold`/
`approve()` call simply starts requiring payment again, exactly as it did before this flag
existed.

## Flipping the flag while bookings are in flight

The flag is read live at `createHold` and again at `approve()`. What that covers, state by
state — this is the part the original write-up left unstated, and one case was genuinely
broken until 2026-09-03:

| In-flight state | Turning it OFF | Turning it ON |
|---|---|---|
| `pending_approval` (no `Payment` row) | `approve()` re-reads the flag, confirms outright, and hands back any staked wallet debit (`reverseWalletSpend`). | The request was submitted under cash-at-salon copy and now gets a payment window. Accepted: no money is lost, and the customer still chooses whether to pay. |
| `pending_payment` with a live gateway session | **The open window is honoured.** The callback still captures and confirms. But `retry-payment` refuses to mint a *new* authority (409). | n/a — only reachable with the flag on. |
| `confirmed`-unpaid | Nothing retroactively creates a `Payment`; no cron does either. | Nothing retroactively bills it. |
| `confirmed`-paid | Refund paths never consult the flag — correct, refunding must never be gated. | no-op. |

**Why an open window is honoured rather than cancelled.** The customer has already been
redirected to Zarinpal under a deadline that was snapshotted when the window opened.
Refusing the callback mid-redirect would strand a real payment that the gateway has already
taken, which is strictly worse than letting a window the platform itself opened run out.
`BookingExpiryJob` retires the unpaid ones at their own deadline, so the state cannot linger.
What the toggle *does* stop immediately is opening any **new** gateway session.

A confirmation that skipped its payment window now records **why**: `booking_events`
metadata carries `reason: 'online_payment_disabled'` when a real deposit was owed but not
collected, versus `'zero_deposit'` when nothing was owed at all. Both used to be recorded as
`zero_deposit`, which made the admin timeline state something false about every booking
taken while the toggle was off.

