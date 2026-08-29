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
  `approve()` (already used for a genuinely-free manual-approval booking) — no new branch.
- **Wallet debit** (inside `createHold`): gated on the same flag. With payment collection off,
  there is no online deposit for a wallet credit to reduce, so the debit is skipped entirely —
  otherwise a customer's wallet balance would be silently spent for zero effect (the salon
  still collects the full price in cash, unaware any wallet credit was applied).

The post-commit branch in `createHold` that decides "is there a payment session to open" was
changed from checking `depositAmount === 0` to checking `booking.status === 'confirmed'` —
strictly more general (every pre-existing zero-deposit case already implied `status ===
'confirmed'`; the new flag-off-with-a-real-deposit case now also does, and needs the same
"nothing to open" handling).

No new booking status, no new migration on the `bookings` table, no change to cancellation,
refund, or reconciliation logic — a `Payment` row's absence already degrades every one of
those paths to a no-op, which is exactly the state a payment-disabled booking is in.

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
