# 26 — System Map

A cross-cutting reference: the development timeline mapped to the files each stage touched, a full module-to-file glossary, and the big-picture data-flow diagrams that don't belong to any single subsystem document.

## Development timeline → files touched

| Plan | What shipped | Primary files/modules |
|---|---|---|
| 1 — Foundation | Users, salons, categories, search | `users/`, `salons/salon.entity.ts`, `catalog/`, `search/` |
| 2 — Booking & payments | Booking holds, Zarinpal, deposits | `booking/` (core), `booking/payment-gateway.ts`, `zarinpal-payment.gateway.ts` |
| 3 — Reviews & moderation | Reviews, reactive moderation | `reviews/` |
| 4 — User-app frontend | Nuxt PWA, featured salons, push reminders | `apps/user-app/`, `push/`, `booking/booking-reminder.job.ts` |
| 5 — Provider panel | Salon-owner back office, photo upload | `apps/provider-panel/`, `storage/`, `salons/salon-photos.controller.ts` |
| 6 — Admin panel | Salon approval workflow, moderation UI | `apps/admin-panel/`, `salons/admin-salons.controller.ts` |
| 7 — Platform hardening | Audit log, reports, cascade suspend, admin notifications | `audit/`, `reports/`, `admin-notifications/`, `users/admin-users.service.ts` |
| 8 — Blog CMS | Markdown blog, admin editor, public SEO pages | `content/` |
| 9 — Production deployment | Docker images, Caddy, CI/CD, DB backups | `docker-compose.prod.yml`, `Caddyfile`, `.github/workflows/ci.yml`, `docker/backup/` |
| — Real payment refunds | Refund state machine, retry job | `payments.service.ts` (refund path), `refund-retry.job.ts` |
| — Money-critical alerting | Operator paging | `alerts/` |
| — Salon showcase (2026-07-17) | Stories, profile fields, portfolio | `salons/salon-story.entity.ts`, `portfolio-item.entity.ts`, `salons/story-cleanup.job.ts` |
| — Coupons & discounts (2026-07-19) | Coupon codes, per-service discounts | `coupons/`, `booking/discount.util.ts` |
| — Referrals & ratings (2026-07-22) | Workers, worker ratings, wallet, referral program | `salons/worker.entity.ts`, `reviews/worker-rating.entity.ts`, `wallet/`, `referrals/` |
| — Commission & invoicing | Per-booking commission, monthly invoices | `invoicing/` |
| — Multi-category + worker restrictions | Salon category tagging, per-worker service eligibility | `salons/salon-category.entity.ts`, `salons/worker-service.entity.ts`, `salons/worker-eligibility.service.ts` |
| — Production-readiness hardening (2026-08-07) | Cron job distributed locking/failure paging, cursor-paginated search, categories cache, cities promoted to a real DB table, stored-XSS closed, OTP per-IP rate limiting, N+1 fixes | `common/cron-job-runner.service.ts`, `common/cron-lock.service.ts`, `search/search.service.ts`, `cities/`, `common/trusted-image-upload.ts`, `auth/otp.service.ts` |
| — Production-readiness hardening, continued (2026-08-10) | Per-request correlation-id logging, an error-tracking abstraction + global exception filter, a product-analytics foundation seeded on the booking funnel, `/liveness`+`/readiness` split from `/health`, stable booking-conflict/payment-failure error codes, IDOR/role-escalation/upload-spoofing test-coverage closure + a full route-guard audit, k6 load-test baselines, the per-salon booking Redis lock made release-ownership-aware, real concurrent-request e2e coverage for four money-critical races, multi-file sitemap pagination, a cross-app design-consistency audit fix | `common/request-context*.ts`, `common/request-context-logger.service.ts`, `error-tracking/`, `analytics/`, `health/health.controller.ts`, `booking/booking-error-codes.ts`, `route-guard-audit.spec.ts`, `load-tests/`, `booking/bookings.service.ts` (`acquireSalonLock`/`releaseSalonLock`), `common/sitemap-pagination.ts` |
| — Scheduling refinements, feature flags, category requests, activity feed | Partial-day and per-worker schedule exceptions, owner-entered manual bookings, `feature_*_enabled` flags, owner category requests, a per-user activity feed, Prometheus metrics, CSP report sink, `/version` | `salons/schedule-exception.entity.ts`, `booking/bookings.service.ts` (`createManual`), `platform-config/admin-feature-flags.controller.ts`, `catalog/category-request*.ts`, `activity/`, `metrics/`, `csp-report/`, `version/` |
| — Booking approval workflow (2026-08-28) | Optional per-salon manual approval, `booking_events` lifecycle log, admin per-salon timeouts | `booking/booking-approval-expiry.job.ts`, `booking-event.entity.ts`, `booking-events.service.ts`, `booking-settings.service.ts`, `admin-booking-settings.controller.ts` — glossary below, [28](./28-booking-approval-workflow.md) |
| — Monetization platform, 7 phases (2026-08-30) | Global online-payment toggle; plans/subscriptions/entitlement overrides; provider-editable handle + QR + `attributionSource`; salon CRM; owner SMS with monthly quota; subscription coupons + admin-created billing periods | `platform-config/` (`feature_online_payment_enabled`), `subscriptions/`, `salons/salon-mine-subscription.controller.ts`, `salons/salon-handle.dto.ts`/`reserved-handles.ts`, `crm/`, `billing/` — [29](./29-global-payment-toggle.md)–[34](./34-subscription-coupons-and-billing.md) |
| — Audit-and-fix pass (2026-09-03, most recent) | Commission accrues only on captured money (`recordCommission` reads the `paid` Payment), `depositPaid` on customer booking responses, `approve()` hands wallet back when the payment flag is off, per-(phone, IP) OTP attempt scoping, production JWT-secret boot guard, `FARAGOSTARESH_RELAY_TOKEN` to env, `MAX_PRICE_TOMAN` DTO bounds, invoice-payment row lock, referral R6 salon scoping, salon-scoped billing-period CAS + coupon release on void, persistent `api_uploads` volume | `invoicing/invoicing.service.ts`, `booking/bookings.service.ts` (`depositPaidFor`), `booking/booking-hold-release.util.ts` (`reverseWalletSpend`), `auth/otp.service.ts`, `auth/jwt-secret.util.ts`, `sms/sms.module.ts`, `common/money-limits.ts`, `referrals/referrals.service.ts`, `billing/subscription-billing.service.ts`, `docker-compose.prod.yml` |

