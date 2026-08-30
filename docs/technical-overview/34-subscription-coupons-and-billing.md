# 34 — Subscription coupons + billing-architecture scaffolding

Phase 7 (final phase) of the monetization/subscription initiative
(`docs/superpowers/specs/2026-08-30-monetization-platform-design.md`). The owner's own
locked-in decision governs everything here: **billing stays architecture-only** — a
`Plan → Subscription → BillingPeriod → Invoice`-shaped structure exists and an admin can
manually record what was actually paid/comp'd, but there is no real Zarinpal
subscription-charge flow anywhere in this phase.

## A genuinely separate entity from the booking `Coupon`

`coupon_redemptions.booking_id` is `NOT NULL UNIQUE` — structurally a booking-redemption
object. A subscription-period redemption doesn't fit that shape without abusing the
constraint (the Phase-A discovery finding that set this phase's scope). `SubscriptionCoupon`/
`SubscriptionCouponRedemption` (`apps/api/src/billing/`) are their own tables:

- Percent-only (no fixed-amount kind) — there is no equivalent "provider issues their own
  subscription coupon" concept, so the shape stays simpler than the booking coupon's.
- The redeeming identity is the **salon**, not a user — `UNIQUE(coupon_id, salon_id)`, one
  redemption per salon per code.
- `SubscriptionCouponsService` is a smaller cousin of the booking `CouponsService`: create/
  list/update/deactivate, platform-wide only, admin-only. Redemption validation (unknown/
  inactive/expired/already-used/at-cap) lives in `SubscriptionBillingService.createPeriod`
  instead of a standalone validate endpoint, since the only real redemption point in this
  phase is billing-period creation — there is no owner-facing checkout to preview against.
- The at-cap check reuses the exact row-lock pattern `CouponsService.resolveAndValidateImpl`
  established for its own platform-wide coupons (`SELECT ... FOR UPDATE` on the coupon row
  before counting redemptions) — the same reason applies here: a capped subscription coupon
  can be redeemed concurrently by entirely unrelated salons.

## Billing periods: admin-created, never a cron

`SubscriptionBillingPeriod` (`subscription_billing_periods`) rows are inserted **only** by an
admin action (`POST /admin/salons/:salonId/subscription/billing-periods`) — there is
deliberately no scheduled job generating these automatically, unlike the invoicing module's
`MonthlyInvoiceGenerationJob`. Auto-generating periods would read as real recurring billing
when it isn't; keeping creation manual keeps the "architecture-only" boundary honest.

- `baseAmountToman` is the subscription's current plan price, **frozen** at creation time —
  the same "snapshot, never re-derived" convention `financial_transactions.commission_percent`
  already established. A later plan-price change never retroactively alters an existing
  period.
- An optional `couponCode` at creation time discounts `amountToman` (`base × (1 −
  discountPercent/100)`, rounded) and atomically records the redemption in the same
  transaction as the period insert.
- `status`: `pending → paid | comped | void`, admin-set via
  `PATCH .../billing-periods/:periodId/status`. **Only resolvable from `pending`** — a
  period that's already paid/comp'd/void is a settled financial record, not something to
  silently overwrite; a genuine correction is a fresh period, not an edit, matching how this
  codebase already treats an invoice as immutable once issued (see `13-financial-system.md`).
- The owner has a read-only equivalent (`GET /salons/mine/subscription/billing-periods`) —
  no route lets them create or resolve one themselves, matching the "salon owner picks only
  booking mode, nothing commercial" decision already applied throughout this initiative.

## Accepted simplifications (explicit, not oversights)

- **No lock across the whole create-period flow.** The coupon-redemption cap check is
  lock-protected (see above), but nothing else about `createPeriod` is — this is a low-
  frequency, admin-only, non-money-critical-in-the-automated-sense action (money only
  actually moves once an admin manually records a real-world payment against a period).
- **No feature flag gates billing-period creation.** Every other admin-driven, potentially
  risky capability in this codebase that could go live accidentally is flag-gated (global
  payment toggle, coupons). Billing periods don't need one: nothing about creating a period
  charges anyone or exposes anything customer-facing — it's a bookkeeping row an admin
  explicitly typed in.
- **No Invoice entity yet**, despite the `Plan → Subscription → BillingPeriod → Invoice`
  shape named in the owner's own decision — a `BillingPeriod` already carries everything an
  "invoice" would (amount, period, status, resolution) for this architecture-only phase; a
  dedicated `Invoice` row (PDF generation, a real due-date/overdue concept, etc.) is future
  work for whenever real billing goes live, not invented here with nothing to back it.

## Admin UI

- `SubscriptionCouponsView.vue` (`/subscription-coupons`) — create + list + deactivate, no
  edit, no fixed-amount kind. Deliberately simpler than the booking `CouponsView.vue` (no
  edit-confirm-diff sub-step) since there's no equivalent provider-facing surface to keep
  parity with.
- `SalonSubscriptionCard.vue` (on `SalonDetailView`) gained a "دوره‌های صورتحساب" section:
  list existing periods, create a new one (date range + optional coupon code), and
  paid/comped/void buttons on any still-`pending` row.

## Provider-panel UI

`PlanView.vue` gained a read-only billing-history list (same data as the admin card, no
controls) — hidden entirely when the salon has no billing periods yet, which is every salon
until an admin actually creates one.
