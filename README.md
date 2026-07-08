# Arayeshgah

Salon discovery & booking marketplace (Iran). Spec: `docs/superpowers/specs/2026-07-04-arayeshgah-marketplace-design.md`.

## Structure

- `apps/api` — NestJS modular monolith (PostgreSQL + PostGIS, Redis)
- `apps/user-app` — Nuxt 4, mobile-first PWA (Plan 4)
- `apps/provider-panel` — Vue 3 SPA, salon-owner back office (Plan 5)
- `apps/admin-panel` — Vue 3 SPA, platform admin back office (Plan 6)

## Getting started

```bash
docker compose up -d          # postgres (postgis) + redis
cp .env.example apps/api/.env
pnpm install
pnpm --filter @arayeshgah/api migration:run
pnpm dev:api                  # http://localhost:3002/api/health
```

```bash
cp apps/user-app/.env.example apps/user-app/.env   # set NUXT_PUBLIC_NESHAN_API_KEY and NUXT_PUBLIC_VAPID_PUBLIC_KEY for map/push features
pnpm dev:user-app                                   # http://localhost:3003
```

`NUXT_PUBLIC_VAPID_PUBLIC_KEY` must be the public half of the same keypair as the API's `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (`.env.example` at the repo root) — generate one pair with `npx web-push generate-vapid-keys` and split the two halves between the two `.env` files. Map and push both degrade gracefully without real keys (map view fails silently back to list view; push subscribe UI just won't do anything meaningful) — neither blocks the rest of the app.

(Ports are non-default on this machine — see the "Port note" in `docs/superpowers/plans/2026-07-04-plan-1-foundation-backend-core.md`'s Task 2 section if setting up fresh elsewhere and `.env.example`'s values need adjusting for local port conflicts.)

## Tests

```bash
pnpm --filter @arayeshgah/api test        # unit
pnpm --filter @arayeshgah/api test:e2e    # e2e (needs docker services)
```

## Booking & payments (Plan 2)

