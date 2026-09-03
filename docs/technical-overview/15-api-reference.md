# 15 — API Reference

Global prefix `/api` (every path below is appended to it). Global `ValidationPipe({whitelist:true, transform:true})`. No Swagger/OpenAPI is generated — this document is the API contract. **`AuthGuard` is global** (`APP_GUARD` in `app.module.ts`): every route requires a valid session unless it is explicitly marked `@Public()`; controllers add only `RolesGuard`/`SalonOwnerGuard` on top. `route-guard-audit.spec.ts` pins the `@Public()` allowlist, the exact controller count, and the Admin/Owner guard on every `admin/*` / `salons/mine*` route.

Guard shorthand: **Auth** = the global `AuthGuard` only (valid session). **Admin** = `RolesGuard` + `@Roles('admin')`. **Owner** = `SalonOwnerGuard` (resolves `req.salonId`, 404s if the caller owns no salon). **Public** = `@Public()` (no session read at all).

## Auth (`auth/auth.controller.ts`)

| Route | Guard | Purpose |
|---|---|---|
| `POST /auth/request-otp` | Public | Issue + SMS a 6-digit OTP, rate-limited (3/hr) |
| `POST /auth/verify-otp` | Public | Verify OTP, create/find user, apply referral code, set session cookie |
| `GET /auth/me` | Auth | Caller's own profile |
| `PATCH /auth/profile` | Auth | Update name/gender |
| `POST /auth/logout` | Auth | Clear session cookie |

## Users (`users/admin-users.controller.ts`)

| Route | Guard | Purpose |
|---|---|---|
| `GET /admin/users` | Admin | Filtered/paginated user list |
| `PATCH /admin/users/:id/status` | Admin, audited | Suspend/reactivate (cascades to owned salon) |

## Salons — owner-facing (`salons/salons.controller.ts`)

| Route | Guard | Purpose |
|---|---|---|
| `POST /salons` | Auth | Create the caller's salon (→ `pending`, default plan subscription created alongside) |
| `GET /salons/mine` | Auth | Caller's own salon — the onboarding probe, deliberately the one `salons/mine*` route without `SalonOwnerGuard` (404 = "no salon yet") |
| `PATCH /salons/mine` | Owner | Update own salon (incl. `bookingConfirmationMode`; timeouts deliberately excluded) |
| `PATCH /salons/mine/handle` | Owner | Change the public handle (`slug`; reserved-word-checked, 409 if taken) — [31](./31-public-handle-and-attribution.md) |
| `POST /salons/mine/resubmit` | Owner | Rejected → pending |
| `GET /salons/:slug` | Public | Public profile (approved-only) |
| `GET /salons/:slug/canonical` | Public | `{slug, moved}` — resolves a released handle via `salon_slug_history` (404 if the salon is no longer `approved`, never leaking existence); `moved: true` is what `user-app` turns into a real SSR 301 — [31](./31-public-handle-and-attribution.md) |

## Salons — `mine/*` sub-resources (all Owner-guarded)

