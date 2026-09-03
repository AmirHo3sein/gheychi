# Gheychi — Technical Overview

This is the official internal technical documentation for **Gheychi**, a salon discovery & booking marketplace for Iran. It is written for a senior engineer joining the team with no prior context, and is derived directly from the current implementation (not from product specs or aspirational design docs, which are cross-referenced but treated as secondary sources where they conflict with the code).

**Monorepo root:** `/Gheychi` (pnpm + Turborepo). Four deployable apps (plus `apps/e2e-cross-app`, a Playwright-only package with no app of its own that drives one booking across user-app and provider-panel together):

| App | Path | Port | Stack | Audience |
|---|---|---|---|---|
| API | `apps/api` | 3002 | NestJS 11 + TypeORM + PostgreSQL/PostGIS + Redis | all clients |
| User app | `apps/user-app` | 3003 | Nuxt 4 (SSR PWA) | customers |
| Provider panel | `apps/provider-panel` | 3004 | Vue 3 + Vite SPA | salon owners |
| Admin panel | `apps/admin-panel` | 3005 | Vue 3 + Vite SPA | platform staff |

## How to use this documentation

Each numbered file covers one subsystem in depth: what it does, why it exists, how it works internally, which files/modules implement it, the database tables involved, the API surface, the business rules enforced, and known limitations. Files cross-reference each other liberally — follow the links rather than expecting any one file to be self-contained on adjacent topics.

This documentation is a snapshot as of **2026-09-03**. The codebase is under active development; treat file:line references as approximate pointers, not permanent anchors — always verify against the current source before making changes based on something written here.

## Table of contents