Design specs live in `docs/superpowers/specs/`, execution records in `docs/superpowers/plans/`, one file per plan — treat these as the historical "why," while this documentation set is the current "what."

## Module → primary files glossary

| Module (backend) | Directory | Key files |
|---|---|---|
| Auth | `apps/api/src/auth/` | `auth.controller.ts`, `otp.service.ts`, `auth.guard.ts` (global `APP_GUARD`), `public.decorator.ts` (`@Public()` opt-out), `roles.guard.ts`/`roles.decorator.ts`, `jwt-secret.util.ts` (production boot guard) |
| Users | `apps/api/src/users/` | `user.entity.ts`, `users.service.ts`, `admin-users.controller.ts`, `admin-users.service.ts` |
| Salons | `apps/api/src/salons/` | `salon.entity.ts`, `salons.service.ts`, `salon-owner.guard.ts`, `worker.entity.ts`, `worker-service.entity.ts`, `worker-eligibility.service.ts`, `salon-category.entity.ts`, `schedule-exception.entity.ts`/`schedule.controller.ts`, `reserved-handles.ts`, `salon-mine-subscription.controller.ts` |
| Booking | `apps/api/src/booking/` | `booking.entity.ts` (`SLOT_BLOCKING_STATUSES`), `bookings.service.ts`, `booking-event.entity.ts`/`booking-events.service.ts`, `booking-settings.service.ts`, `booking-hold-release.util.ts`, `availability.service.ts`/`.util.ts`, `deposit.util.ts`, `discount.util.ts`, `booking-error-codes.ts`, jobs |
| Payments | `apps/api/src/booking/` (same module) | `payment.entity.ts`, `payment-gateway.ts`, `zarinpal-payment.gateway.ts`, `payments.service.ts` |
| Reviews | `apps/api/src/reviews/` | `review.entity.ts`, `worker-rating.entity.ts`, `reviews.service.ts` |
| Coupons | `apps/api/src/coupons/` | `coupon.entity.ts`, `coupon-redemption.entity.ts`, `coupons.service.ts` |
| Wallet | `apps/api/src/wallet/` | `wallet-balance.entity.ts`, `wallet-transaction.entity.ts`, `wallet.service.ts` |
| Referrals | `apps/api/src/referrals/` | `referral.entity.ts`, `referral-reward.entity.ts`, `referrals.service.ts` (job lives in `booking/`!) |
| Invoicing | `apps/api/src/invoicing/` | `financial-transaction.entity.ts`, `invoice.entity.ts`, `invoicing.service.ts` |
| Reports | `apps/api/src/reports/` | `report.entity.ts`, `reports.service.ts` |
| Audit | `apps/api/src/audit/` | `audit-log.entity.ts`, `audit.service.ts`, `audit.decorator.ts`, `audit.interceptor.ts` |
| Admin notifications | `apps/api/src/admin-notifications/` | `admin-notification.entity.ts`, `admin-notifications.service.ts` |
| Content/Blog | `apps/api/src/content/` | `blog-post.entity.ts`, `blog-category.entity.ts`, `content.service.ts` |
| Subscriptions | `apps/api/src/subscriptions/` | `plan.entity.ts`, `salon-subscription.entity.ts`, `plans.service.ts`, `subscriptions.service.ts` (`getEntitlements()`), `admin-plans.controller.ts`, `admin-salon-subscriptions.controller.ts` |
| Billing (architecture-only) | `apps/api/src/billing/` | `subscription-coupon.entity.ts`, `subscription-coupon-redemption.entity.ts`, `subscription-billing-period.entity.ts`, `subscription-coupons.service.ts`, `subscription-billing.service.ts`, `admin-subscription-coupons.controller.ts`, `admin-subscription-billing.controller.ts`, `salon-billing-periods.controller.ts` |
| CRM | `apps/api/src/crm/` | `crm.service.ts` (customers/dashboard derived from bookings), `customer-note.entity.ts`, `customer-sms.service.ts` (quota-gated SMS), `salon-sms-message.entity.ts`, `salon-customers.controller.ts` |
| Activity | `apps/api/src/activity/` | `activity.service.ts`, `activity.controller.ts` (`GET /activity/mine`) |
| Search | `apps/api/src/search/` | `search.service.ts`, `dto/search.dto.ts` |
| Catalog | `apps/api/src/catalog/` | `service-category.entity.ts`, `categories-cache.util.ts`, `category-request.entity.ts`, `category-requests.service.ts`, `category-requests.controller.ts`, `admin-category-requests.controller.ts` |
| Cities | `apps/api/src/cities/` | `city.entity.ts`, `cities.service.ts` (DB-backed, in-process cached; retired the old static `iran-cities.ts`) |
| Favorites | `apps/api/src/favorites/` | `favorite.entity.ts` |
| Push | `apps/api/src/push/` | `push-subscription.entity.ts`, `push.service.ts`, `web-push.provider.ts` |
| SMS | `apps/api/src/sms/` | `sms.provider.ts`, `sms.module.ts` (env-selected factory), `console-sms.provider.ts`, `kavenegar-sms.provider.ts`, `payamakyab-sms.provider.ts`, `faragostaresh-relay-sms.provider.ts` (temporary relay; `FARAGOSTARESH_RELAY_TOKEN`) |
| Storage | `apps/api/src/storage/` | `storage.provider.ts`, `local-disk-storage.provider.ts`, `s3-storage.provider.ts`, `storage-reconciliation.job.ts` |
| Alerts | `apps/api/src/alerts/` | `alerts.service.ts` |
| Error tracking | `apps/api/src/error-tracking/` | `error-tracking.service.ts`, `global-exception.filter.ts` (`APP_FILTER`), `logger-error-tracking.service.ts`, `sentry-error-tracking.service.ts`, `redact-context.ts` |
| Analytics | `apps/api/src/analytics/` | `analytics.service.ts`, `analytics.provider.ts`, `postgres-analytics.provider.ts` (default; `analytics-event.entity.ts`), `console-analytics.provider.ts`, `analytics-aggregation.service.ts`, `admin-analytics.controller.ts` |
| Platform config | `apps/api/src/platform-config/` | `platform-config.entity.ts`, `platform-config.service.ts` (numeric keys + `FEATURE_FLAG_KEYS`, `boundsFor()`), `admin-config.controller.ts`, `admin-feature-flags.controller.ts`, `platform-config.controller.ts` (public) |
| Health | `apps/api/src/health/` | `health.controller.ts` (`/health`, `/liveness`, `/readiness`; registered directly on `AppModule`) |
| Metrics | `apps/api/src/metrics/` | `metrics.service.ts` (Prometheus registry), `http-metrics.middleware.ts`, `metrics.controller.ts` (`GET /metrics`, public) |
| CSP report | `apps/api/src/csp-report/` | `csp-report.controller.ts` (`POST /csp-report`, public sink) |
| Version | `apps/api/src/version/` | `version.service.ts`, `version.controller.ts` (`GET /version`, public) |
| Backup monitoring | `apps/api/src/backup-monitoring/` | `backup-report.controller.ts` (`POST /internal/backup-report`), `backup-report-secret.guard.ts`, `backup-staleness-check.job.ts` |
| AI (unwired) | `apps/api/src/ai/` | `ai.provider.ts`, `ai.service.ts`, `unconfigured-ai.provider.ts` — `AiModule` is not imported anywhere ([27](./27-ai-foundation.md)) |
| Redis | `apps/api/src/redis/` | `redis.module.ts` |
| Common utils | `apps/api/src/common/` + top-level | `postgres-error-codes.ts`, `slug.util.ts`, `cors-origins.util.ts`, `numeric-transformers.ts`, `cron-job-runner.service.ts`/`cron-lock.service.ts`, `trusted-image-upload.ts`, `request-logging.middleware.ts`, `request-context.ts`/`request-context-logger.service.ts`, `sitemap-pagination.ts` |