| Controller | Routes |
|---|---|
| `salon-photos.controller.ts` | `GET/POST /salons/mine/photos`, `PATCH/DELETE /salons/mine/photos/:id` |
| `salon-portfolio.controller.ts` | `GET/POST /salons/mine/portfolio`, `PATCH/DELETE /salons/mine/portfolio/:id` |
| `salon-services.controller.ts` | `POST/GET /salons/mine/services`, `PATCH/DELETE /salons/mine/services/:id` |
| `salon-stories.controller.ts` | `GET/POST /salons/mine/stories`, `DELETE /salons/mine/stories/:id` |
| `salon-workers.controller.ts` | `POST/GET /salons/mine/workers`, `PATCH /salons/mine/workers/:id`, `PATCH /salons/mine/workers/:id/services`, `GET /salons/mine/workers/:id/referral-code` |
| `schedule.controller.ts` | `PUT/GET /salons/mine/hours`, `POST/GET /salons/mine/exceptions` (`GET ?workerId=`; `POST {date, startTime?, endTime?, reason?, workerId?}` — see [10](./10-scheduling.md)), `DELETE /salons/mine/exceptions/:id` |
| `booking/salon-bookings.controller.ts` | `GET /salons/mine/bookings`, `POST /salons/mine/bookings` (owner-entered manual booking — `createManual`, `source='manual'`), `PATCH /salons/mine/bookings/:id` (completed/no_show), `POST /salons/mine/bookings/:id/approve`, `POST /salons/mine/bookings/:id/reject` (see "Booking approval workflow" below), `PATCH /salons/mine/bookings/:id/assign-worker`, `POST /salons/mine/bookings/:id/reschedule` (audited, `booking.rescheduled`) |
| `booking/salon-earnings.controller.ts` | `GET /salons/mine/earnings` (ledger-backed — [14](./14-commission.md)) |
| `coupons/salon-coupons.controller.ts` | `POST/GET /salons/mine/coupons`, `PATCH/DELETE /salons/mine/coupons/:id` |
| `reviews/salon-review-reply.controller.ts` | `PATCH /salons/mine/reviews/:id/reply` |
| `invoicing/salon-invoices.controller.ts` | `GET /salons/mine/invoices` |
| `catalog/category-requests.controller.ts` | `GET/POST /salons/mine/category-requests` (`{name, note?}`; one open request per name per salon) |
| `salons/salon-mine-subscription.controller.ts` | `GET /salons/mine/subscription` (read-only: plan + resolved entitlements) — [30](./30-subscription-plan-foundation.md) |
| `billing/salon-billing-periods.controller.ts` | `GET /salons/mine/subscription/billing-periods` (read-only billing history) — [34](./34-subscription-coupons-and-billing.md) |
| `crm/salon-customers.controller.ts` | `GET /salons/mine/customers`, `GET /salons/mine/customers/:customerId`, `POST /salons/mine/customers/:customerId/notes`, `DELETE /salons/mine/customers/:customerId/notes/:noteId`, `GET /salons/mine/dashboard-summary?from=&to=`, `GET /salons/mine/funnel?from=&to=` (this salon's own slice of the booking funnel, read from `analytics_events.salon_id`), `GET /salons/mine/sms-quota`, `POST /salons/mine/customers/:customerId/sms` (`{message}`; 409 unless salon `approved` or quota exhausted; wire text prefixed with the salon name) — [32](./32-salon-crm.md), [33](./33-salon-sms-quota.md) |

## Salons — public content (Public)

| Controller | Routes |
|---|---|
| `salons/public-salon-content.controller.ts` | `GET /salons/:slug/services`, `/hours`, `/exceptions` (today-onward whole-salon closures only, never per-worker rows), `/photos`, `/stories` (unexpired+published only), `/portfolio` (published only), `/workers?serviceId=` (eligibility-filtered), `/workers/:id/ratings` |
| `reviews/salon-reviews.controller.ts` | `GET /salons/:salonId/reviews?page=&pageSize=` (`pageSize` 1–100; approved salons only) |
| `booking/availability.controller.ts` | `GET /salons/:salonId/availability?serviceId=&workerId=` |
| `salons/sitemap-salons.controller.ts` | `GET /sitemap/salon-slugs?page=` (paginated, 5,000/page) |

## Salons — admin (Admin)

| Controller | Routes |
|---|---|
| `salons/admin-salons.controller.ts` | `GET /admin/salons` (filtered/paginated), `GET /admin/salons/:id`, `GET /admin/salons/:id/stories`, `/portfolio` (unfiltered moderation view), `PATCH /admin/salons/:id/status` (audited; 409 if the owner is suspended and the target is `approved`), `PATCH /admin/salons/:id/featured` (audited), `PATCH /admin/salons/:id/handle` (audited — admin override of the public handle) |
| `salons/admin-showcase.controller.ts` | `PATCH /admin/stories/:id/status` (audited), `PATCH /admin/portfolio/:id/status` (audited) |
| `booking/admin-booking-settings.controller.ts` | `GET/PATCH /admin/salons/:id/booking-settings`, `GET /admin/bookings/:id/events` — see "Booking approval workflow" below |
| `booking/admin-bookings.controller.ts` | `GET /admin/bookings` — paginated, filterable booking list (`status`, `salonId`, `userId`, `confirmationMode`, `source`, `paymentStatus`, `from`/`to` on `startsAt`). **Read-only by design**: booking invariants live in the state machine, and an admin mutation route would bypass them. Each row carries customer/salon/service/worker names, money, payment state and commission, with `payment: null`/`commissionAmount: null` left as real states rather than flattened to zero |
| `subscriptions/admin-salon-subscriptions.controller.ts` | `GET /admin/salons/:salonId/subscription`, `PATCH … {planId}` (audited `subscription.plan.set`; refuses inactive plans), `POST …/cancel` (audited; also clears overrides), `PATCH …/overrides {overrides|null}` (audited `subscription.overrides.set`) |
| `billing/admin-subscription-billing.controller.ts` | `GET/POST /admin/salons/:salonId/subscription/billing-periods` (`POST {periodStart, periodEnd, couponCode?}`; 409 unless the subscription is `active`), `PATCH …/:periodId/status {status: 'paid'|'comped'|'void'}` (salon-scoped, compare-and-swap from `pending` — 409 if already settled; `void` releases the coupon redemption) — all audited |

## Booking (`booking/`)

| Controller | Routes |
|---|---|
| `bookings.controller.ts` (Auth) | `POST /bookings` (body may carry `attributionSource: 'qr'|'direct'|'search'`), `GET /bookings/mine`, `GET /bookings/:id`, `POST /bookings/:id/cancel`, `POST /bookings/:id/retry-payment`, `POST /bookings/:id/reschedule` |
| `payments.controller.ts` (Public) | `GET /payments/callback` (Zarinpal redirect target) |

`GET /bookings/mine` and `GET /bookings/:id` both carry **`depositPaid: boolean`** (true iff a `Payment` reached `paid`/`refund_pending`/`refunded`); `GET /bookings/:id` additionally carries `refundStatus: 'pending'|'done'|null`. Clients must branch "deposit collected" copy on `depositPaid`, never on `depositAmount` (non-zero even with online payment off) — see [09](./09-booking-engine.md), [29](./29-global-payment-toggle.md).

A booking-conflict 409 from `POST /bookings`/`assign-worker` (createHold/createManual/assignWorker) carries a stable `code` (`booking-error-codes.ts`): `BOOKING_UNAVAILABLE` (salon-capacity/slot-overlap/lock-contention) or `WORKER_UNAVAILABLE` (that specific worker is double-booked) — same convention as coupons' `coupon-error-codes.ts`. `GET /payments/callback`'s redirect carries `PAYMENT_FAILED` as a query param on a genuine decline (not on an unrecognized/unattributable authority, a distinct failure mode).

## Coupons (`coupons/`)

| Controller | Routes |
|---|---|
| `coupon-validation.controller.ts` (Auth) | `POST /coupons/validate` |
| `admin-coupons.controller.ts` (Admin) | `POST/GET /admin/coupons`, `PATCH/DELETE /admin/coupons/:id` (audited) |

## Reviews (`reviews/`)

| Controller | Routes |
|---|---|
| `reviews.controller.ts` (Auth) | `GET /reviews/mine?bookingId=`, `POST /reviews`, `PATCH /reviews/:id`, `DELETE /reviews/:id` |
| `admin-reviews.controller.ts` (Admin) | `GET /admin/reviews`, `PATCH /admin/reviews/:id` (audited) |
| `admin-worker-ratings.controller.ts` (Admin) | `GET /admin/worker-ratings`, `PATCH /admin/worker-ratings/:id/status` (audited) |

## Referrals (`referrals/`)

| Route | Guard |
|---|---|
| `GET /referrals/my-code` | Auth |
| `GET /referrals/validate` | Public, IP-rate-limited (20/hr) |
| `GET /referrals/mine` | Auth |
| `GET /referrals/mine/rewards` | Auth |
| `GET/PATCH /admin/referral-reward-types` / `/:type` | Admin (PATCH audited) |
| `GET /admin/referrals` | Admin |
| `GET /admin/referrals/:id/rewards` | Admin |
| `POST /admin/referrals/:id/cancel` | Admin, audited |

## Wallet (`wallet/`)

| Route | Guard |
|---|---|
| `GET /wallet/mine` | Auth |
| `GET /wallet/mine/transactions` | Auth |
| `GET /admin/wallet/transactions` | Admin |
| `POST /admin/wallet/adjust` | Admin, audited |

## Invoicing (`invoicing/`)

| Route | Guard |
|---|---|
| `GET /admin/invoices` | Admin |
| `GET /admin/invoices/:id` | Admin |
| `GET /admin/invoices/:id/payments` | Admin |
| `PATCH /admin/invoices/:id/payment` | Admin, audited |
| (`GET /salons/mine/invoices` listed above under Salons) | Owner |

## Reports (`reports/`)

| Route | Guard |
|---|---|
| `POST /reports` | Auth |
| `GET /reports/eligibility?salonId=` | Auth |
| `GET /admin/reports` | Admin |
| `PATCH /admin/reports/:id` | Admin, audited |

## Audit (`audit/admin-audit.controller.ts`)

| Route | Guard |
|---|---|
| `GET /admin/audit-log` | Admin |

## Admin Notifications (`admin-notifications/`)

| Route | Guard |
|---|---|
| `GET /admin/notifications` | Admin |
| `GET /admin/notifications/unread-count` | Admin |
| `PATCH /admin/notifications/:id/read` | Admin |
| `POST /admin/notifications/read-all` | Admin |

## Content / Blog (`content/`)

| Controller | Routes |
|---|---|
| `blog.controller.ts` (Public) | `GET /blog/posts`, `GET /blog/posts/:slug`, `GET /blog/categories` |
| `admin-blog.controller.ts` (Admin, all mutations audited) | `GET /admin/blog/posts`, `GET /admin/blog/posts/:id`, `POST /admin/blog/posts`, `PATCH /admin/blog/posts/:id`, `POST /admin/blog/posts/:id/publish`, `/unpublish`, `DELETE /admin/blog/posts/:id`, `POST /admin/blog/posts/:id/cover`, `DELETE .../cover`, `POST/PATCH/DELETE /admin/blog/categories(/:id)` |
| `sitemap-blog.controller.ts` (Public) | `GET /sitemap/blog-posts?page=` (paginated, 5,000/page) |

## Catalog (`catalog/`)

| Route | Guard |
|---|---|
| `GET /categories` | Public |
| `POST/PATCH/DELETE /admin/categories(/:id)` | Admin, audited (delete restricts: 409 if any salon service references it) |
| `GET /admin/category-requests?status=&page=&pageSize=` | Admin |
| `PATCH /admin/category-requests/:id/approve` (`{name, icon}` — creates the category) / `/:id/reject` (`{note}`) | Admin, audited (`category-request.approve`/`.reject`) |
| (`GET/POST /salons/mine/category-requests` listed above under Salons) | Owner |

## Cities (`cities/cities.controller.ts`)

| Route | Guard |
|---|---|
| `GET /cities` | Public — DB-backed `cities` table (seeded by migration), served through `CitiesService`'s in-process cache; no admin mutation endpoint |

## Search (`search/search.controller.ts`)

| Route | Guard |
|---|---|
| `GET /search?lat=&lng=&gender=&q=&radiusKm=&categoryId=&priceMin=&priceMax=&sort=&cursor=&pageSize=` | Public — `gender` required; `radiusKm` 0.5–50; `priceMin`/`priceMax` integer toman, 0–`MAX_PRICE_TOMAN` (`common/money-limits.ts`, 1,000,000,000 — non-integers/`Infinity` are 400, not 500); `sort` `distance|rating`; cursor-paginated, `pageSize` 1–100 |

## Activity (`activity/activity.controller.ts`)

| Route | Guard |
|---|---|
| `GET /activity/mine?cursor=&limit=` | Auth — the caller's own activity feed, cursor-paginated |

## Analytics (`analytics/admin-analytics.controller.ts`)

| Route | Guard |
|---|---|
| `GET /admin/analytics/summary?from=&to=` | Admin — per-event totals + day-by-day booking-funnel breakdown (defaults to the last 30 days); rendered by the admin-panel's `AnalyticsView.vue` |

## Favorites (`favorites/favorites.controller.ts`)

| Route | Guard |
|---|---|
| `GET /favorites` | Auth |
| `POST /salons/:id/favorite` | Auth (idempotent) |
| `DELETE /salons/:id/favorite` | Auth (idempotent) |

## Platform Config (`platform-config/`)

| Route | Guard |
|---|---|
| `GET /platform-config/booking-terms` | Public — deposit %, min deposit, cancellation window |
| `GET /platform-config/feature-flags` | Public — the boolean `feature_*_enabled` flags (reviews, stories, portfolio, referrals, coupons, online payment) |
| `GET /admin/config` | Admin — the **numeric** keys only (`REQUIRED_PLATFORM_CONFIG_KEYS`), never the flags |
| `PATCH /admin/config` | Admin, audited — bulk update, bounds-checked per key (`boundsFor()`) |
| `GET /admin/feature-flags` | Admin |
| `PATCH /admin/feature-flags` | Admin, audited (`feature-flags.update`) |

## Subscriptions & billing — admin (`subscriptions/`, `billing/`)

| Route | Guard |
|---|---|
| `GET/POST /admin/plans`, `PATCH/DELETE /admin/plans/:id` | Admin, audited (`plan.create/update/delete`). `key` is create-only; `update` refuses to deactivate the default plan or default an inactive one; `DELETE` is 204. `GET` includes each plan's `subscriberCount` (active subscriptions only) |
| `GET /admin/plans/:id/salons` | Admin — which salons are actually on this plan right now (`active` subscriptions only), the detail behind `subscriberCount` above; 404 for an unknown plan id (added 2026-09-04) |
| `POST/GET /admin/subscription-coupons`, `PATCH/DELETE /admin/subscription-coupons/:id` | Admin, audited (`subscription-coupon.*`). Percent-only, platform-wide; `PATCH {isActive:true}` reactivates |
| (`/admin/salons/:salonId/subscription*` listed above under Salons — admin) | Admin |

## Ops / infrastructure (all `@Public()` at the controller level)

| Route | Guard | Purpose |
|---|---|---|
| `GET /metrics` | Public | Prometheus text exposition (`metrics/`) |
| `POST /csp-report` | Public, 204 | Browser CSP violation report sink (`csp-report/`) — unauthenticated by necessity |
| `GET /version` | Public | Build/version identifier (`version/`) |
| `POST /internal/backup-report` | `@Public()` + `BackupReportSecretGuard` (constant-time `BACKUP_REPORT_SECRET` header compare), 204 | Backup outcome report from `docker/backup/backup.sh`; failure pages via `AlertsService` (`backup-monitoring/`) |

## Push (`push/push.controller.ts`)

| Route | Guard |
|---|---|
| `POST /push/subscribe` | Auth (idempotent upsert) |
| `DELETE /push/subscribe` | Auth |

## Health

| Route | Guard | Purpose |
|---|---|---|
| `GET /health` | Public | Checks DB+Redis, `{status:'ok', db, redis}` or 503 — kept at its original path/shape since all three apps' `playwright.config.ts` `webServer` entries already poll it as their "API is up" gate |
| `GET /liveness` | Public | Process-alive only, touches neither DB nor Redis — for an orchestrator's liveness probe, so a brief Postgres/Redis blip never gets a healthy process killed |
| `GET /readiness` | Public | Same DB+Redis check as `/health`, under its own explicit name |

`/liveness` and `/readiness` are additive; `/health` is unchanged. `route-guard-audit.spec.ts` asserts the exact count of `@Controller(` decorators (67 across 66 files as of 2026-09-04 — `admin-referrals.controller.ts` declares two) so a new controller cannot be added without the audit noticing, pins the CI-enforced `@Public()` allowlist, and asserts the Admin/Owner guard on every `admin/*` / `salons/mine*` route. See [21-security.md](./21-security.md).

## Notable file-upload endpoints

Every upload endpoint (`salons/mine/photos`, `salons/mine/portfolio`, `salons/mine/stories`, `admin/blog/posts/:id/cover`) shares the same pattern: `FileInterceptor`, hard 5MB cap, real magic-number MIME sniffing restricted to `image/jpeg|png|webp` (via the `file-type` package, not the client's `Content-Type` header), server-generated storage keys (never derived from the client's filename).

## Related documents

- [17-permissions.md](./17-permissions.md) — full guard/role detail behind the shorthand above
- [21-security.md](./21-security.md) — upload validation, audit interceptor mechanics
- Each numbered subsystem document repeats its own relevant slice of this table with full business-rule context

## Booking approval workflow

| Method | Route | Guard | Purpose |
|---|---|---|---|
| POST | `/salons/mine/bookings/:id/approve` | `SalonOwnerGuard` + audited (`booking.approval.approved`) | Accept a `pending_approval` request. Re-checks capacity/worker availability under the salon lock, then opens the payment window (`pending_payment` + a `Payment` row + a snapshotted `payment_expires_at`), or goes straight to `confirmed` when nothing is owed or online payment is off (in which case any wallet balance staked at request time is handed back). 409 if no longer pending. Returns 200, not 201 — it transitions rather than creates. |
| POST | `/salons/mine/bookings/:id/reject` | `SalonOwnerGuard` + audited (`booking.approval.rejected`) | Decline a request. Body `{ reason }` **required** (1..300), echoed to the customer. Releases the coupon/wallet hold. 409 if no longer pending. |
| GET | `/admin/salons/:id/booking-settings` | `RolesGuard('admin')` | The salon's mode (read-only here), its raw overrides (`approvalTimeoutOverride`/`paymentTimeoutOverride`, `null` = inherit) and the **effective** resolved values with their global defaults and `*IsOverridden` flags. |
| PATCH | `/admin/salons/:id/booking-settings` | `RolesGuard('admin')` | Set or clear the per-salon overrides. Body `{ approvalTimeoutMinutes?, paymentTimeoutMinutes? }`, each `1..1440` or an explicit `null` to inherit. Audited as `booking-settings.update`. |
| GET | `/admin/bookings/:id/events` | `RolesGuard('admin')` | The booking's full lifecycle timeline, oldest first. |
| POST | `/bookings/:id/reschedule` | Auth (customer must own the booking) | Move a live booking to a new time, keeping the same row/payment/history. Body `{ startsAt }`; `endsAt` is always recomputed from the service duration. For the customer, allowed only while still **more than `cancellation_window_hours` before the ORIGINAL start** (never the requested new one) — otherwise it would be a free escape hatch from deposit forfeiture: push the appointment out, then "cancel early" for a full refund. 409 once inside that window (too close to the original start), 400 for a past time or a non-movable status. The salon's own reschedule route has no such restriction — see [09-booking-engine.md](./09-booking-engine.md). |
| POST | `/salons/mine/bookings/:id/reschedule` | `SalonOwnerGuard` + audited (`booking.rescheduled`) | The same move, salon-initiated — no cancellation-window restriction, since the salon is already trusted with cancelling outright. |

Changed shapes on existing routes:

- `POST /bookings` — in manual mode returns `booking.status === 'pending_approval'`,
  `paymentRequired: false`, and a `paymentUrl` pointing at the in-app booking page rather than a
  gateway session.
- Every booking payload now carries `confirmationMode`, `approvalExpiresAt`, `paymentExpiresAt`.
- `PATCH /salons/mine` accepts `bookingConfirmationMode` (`'automatic' | 'manual_approval'`).
  It does **not** accept either timeout field, by design.
- `GET`/`PATCH /admin/config` now include `booking_approval_timeout_minutes`.

See [28-booking-approval-workflow.md](./28-booking-approval-workflow.md).