- `POST /api/bookings` — hold a slot + get a Zarinpal deposit payment URL (customer, authenticated)
- `GET /api/salons/:salonId/availability?serviceId=...` — next 14 days of open slots (public)
- `GET /api/payments/callback?Authority=...&Status=OK|NOK` — Zarinpal redirects here; the API 302s onward to `/booking/callback?status=...&bookingId=...` on the frontend (Plan 4's `apps/user-app/app/pages/booking/callback.vue`), which renders the success/failure confirmation
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

## Provider panel (Plan 5)

A Vue 3 + Vite SPA (`apps/provider-panel`) covering onboarding, dashboard, bookings, services, hours, photos, reviews, and earnings for salon owners. Backend additions it needed:

- `POST /api/salons/mine/photos` — upload a salon photo (multipart `file` field, jpeg/png/webp, 5MB max); the first photo uploaded is automatically marked cover. `PATCH /api/salons/mine/photos/:id` (isCover/sortOrder), `DELETE /api/salons/mine/photos/:id`.
- Photo storage goes through a swappable `StorageProvider` (`STORAGE_PROVIDER=local|s3`, same pattern as `SmsProvider`/`PaymentGateway`/`PushProvider`) — `local` writes under `apps/api/uploads/` and serves it at `/uploads/*`; `s3` talks to any S3-compatible bucket via `S3_ENDPOINT`/`S3_BUCKET`/`S3_REGION`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_PUBLIC_BASE_URL`.
- `GET /api/salons/mine/earnings` — `{ totalCollected, commissionPercent, commissionAmount, netPayout }`, computed from `paid` payments on the caller's own bookings. No new payment infrastructure; purely aggregates existing `Booking`/`Payment` rows.
- CORS now allows both `FRONTEND_BASE_URL` (user-app) and `PROVIDER_APP_BASE_URL` (provider-panel) as credentialed origins.
- No salon-approval workflow was added by this plan — that gap is closed by Plan 6 below.

## User app (Plan 4)

The first real UI: a Nuxt 4 SSR PWA covering login, discovery, salon profiles, booking, my bookings, and profile — plus an admin-controlled "featured salon" placement and push/SMS appointment notifications. Full design: `docs/superpowers/specs/2026-07-05-plan-4-user-app-frontend-design.md`.

**New public (unauthenticated) surface, specifically for SEO:** salon profile pages (`/salons/:slug`) are the one part of this app reachable without logging in — they're SSR-rendered with JSON-LD/OG metadata as Google landing pages, matching the original marketplace spec's intent. Every other route requires a session.

**Featured salons ("تبلیغ" / Ad badge):** `PATCH /api/admin/salons/:id/featured` (admin-only) flags a salon as featured with an optional expiry. Featured, still-approved, still-filter-matching salons are boosted to the top of `/api/search` results (capped at 2 per query) and rendered with a distinct badge — this can never bypass the gender/city/category filters every other result already goes through. There's no self-serve payment flow yet; an admin sets the flag directly (via the bare-bones `/admin/featured` page in the frontend, or the API) — Plan 6's admin-panel (below) doesn't add featured-salon management either, so this stays on the bare-bones page until a pricing model and dedicated UI exist.

**Push notifications, and closing Plan 2's reminder gap:** booking confirmations now send a push notification alongside the existing SMS, and a new scheduled job (`booking-reminder.job.ts`, same pattern as the existing hold-expiry/reconciliation jobs) sends both an SMS and a push reminder a configurable number of hours (`platform_config.reminder_lead_hours`, seeded at 3) before each confirmed appointment — Plan 2 shipped without this.

**Known gaps carried forward, not fixed by this plan:**
- ~~`salon_photos` has a public read endpoint now, but still no upload path anywhere in the system — galleries stay empty until provider-panel (a future plan) ships photo management.~~ Closed by Plan 5: `POST /api/salons/mine/photos` (see "Provider panel (Plan 5)" above) lets a provider upload/manage photos.
- ~~The admin `/admin/featured` page and the two admin salon endpoints it calls are intentionally minimal — there's still no salon-approval workflow (`pending` → `approved`) anywhere in the API; that remains a future admin-panel concern, same as before this plan.~~ Closed by Plan 6: `PATCH /api/admin/salons/:id/status` (see "Admin panel (Plan 6)" below) adds a real approve/reject/suspend workflow.
- Blog/content-marketing SEO is a separate, not-yet-started Plan 5 — this plan only covers the salon-profile side of SEO.

## Admin panel (Plan 6)

A new Vue 3 + Vite SPA (`apps/admin-panel`, port 3005) for platform staff, same minimal stack and "Teal Trust" tokens as provider-panel, no shared code between the two per the isolation rule. Built as five vertical slices, backend + frontend together per slice:

- **Salon approvals** — a queue view (defaults to `status=pending`) and a detail view with Approve / Reject (reason required) / Suspend (reason required) actions. This closes the biggest gap Provider Panel (Plan 5) left open: `pending` → `approved` no longer needs a manual DB update anywhere in the flow.
- **Review moderation** — a filterable list (salon/status/rating) so an admin can find the review a report was about and flip it published ↔ rejected via the existing `PATCH /api/admin/reviews/:id`.
- **Categories** — create and rename service categories. No delete (categories are FK'd from `salon_services`, so removing one in use needs a restrict-or-cascade decision left for later).
- **Users & salons** — search/filter users (phone, name, role, join-date range) and salons (name, city, status, gender target), with suspend/unsuspend on both. Suspending a user blocks their login only — it does not cascade to their salon.
- **Platform config** — a generic key/value editor over `platform_config`, no per-key curation or bounds checking.

New/changed API endpoints:
- `GET/PATCH /api/admin/salons` — now filterable by `status`/`city`/`name`/`genderTarget`, plus a `status=all` option; defaults to `status=pending`
- `PATCH /api/admin/salons/:id/status` — `{ status: 'approved'|'rejected'|'suspended', reason?: string }` (reason required for reject/suspend)
- `GET /api/admin/salons/:id` — full detail for the salon-detail view
- `POST /api/salons/mine/resubmit` — provider-panel side; flips a `rejected` salon back to `pending`
- `GET /api/admin/reviews` — filterable review list for moderation
- `POST/PATCH /api/admin/categories` — create/rename
- `GET/PATCH /api/admin/users` — search/filter, and `PATCH /api/admin/users/:id/status` to suspend/unsuspend
- `GET/PATCH /api/admin/config` — read all `platform_config` rows / bulk-update them

**Provider Panel addition:** a Salon Settings page (Dashboard → Settings, alongside Hours/Photos) reusing the onboarding `SalonInfoStep.vue` in edit mode, plus a `rejected`-status branch on the pending-approval screen showing the rejection reason with a link to Settings and a resubmit button — so a rejected provider has a real recovery path instead of a dead end.

CORS now also allows `ADMIN_APP_BASE_URL` (default `http://localhost:3005`) as a credentialed origin, alongside the existing `FRONTEND_BASE_URL`/`PROVIDER_APP_BASE_URL` — found and fixed as part of this plan's e2e work (Task 24).

**Out of scope, not built by this plan:**
- No report/flag mechanism — reports about a salon or review still arrive out-of-band (support ticket, phone call), same as before.
- No category delete.
- No auto-suspend of a user's salon when the user is suspended.
- No first-admin bootstrap script — the first admin account is still a manual DB update.
- No audit log of admin actions (who approved/rejected/suspended what, when).
- No notification to an admin when a provider resubmits a rejected salon.