| Frontend app | Directory | Entry points |
|---|---|---|
| user-app | `apps/user-app/` | `nuxt.config.ts`, `app/pages/`, `app/middleware/auth.global.ts`, `app/stores/session.ts` |
| provider-panel | `apps/provider-panel/` | `src/router/index.ts`, `src/pages/`, `src/composables/useSalon.ts` |
| admin-panel | `apps/admin-panel/` | `src/router/index.ts`, `src/pages/`, `src/composables/usePhoneUserSearch.ts`, `src/utils/labels.ts` (audit-action/target labels, test-pinned against the backend) |
| e2e-cross-app (no app) | `apps/e2e-cross-app/` | `playwright.config.ts` (boots api + user-app + provider-panel), `e2e/01-booking-flows-across-apps.spec.ts`, `e2e/prepare-db.cjs` |

## The big picture: how a single request touches the whole system

```mermaid
flowchart TD
    subgraph "Customer journey"
        S1["Search /\nGET /search"] --> S2["Salon profile\nGET /salons/:slug/*"]
        S2 --> S3["Book\nPOST /bookings"]
        S3 -->|manual_approval salon| S3b["Owner approves\nPOST /salons/mine/bookings/:id/approve"]
        S3b --> S4
        S3 -->|online payment on| S4["Pay\nZarinpal redirect + callback"]
        S3 -->|online payment off| S5
        S4 --> S5["Attend appointment"]
        S5 --> S6["Owner marks completed\nPATCH /salons/mine/bookings/:id"]
        S6 --> S7["Review prompt\nPOST /reviews"]
        S6 -->|only if a paid Payment exists| S8["Commission accrues\nfinancial_transactions"]
        S6 --> S9["Referral reward may grant\ntryGrantReward"]
    end

    subgraph "Owner journey"
        O1["Onboard\nPOST /salons"] --> O2["pending status"]
        O2 --> O3["Admin approves\nPATCH /admin/salons/:id/status"]
        O3 --> O4["Manage services/hours/team/showcase"]
        O4 --> S1
    end

    subgraph "Admin journey"
        A1["Moderation queues\n(salons, reviews, reports, showcase)"] --> O3
        A2["Monthly settlement\nGET /admin/invoices"] --> A3["Record bank transfer\nPATCH /admin/invoices/:id/payment"]
        S8 -.-> A2
    end
```

