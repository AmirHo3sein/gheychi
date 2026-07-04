# Arayeshgah

Salon discovery & booking marketplace (Iran). Spec: `docs/superpowers/specs/2026-07-04-arayeshgah-marketplace-design.md`.

## Structure

- `apps/api` — NestJS modular monolith (PostgreSQL + PostGIS, Redis)
- `apps/user-app` — Nuxt 3 PWA (Plan 3)
- `apps/provider-panel` — Vue 3 SPA (Plan 4)
- `apps/admin-panel` — Vue 3 SPA (Plan 5)

## Getting started

```bash
docker compose up -d          # postgres (postgis) + redis
cp .env.example apps/api/.env
pnpm install
pnpm --filter @arayeshgah/api migration:run
pnpm dev:api                  # http://localhost:3002/api/health
```

(Ports are non-default on this machine — see the "Port note" in `docs/superpowers/plans/2026-07-04-plan-1-foundation-backend-core.md`'s Task 2 section if setting up fresh elsewhere and `.env.example`'s values need adjusting for local port conflicts.)

## Tests

```bash
pnpm --filter @arayeshgah/api test        # unit
pnpm --filter @arayeshgah/api test:e2e    # e2e (needs docker services)
```

## Booking & payments (Plan 2)

- `POST /api/bookings` — hold a slot + get a Zarinpal deposit payment URL (customer, authenticated)
- `GET /api/salons/:salonId/availability?serviceId=...` — next 14 days of open slots (public)
- `GET /api/payments/callback?Authority=...&Status=OK|NOK` — Zarinpal redirects here; returns JSON (no frontend to redirect to yet)
- `GET /api/bookings/mine`, `GET /api/bookings/:id`, `POST /api/bookings/:id/cancel` — customer-facing
- `GET /api/salons/mine/bookings`, `PATCH /api/salons/mine/bookings/:id` — provider-facing (mark completed/no_show)

**Payments run against `MockPaymentGateway` by default** (`PAYMENT_GATEWAY=mock` in `.env`/`.env.test`) — no real Zarinpal account is needed for local dev or tests. To use the real gateway, set `PAYMENT_GATEWAY=zarinpal` and `ZARINPAL_MERCHANT_ID`, and **verify the exact API contract against Zarinpal's sandbox first** — see the note at the top of `docs/superpowers/plans/2026-07-04-plan-2-booking-payments.md`.

Two background jobs run every 1 and 5 minutes respectively: expiring abandoned booking holds (`booking_hold_ttl_minutes`, seeded at 15) and reconciling payments whose Zarinpal callback never arrived (fixed 20-minute stale threshold). The 20-minute threshold is intentionally longer than the default hold TTL, so a genuinely-late-but-successful payment commonly finds its booking already expired by the time reconciliation runs — this is handled (the payment is still marked `paid`, the booking is not resurrected into a possibly-rebooked slot), not a bug, but the two numbers are tuned relative to each other and shouldn't be changed independently without re-checking that relationship.

**No money actually moves automatically in this plan.** `refunded`/`paid`/`failed` on a `Payment` row are bookkeeping labels only — there is no real Zarinpal refund API call anywhere in the system. A `refunded` status means "the customer is owed a refund," not "a refund was issued." Similarly, the `logger.error(...)` lines marking a payment as needing manual review (orphaned authority, late payment on an expired booking, gateway failures) are plain application logs with no alerting/paging integration yet — someone has to know to look for them. Both are explicit, deliberate MVP scope cuts, not oversights; wiring up real refunds and log-based alerting are natural candidates for a future plan.

## Reviews & moderation (Plan 3)

- `POST /api/reviews` — leave a rating (1-5) + optional comment for one of your own completed bookings (customer, authenticated)
- `GET /api/salons/:salonId/reviews` — published reviews for a salon, newest first (public)
- `PATCH /api/salons/mine/reviews/:id/reply` — salon owner sets or updates their one reply to a review (provider, authenticated)
- `PATCH /api/admin/reviews/:id` — admin sets a review's status to `published` or `rejected` (admin-only)

**Reviews are verified-booking-only**, enforced at the database level by a UNIQUE index on `reviews.booking_id` — a booking can only be reviewed once, and only after the salon marks it `completed`.

**Moderation is reactive, not pre-publish**: a review is `published` the instant it's created; there's no queue to clear before it's visible. An admin can later flip it to `rejected` (or back) if a report is upheld — how a report reaches an admin (support ticket, phone call) is outside this system for MVP, same as Zarinpal refund settlement in Plan 2.

`salons.rating_avg`/`rating_count` are always recomputed from every currently-`published` review for that salon, in the same transaction as any status-changing write — never incremented/decremented in place — so a rejection (or reversal) immediately and correctly updates the salon's public rating. The recompute locks the salon row first (`SELECT ... FOR UPDATE`) before reading the aggregate, closing a lost-update race that a naive single-statement `UPDATE ... FROM (aggregate subquery)` would have under concurrent writes to the same salon's reviews.
