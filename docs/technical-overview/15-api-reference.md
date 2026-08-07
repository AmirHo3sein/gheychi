# 15 — API Reference

Global prefix `/api` (every path below is appended to it). Global `ValidationPipe({whitelist:true, transform:true})`. No Swagger/OpenAPI is generated — this document is the API contract. No global auth guard — every protected route declares its own `@UseGuards(...)`; guard columns below show the exact declaration order.

Guard shorthand: **Auth** = `AuthGuard` (valid session). **Admin** = `AuthGuard, RolesGuard` + `@Roles('admin')`. **Owner** = `AuthGuard, SalonOwnerGuard` (resolves `req.salonId`, 404s if the caller owns no salon). **Public** = no guard.

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
| `POST /salons` | Auth | Create the caller's salon (→ `pending`) |
| `GET /salons/mine` | Auth | Caller's own salon |
| `PATCH /salons/mine` | Auth | Update own salon |
| `POST /salons/mine/resubmit` | Auth | Rejected → pending |
| `GET /salons/:slug` | Public | Public profile (approved-only) |

## Salons — `mine/*` sub-resources (all Owner-guarded)

| Controller | Routes |
|---|---|
| `salon-photos.controller.ts` | `GET/POST /salons/mine/photos`, `PATCH/DELETE /salons/mine/photos/:id` |
| `salon-portfolio.controller.ts` | `GET/POST /salons/mine/portfolio`, `PATCH/DELETE /salons/mine/portfolio/:id` |
| `salon-services.controller.ts` | `POST/GET /salons/mine/services`, `PATCH/DELETE /salons/mine/services/:id` |
| `salon-stories.controller.ts` | `GET/POST /salons/mine/stories`, `DELETE /salons/mine/stories/:id` |
| `salon-workers.controller.ts` | `POST/GET /salons/mine/workers`, `PATCH /salons/mine/workers/:id`, `PATCH /salons/mine/workers/:id/services`, `GET /salons/mine/workers/:id/referral-code` |
| `schedule.controller.ts` | `PUT/GET /salons/mine/hours`, `POST/GET /salons/mine/exceptions`, `DELETE /salons/mine/exceptions/:id` |
| `booking/salon-bookings.controller.ts` | `GET /salons/mine/bookings`, `PATCH /salons/mine/bookings/:id`, `PATCH /salons/mine/bookings/:id/assign-worker` |
| `booking/salon-earnings.controller.ts` | `GET /salons/mine/earnings` |
| `coupons/salon-coupons.controller.ts` | `POST/GET /salons/mine/coupons`, `PATCH/DELETE /salons/mine/coupons/:id` |
| `reviews/salon-review-reply.controller.ts` | `PATCH /salons/mine/reviews/:id/reply` |
| `invoicing/salon-invoices.controller.ts` | `GET /salons/mine/invoices` |

## Salons — public content (Public)

| Controller | Routes |
|---|---|
| `salons/public-salon-content.controller.ts` | `GET /salons/:slug/services`, `/hours`, `/photos`, `/stories` (unexpired+published only), `/portfolio` (published only), `/workers?serviceId=` (eligibility-filtered), `/workers/:id/ratings` |
| `reviews/salon-reviews.controller.ts` | `GET /salons/:salonId/reviews` |
| `booking/availability.controller.ts` | `GET /salons/:salonId/availability?serviceId=&workerId=` |
| `salons/sitemap-salons.controller.ts` | `GET /sitemap/salon-slugs` (cap 50,000) |

## Salons — admin (Admin)

| Controller | Routes |
|---|---|
| `salons/admin-salons.controller.ts` | `GET /admin/salons` (filtered/paginated), `GET /admin/salons/:id`, `GET /admin/salons/:id/stories`, `/portfolio` (unfiltered moderation view), `PATCH /admin/salons/:id/status` (audited), `PATCH /admin/salons/:id/featured` (audited) |
| `salons/admin-showcase.controller.ts` | `PATCH /admin/stories/:id/status` (audited), `PATCH /admin/portfolio/:id/status` (audited) |

## Booking (`booking/`)

| Controller | Routes |
|---|---|
| `bookings.controller.ts` (Auth) | `POST /bookings`, `GET /bookings/mine`, `GET /bookings/:id`, `POST /bookings/:id/cancel`, `POST /bookings/:id/retry-payment` |
| `payments.controller.ts` (Public) | `GET /payments/callback` (Zarinpal redirect target) |

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
| `PATCH /admin/referrals/:id/cancel` | Admin, audited |

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
| `sitemap-blog.controller.ts` (Public) | `GET /sitemap/blog-posts` (cap 50,000) |

## Catalog (`catalog/`)

| Route | Guard |
|---|---|
| `GET /categories` | Public |
| `POST/PATCH/DELETE /admin/categories(/:id)` | Admin, audited |

## Cities (`cities/cities.controller.ts`)

| Route | Guard |
|---|---|
| `GET /cities` | Public — static in-memory list, no DB |

## Search (`search/search.controller.ts`)

| Route | Guard |
|---|---|
| `GET /search?lat=&lng=&gender=&radiusKm=&categoryId=&sort=` | Public |

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
| `GET /admin/config` | Admin |
| `PATCH /admin/config` | Admin, audited |

## Push (`push/push.controller.ts`)

| Route | Guard |
|---|---|
| `POST /push/subscribe` | Auth (idempotent upsert) |
| `DELETE /push/subscribe` | Auth |

## Health

| Route | Guard |
|---|---|
| `GET /health` | Public — `{status:'ok'}` |

## Notable file-upload endpoints

Every upload endpoint (`salons/mine/photos`, `salons/mine/portfolio`, `salons/mine/stories`, `admin/blog/posts/:id/cover`) shares the same pattern: `FileInterceptor`, hard 5MB cap, real magic-number MIME sniffing restricted to `image/jpeg|png|webp` (via the `file-type` package, not the client's `Content-Type` header), server-generated storage keys (never derived from the client's filename).

## Related documents

- [17-permissions.md](./17-permissions.md) — full guard/role detail behind the shorthand above
- [21-security.md](./21-security.md) — upload validation, audit interceptor mechanics
- Each numbered subsystem document repeats its own relevant slice of this table with full business-rule context