## Cross-references by concern (quick lookup)

| If you're touching... | Read these documents |
|---|---|
| A new API endpoint | [15](./15-api-reference.md), [17](./17-permissions.md), [21](./21-security.md) — and `route-guard-audit.spec.ts` (`AuthGuard` is global; `@Public()` is the reviewable opt-out) |
| Anything money-related | [09](./09-booking-engine.md), [11](./11-payment-system.md), [12](./12-wallet.md), [13](./13-financial-system.md), [14](./14-commission.md), [20](./20-business-rules.md), [29](./29-global-payment-toggle.md) |
| Plans, entitlements, subscription billing, CRM/SMS | [30](./30-subscription-plan-foundation.md), [32](./32-salon-crm.md), [33](./33-salon-sms-quota.md), [34](./34-subscription-coupons-and-billing.md) |
| Booking statuses / approval flow | [09](./09-booking-engine.md), [28](./28-booking-approval-workflow.md) |
| A new background job | [18](./18-background-jobs.md) |
| Any of the three frontends | [06](./06-user-panel.md), [07](./07-salon-panel.md), [08](./08-admin-panel.md), [24](./24-technical-debt.md) (cross-app duplication) |
| Schema changes | [04](./04-database.md) |
| Anything touching a third-party service | [19](./19-third-party-services.md) |
| Before assuming a limitation is a bug | [23](./23-known-limitations.md) vs [24](./24-technical-debt.md) |