| # | Document | Covers |
|---|---|---|
| 01 | [Project Overview](./01-project-overview.md) | What Gheychi is, product scope, the four apps, tech stack, ports, dev workflow |
| 02 | [System Architecture](./02-system-architecture.md) | Monorepo layout, NestJS module structure, request lifecycle, external-service abstraction pattern, cross-app isolation convention |
| 03 | [Domain Model](./03-domain-model.md) | Core business concepts and how they relate — Users, Salons, Services, Workers, Bookings, Payments, Reviews, Coupons, Referrals, Wallet, Invoicing |
| 04 | [Database](./04-database.md) | Full schema: every table, every migration, full ER diagram, composite-PK join tables, known schema oddities |
| 05 | [Authentication](./05-authentication.md) | OTP login flow, JWT/session cookie, `AuthGuard`, `RolesGuard`, `SalonOwnerGuard` |
| 06 | [User Panel (`apps/user-app`)](./06-user-panel.md) | Customer-facing Nuxt PWA: pages, composables, components, PWA/push, SEO surface |
| 07 | [Salon Panel (`apps/provider-panel`)](./07-salon-panel.md) | Salon-owner back office: onboarding, bookings, services, team, showcase content |
| 08 | [Admin Panel (`apps/admin-panel`)](./08-admin-panel.md) | Platform staff back office: moderation, users, config, financials |
| 09 | [Booking Engine](./09-booking-engine.md) | `Booking` state machine, hold/lock mechanism, worker assignment, cancellation |
| 10 | [Scheduling & Availability](./10-scheduling.md) | Working hours, schedule exceptions, the Iran-timezone slot-computation algorithm |
| 11 | [Payment System](./11-payment-system.md) | `Payment` state machine, Zarinpal gateway, callback handling, refunds, reconciliation |
| 12 | [Wallet](./12-wallet.md) | Internal ledger, credit/debit rules, booking-spend integration |
| 13 | [Financial System — Coupons & Referrals](./13-financial-system.md) | Discount resolution, coupon redemption, the referral program end-to-end |
| 14 | [Commission & Invoicing](./14-commission.md) | Per-booking commission accrual, monthly settlement invoices, manual payout recording |
| 15 | [API Reference](./15-api-reference.md) | Every HTTP route, grouped by module, with guards and purpose |
| 16 | [Notifications](./16-notifications.md) | SMS, Web Push, admin notification queue, operator alerting |
| 17 | [Permissions](./17-permissions.md) | Every guard/role/ownership check across the backend and all three frontends |
| 18 | [Background Jobs](./18-background-jobs.md) | Every cron job, schedule, and what it does |
| 19 | [Third-Party Services](./19-third-party-services.md) | Zarinpal, Kavenegar, Web Push/VAPID, S3-compatible storage, PostGIS, maps, image CDN |
| 20 | [Business Rules](./20-business-rules.md) | Consolidated reference of every enforced business rule, with the file that enforces it |
| 21 | [Security](./21-security.md) | AuthN/AuthZ, CORS, cookies, upload validation, XSS posture, audit logging, secrets |
| 22 | [Performance & Scalability](./22-performance.md) | Known scaling limits and why they exist |
| 23 | [Known Limitations](./23-known-limitations.md) | Deliberate MVP cuts, documented as such in the code/specs |
| 24 | [Technical Debt](./24-technical-debt.md) | Undeliberate gaps, duplication, and drift found during this audit |
| 25 | [Future Improvements](./25-future-improvements.md) | Reserved seams and extension points already visible in the code |
| 26 | [System Map](./26-system-map.md) | Cross-cutting data-flow diagrams and a file-location glossary |
| 27 | [AI Foundation](./27-ai-foundation.md) | The `AiProvider` abstraction, why it's generic, and why nothing calls it yet |
| 28 | [Booking Approval Workflow](./28-booking-approval-workflow.md) | The optional per-salon manual-approval mode: request → approve → pay, deadlines, and who configures what |
| 29 | [Global Online Payment Toggle](./29-global-payment-toggle.md) | `feature_online_payment_enabled` — how the platform-wide payment flag gates deposit collection, and what a booking looks like with it off |
| 30 | [Subscription/Plan Foundation](./30-subscription-plan-foundation.md) | `Plan` / `SalonSubscription`, the default-plan backfill, entitlement resolution and per-salon overrides |
| 31 | [Public Handle, QR & Attribution](./31-public-handle-and-attribution.md) | Provider-editable `salon.slug` as the shareable link, client-side QR, `Booking.attributionSource` |
| 32 | [Salon CRM](./32-salon-crm.md) | Customer list/detail/notes derived from bookings, segmentation heuristic, the salon financial dashboard's terminology |
| 33 | [Salon SMS + Quota](./33-salon-sms-quota.md) | Owner-initiated customer SMS, the first enforced entitlement (`smsMonthlyQuota`), `salon_sms_messages` log |
| 34 | [Subscription Coupons & Billing](./34-subscription-coupons-and-billing.md) | `SubscriptionCoupon` (separate from booking coupons), `SubscriptionBillingPeriod`, admin-only settlement — architecture-only billing |
| 35 | [Entitlement Engine](./35-entitlement-engine.md) | The capability seam paid features read from — key registry, per-key absent-defaults, `hasFeature`/`getLimit`/`getQuota` |


## Conventions used throughout this documentation

- **File paths** are relative to the monorepo root unless stated otherwise.
- **Mermaid diagrams** are used for state machines, sequence flows, and ER diagrams. If your Markdown viewer doesn't render Mermaid, view these files on a renderer that does (GitHub, GitLab, most modern IDEs).
- Persian-language error/UI strings are quoted verbatim where they matter to behavior (e.g. distinguishing two different 400 responses), with an English gloss.
- "MVP cut" means a limitation the team deliberately chose to ship without, usually documented as such in a code comment or the root `CLAUDE.md`/`README.md`. "Technical debt" means something that looks unintentional, inconsistent, or drifted.

> The 2026-09-03 production-hardening sprint's full gap analysis (all 31 readiness areas,
> with severity and an implementation record) lives outside this series, at
> [`docs/engineering/PRODUCTION_COMPLETION_AUDIT.md`](../engineering/PRODUCTION_COMPLETION_AUDIT.md).