## Related documents

This file is the map; every numbered document from [01](./01-project-overview.md) through [34](./34-subscription-coupons-and-billing.md) is a territory it points into. Start at [00-index.md](./00-index.md) if you're new here.

## Booking approval workflow — file glossary

| Concern | File |
|---|---|
| Statuses + `SLOT_BLOCKING_STATUSES` | `apps/api/src/booking/booking.entity.ts` |
| Request creation / approve / reject | `apps/api/src/booking/bookings.service.ts` |
| Effective timeout resolution | `apps/api/src/booking/booking-settings.service.ts` |
| Lifecycle log | `apps/api/src/booking/booking-event.entity.ts`, `booking-events.service.ts` |
| Approval expiry cron | `apps/api/src/booking/booking-approval-expiry.job.ts` |
| Payment expiry cron | `apps/api/src/booking/booking-expiry.job.ts` |
| Provider decision routes | `apps/api/src/booking/salon-bookings.controller.ts` |
| Admin timing + timeline routes | `apps/api/src/booking/admin-booking-settings.controller.ts` |
| Schema | `apps/api/src/migrations/1755200000000-booking-approval-workflow.ts` |
| Customer UI | `apps/user-app/app/pages/bookings/`, `app/components/booking/RemainingTime.vue` |
| Provider UI | `apps/provider-panel/src/pages/BookingsView.vue`, `SalonSettingsView.vue` |
| Admin UI | `apps/admin-panel/src/components/salons/SalonBookingSettingsCard.vue`, `src/pages/BookingTimelineView.vue` |

Full narrative: [28-booking-approval-workflow.md](./28-booking-approval-workflow.md).
