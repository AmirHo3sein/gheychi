# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Development Mindset

Approach every task — feature, bug fix, improvement, or refactor — as a top-tier professional engineer:

- Prioritize code quality, performance, security, and reliability in every change.
- Be proactive: identify and fix bugs, edge cases, and vulnerabilities you encounter along the way.
- When you notice improvements in surrounding code (same file or related files), verify existing behavior works first, then **ask before modifying** — do not change code without explicit confirmation.
- Keep solutions simple and efficient. Avoid unnecessary complexity and over-engineering.
- Every change should leave the codebase better than before, not just "working".
- Think long-term: write code that is easy to understand, easy to extend, and easy to trust.
- This repo's non-obvious tradeoffs (reactive moderation, hold-TTL/reconciliation timing) are **deliberate MVP scope cuts**, documented as such in the README and plan docs — don't "fix" them without checking whether they're an intentional cut first.

---

## Project Overview

Gheychi is a salon discovery & booking marketplace for Iran, built as a **pnpm + Turborepo monorepo**. Full product spec: `docs/superpowers/specs/2026-07-04-gheychi-marketplace-design.md`.

| App | Package | Dev Port | Status | Purpose |
|-----|---------|----------|--------|---------|
| `apps/api` | `@gheychi/api` | 3002 | Built (Plans 1–3) | NestJS modular monolith — auth, salons, search, booking/payments, reviews |
| `apps/user-app` | `@gheychi/user-app` | 3003 | Built (Plan 4) | Nuxt 4 SSR PWA — customer-facing discovery, booking, account |
| `apps/provider-panel` | `@gheychi/provider-panel` | 3004 | Built (Plan 5) | Vue 3 + Vite SPA — salon-owner onboarding, bookings, services, hours, reviews, earnings |
| `apps/admin-panel` | `@gheychi/admin-panel` | 3005 | Built (Plan 6) | Vue 3 + Vite SPA — salon approvals, moderation, categories, platform config |

Backend infra: PostgreSQL 16 + PostGIS (geography columns for location/radius search) and Redis (OTP codes, rate limiting). Both run via `docker-compose.yml` at the repo root.

---

## Commands

```bash
# Setup (first time)
docker compose up -d                                  # postgres (postgis) + redis
cp .env.example apps/api/.env
pnpm install
pnpm --filter @gheychi/api migration:run
cp apps/user-app/.env.example apps/user-app/.env       # set NUXT_PUBLIC_VAPID_PUBLIC_KEY for push

# Dev servers (from root)
pnpm dev:api                    # apps/api            → http://localhost:3002/api/health
pnpm dev:user-app               # apps/user-app       → http://localhost:3003
pnpm dev:provider-panel         # apps/provider-panel → http://localhost:3004
pnpm dev:admin-panel            # apps/admin-panel    → http://localhost:3005

# Build (all apps, Turborepo-orchestrated)
pnpm build

# Tests
pnpm test                                              # turbo run test, all apps
pnpm --filter @gheychi/api test                     # backend unit (Jest)
pnpm --filter @gheychi/api test:e2e                 # backend e2e (Jest + supertest, needs docker services)
pnpm --filter @gheychi/user-app test                # frontend unit/component (Vitest)
pnpm --filter @gheychi/user-app test:e2e            # frontend e2e (Playwright)
pnpm --filter @gheychi/user-app typecheck            # nuxt typecheck

# Migrations (apps/api)
pnpm --filter @gheychi/api migration:run
pnpm --filter @gheychi/api migration:revert
```

`NUXT_PUBLIC_VAPID_PUBLIC_KEY` must be the public half of the same keypair as the API's `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` — generate one pair with `npx web-push generate-vapid-keys` and split the halves between the two `.env` files. Push degrades gracefully without real keys. Maps need no key at all — see the "Maps" section below.

Ports in `docker-compose.yml`/`.env.example` are non-default on this dev machine (Postgres `5544`, Redis `6381`) — adjust if setting up fresh elsewhere; see the "Port note" in `docs/superpowers/plans/2026-07-04-plan-1-foundation-backend-core.md` (Task 2).

---

## Tech Stack

**Backend (`apps/api`)**
- NestJS 11, TypeORM 0.3 + PostgreSQL/PostGIS, Redis (`ioredis`)
- `class-validator` + `class-transformer` for DTOs, global `ValidationPipe({ whitelist: true, transform: true })`
- `@nestjs/schedule` for cron jobs, `@nestjs/jwt` for session tokens (HttpOnly cookie, not localStorage)
- Jest (unit + e2e via `supertest`), `ioredis-mock` for Redis in tests
- Swappable provider abstractions for SMS (Kavenegar), payments (Zarinpal), push (Web Push/VAPID) — see below

**Frontend (`apps/user-app`)**
- Nuxt 4 (SSR), Vue 3 Composition API, Pinia
- Tailwind CSS v4 via `@tailwindcss/vite` (no separate `tailwind.config`) + CSS custom properties for light/dark theming
- `@vite-pwa/nuxt` (installable PWA, Workbox service worker, Web Push)
- `@nuxt/image` with a custom ArvanCloud provider (`app/providers/arvancloud.ts`)
- Leaflet + CARTO's free Voyager tiles for maps (client-only, lazy-loaded, no API key)
- Vitest (unit + Nuxt-environment component tests) + Playwright (e2e)
- **Persian/RTL only** — no i18n library, `lang="fa" dir="rtl"` set directly

**`provider-panel` and `admin-panel`** — both built as Vue 3 + Vite SPAs (no SSR need, authenticated-only tools), per the original marketplace design doc §6–7. See the README's "Provider panel (Plan 5)" and "Admin panel (Plan 6)" sections for what each covers; their frontend stacks aren't detailed separately here since neither needed the SSR/PWA machinery `apps/user-app` above does.

---

## Architecture — `apps/api`

### Module structure

Each domain is a self-contained NestJS module under `src/<domain>/`:

```
src/booking/
├── booking.module.ts
├── bookings.controller.ts        bookings.service.ts
├── availability.controller.ts    availability.service.ts
├── salon-bookings.controller.ts  # provider-scoped, separate controller from the customer one
├── payments.controller.ts        payments.service.ts
├── booking.entity.ts             payment.entity.ts
├── booking-expiry.job.ts  booking-reminder.job.ts  payment-reconciliation.job.ts
├── payment-gateway.ts (interface)  mock-payment.gateway.ts  zarinpal-payment.gateway.ts
├── deposit.util.ts  availability.util.ts  (+ colocated .spec.ts)
└── dto/booking.dto.ts
```

- **One entity file per table**, one service per domain, but **multiple controllers per module** when a resource is exposed differently to different actors (customer-facing vs `salons/mine/*` provider-facing vs admin).
- **Simple single-entity CRUD controllers may skip the service layer** and operate directly against an injected `Repository<T>` (e.g. `catalog/`, `favorites/`, `push/`) — this is a deliberate exception to "one service per domain," not drift: reserve a service for modules with actual business logic (validation beyond DTOs, multi-step writes, cross-entity reads). Even without a service, reuse the shared `common/` helpers rather than re-deriving the same logic inline: `postgres-error-codes.ts`'s `isUniqueViolation`/`isForeignKeyViolation` (DB-constraint→HTTP mapping) and `trusted-image-upload.ts`'s `assertTrustedImageMimeType()` (every upload endpoint must call this — `file.mimetype` is client-supplied and NestJS's `FileTypeValidator` sniffs real bytes but never rewrites it, so trusting the header alone is a stored-XSS vector via S3's `Content-Type`).
- **DTOs** live in `dto/`, named `{Action}{Entity}Dto` (`CreateBookingDto`, `UpdateSalonDto`). Validated via `class-validator` decorators (`@Matches`, `@IsIn`, `@Length`, `@Type(() => Number)`, etc.) — global `ValidationPipe` enforces them.
- **Unit tests (`.spec.ts`) are colocated** next to the file they test, not in a parallel `test/` tree. Only e2e tests live under `test/`.
- **Background jobs** live in their owning module as `@Injectable()` classes with `@Cron()` on a `handleCron()` method that delegates to a plain `async run()` (keeps the logic independently callable from tests). Registered as providers in the module. `handleCron()` always goes through `CronJobRunner.run(jobName, fn, {lockTtlMs?, warnAfterMs?})` (`common/cron-job-runner.service.ts`, `@Global()` via `CommonModule`) — wraps `run()` in `CronLockService`'s distributed Redis lock (no overlapping runs across instances), pages `AlertsService` on an uncaught failure, and raises a non-cancelling "still running" warning past `warnAfterMs`. All 9 current jobs (`booking-expiry`, `booking-reminder`, `payment-reconciliation`, `refund-retry`, `referral-expiry`, `referral-grant`, `story-cleanup`, `storage-reconciliation`, `invoicing/monthly-invoice-generation`) go through it — a new job should too, not call `run()` directly from `handleCron()`.

### Auth & guards

- `AuthGuard` (`auth/auth.guard.ts`) — reads the JWT from the `session` HttpOnly cookie, verifies it, loads the user, attaches `req.user`. Throws `UnauthorizedException` if missing/invalid.
- `RolesGuard` (`auth/roles.guard.ts`) + `@Roles('admin')` decorator — reads required roles via `Reflector`, compares to `req.user.role`, throws `ForbiddenException`.
- `SalonOwnerGuard` (`salons/salon-owner.guard.ts`) — runs **after** `AuthGuard`; looks up the caller's own salon and attaches `req.salonId`. 404s if the caller doesn't own a salon.

```typescript
@Controller('salons/mine/services')
@UseGuards(AuthGuard, SalonOwnerGuard)     // req.user AND req.salonId both available
export class SalonServicesController { ... }
```

Tokens are **never** exposed to JS — HttpOnly cookie only, matching the frontend's model (see user-app section below).

### Database & migrations

- TypeORM config: `TypeOrmModule.forRootAsync()` in `app.module.ts` (`synchronize: false`, `autoLoadEntities: true`); CLI data source in `src/data-source.ts`.
- Migrations: `src/migrations/<unix-timestamp>-<name>.ts`. Run via `pnpm --filter @gheychi/api migration:run` (wraps `typeorm-ts-node-commonjs migration:run -d src/data-source.ts`).
- Entities map to **snake_case columns explicitly**: `@Column({ name: 'user_id' })  userId: string`.
- PostGIS: geography columns typed `{ type: 'geography', spatialFeatureType: 'Point', srid: 4326 }`, TS-side as a `GeoPoint` interface (`{ type: 'Point', coordinates: [lng, lat] }`).
- `bigint` DB columns get an explicit transformer (`bigintToNumber`) so TypeORM returns a `number`, not a string, in application code.

### External service abstractions

Every external integration follows the same interface-token-factory pattern, selected by an env var, so tests and local dev never hit real third parties:

| Concern | Interface | Token | Implementations | Selector env var |
|---|---|---|---|---|
| SMS | `SmsProvider` (`sms/sms.provider.ts`) | `SMS_PROVIDER` | `ConsoleSmsProvider`, `KavenegarSmsProvider` | `SMS_PROVIDER=console\|kavenegar` |
| Payments | `PaymentGateway` (`booking/payment-gateway.ts`) | `PAYMENT_GATEWAY` | `MockPaymentGateway`, `ZarinpalGateway` | `PAYMENT_GATEWAY=mock\|zarinpal` |
| Push | `PushProvider` (`push/push.provider.ts`) | `PUSH_PROVIDER` | `ConsolePushProvider`, `WebPushProvider` | `PUSH_PROVIDER=console\|webpush` |
| Error tracking | `ErrorTrackingService` (`error-tracking/error-tracking.service.ts`) | `ERROR_TRACKING_PROVIDER` | `LoggerErrorTrackingService` (structured-JSON-to-`Logger` only; no real Sentry/APM implementation exists yet) | none yet — always `LoggerErrorTrackingService` until a real provider is added |
| Product analytics | `AnalyticsProvider` (`analytics/analytics.provider.ts`), wrapped by `AnalyticsService` (call sites use the service, never the provider directly) | `ANALYTICS_PROVIDER` | `ConsoleAnalyticsProvider` (structured-JSON-to-`Logger` only; no real Mixpanel/Amplitude/PostHog account exists yet) | none yet — always `ConsoleAnalyticsProvider` until a real vendor is added |
| AI / LLM | `AiProvider` (`ai/ai.provider.ts`), wrapped by `AiService` (call sites would use the service, never the provider directly) | `AI_PROVIDER` | `UnconfiguredAiProvider` (throws `NotImplementedException`; no real OpenAI/Anthropic/etc. account exists yet) | none yet — always `UnconfiguredAiProvider` until a real vendor is added. **`AiModule` is not imported anywhere** — no feature calls this yet; see [27-ai-foundation.md](./docs/technical-overview/27-ai-foundation.md) |

Default local/test config runs everything through the console/mock implementations — **no real Zarinpal account or SMS credits needed for dev.** If you add a new external integration, follow this exact pattern rather than hard-wiring a client.

### Error handling & config

- Throw NestJS built-ins directly from services (`NotFoundException`, `BadRequestException`, `ConflictException`, `ForbiddenException`) — NestJS's default mapping to HTTP status is relied on. `GlobalExceptionFilter` (`error-tracking/global-exception.filter.ts`, registered as `APP_FILTER`) is a catch-all that subclasses `@nestjs/core`'s `BaseExceptionFilter` and calls `super.catch()` to produce the *exact same* response NestJS's default handling would — its only added behavior is capturing 5xx/unknown exceptions through `ErrorTrackingService` (with `requestId`/`userId`/`route`) before that response goes out. Ordinary sub-500 business-rule throws (`NotFoundException`, `BadRequestException`, etc.) are deliberately NOT captured — see the filter's own doc comment.
- `@nestjs/config`, global module, env file picked by `NODE_ENV` (`.env.test` vs `.env`). **No schema validation** — services call `config.getOrThrow('KEY')` (throws at runtime if missing) or `config.get('KEY', default)`. Be careful introducing a new required env var — nothing will catch a missing one until the code path runs.

### Observability

- `GET /api/health` (`health/health.controller.ts`) does real dependency checks, not a bare liveness stub — `SELECT 1` against Postgres and Redis `PING`, each with a 2s timeout, returning `{status:'ok',db:'ok',redis:'ok'}` (200) or `{status:'error',...}` (503) per-dependency. Safe for an orchestrator's restart-on-unhealthy policy.
- Every request gets an `X-Request-Id` (generated, or reused from a trusted incoming header) via `common/request-logging.middleware.ts`, echoed on the response and appended to one access-log line per request (`main.ts`; deliberately NOT mirrored into the e2e test harness — see the middleware's own doc comment for why).
- `AlertsService` (`alerts/`) is the one place money-critical or job-critical failures get **paged**, not just logged: every alert becomes an admin-panel notification, `severity: 'critical'` also SMS's `ALERT_ADMIN_PHONE`. Dedup'd per key/window so a repeatedly-failing condition doesn't spam. Used by `CronJobRunner` (any job failure), payment/refund failure paths, and per-salon invoice-generation failures.
- `AnalyticsService.track(event, properties?, context?)` (`analytics/`, see the abstractions table above) is the one seam for product-analytics events — call sites never talk to `AnalyticsProvider`/a vendor SDK directly. Every call is genuinely fire-and-forget (`void this.analytics.track(...).catch(() => {})`, never awaited inline) so an analytics outage can't add latency or fail the real operation. Only a small seed set from the booking funnel is wired today (`booking_started`, `booking_confirmed`, `booking_cancelled`, `payment_succeeded` — see `booking/bookings.service.ts`/`booking/payments.service.ts`), not a full event catalog. `properties`/`context` must never carry a phone number, payment authority, JWT, OTP, or other credential/PII — bare id references (`userId`, `bookingId`, `salonId`) are fine, the review responsibility is on each call site.

### API route conventions

- Global prefix `/api` (`app.setGlobalPrefix('api')` in `main.ts`).
- `/api/{resource}/mine` — the authenticated caller's own resource (customer side), e.g. `GET /api/bookings/mine`.
- `/api/salons/mine/{resource}` — the authenticated caller's own salon (provider side), e.g. `GET /api/salons/mine/services`, `PATCH /api/salons/mine/bookings/:id`.
- `/api/admin/{resource}` — admin-only, `@Roles('admin')`.
- Action endpoints are `POST /{resource}/:id/{action}` (e.g. `POST /api/bookings/:id/cancel`), not query params or verbs in the resource name.

---

## Architecture — `apps/user-app`

### Directory structure (Nuxt 4, under `app/`)

```
app/
├── pages/            file-based routes: index.vue, login.vue, salons/[slug].vue,
│                     booking/[slug]/[serviceId].vue, bookings/[id].vue, profile.vue, admin/featured.vue
├── components/       feature-organized: booking/, layout/, salon/ — PascalCase, global auto-import
│                     with pathPrefix:false (SalonCard.vue → <SalonCard>, not <SalonSalonCard>)
│                     client-only components use the .client.vue suffix (SalonMap.client.vue)
├── composables/      useApi.ts, useTheme.ts, useToast.ts, usePushSubscription.ts
├── stores/           session.ts (single Pinia store)
├── layouts/          default.vue (with AppHeader), bare.vue
├── middleware/        auth.global.ts (runs on every route), admin.ts
├── utils/            route-guard.ts, geo.ts, slot-format.ts, gender-map.ts, city-centers.ts, types.ts
├── assets/css/       main.css (Tailwind + Vazirmatn), tokens.css (light/dark CSS custom properties)
├── providers/         arvancloud.ts (custom @nuxt/image provider)
└── sw.ts             service worker entry (Workbox + push), compiled via @vite-pwa/nuxt injectManifest
```

There's a minimal `server/` directory: a hand-rolled, multi-file XML sitemap (no third-party sitemap module) — `server/routes/sitemap.xml.ts` and `sitemap-index.xml.ts` both serve a sitemap index listing `sitemap-salons-N.xml`/`sitemap-posts-N.xml`, computed from each API sitemap source's own paginated `total`/`pageSize` (`server/utils/sitemap-index.ts`). Those `sitemap-salons-N.xml`/`sitemap-posts-N.xml` URLs aren't a file-based dynamic route — h3's router only matches a `:param` when it's an entire path segment, not embedded alongside literal text, so `nuxt.config.ts`'s `nitro:config` hook instead pre-registers a bounded range of static routes (`N = 1..MAX_SITEMAP_PAGES`) all pointing at one shared handler per source (`server/handlers/sitemap-salons-page.ts`, `sitemap-posts-page.ts`), which recovers the requested page number by parsing the request path itself and fetches/renders only that page's slice from the API (`GET /sitemap/salon-slugs?page=`, `/sitemap/blog-posts?page=`, 5,000 URLs/page — well under the sitemap protocol's 50,000-per-file ceiling). Pure XML-building/pagination helpers live in `server/utils/sitemap.ts`. Beyond that, the app has no SSR API routes of its own; all data comes from `@gheychi/api` at a separate origin.

### Data fetching

All API calls go through the **`useApi()` composable** (`app/composables/useApi.ts`), which wraps Nuxt's `$fetch` and never throws:

```typescript
const { data, error } = await apiFetch<SessionUser>('/auth/me', { silent: true, redirectOn401: false })
```

- On the server, it manually forwards the incoming request's `cookie` header (`useRequestHeaders(['cookie'])`) to the API, since the API is a different origin and SSR fetches don't carry the browser's cookies automatically.
- 401 → redirects to `/login` by default (opt out with `redirectOn401: false`).
- Non-401 errors push a toast via `useToast()` by default (opt out with `silent: true`).

**Always use `useApi()` rather than calling `$fetch`/`useFetch` directly** — it's the only place cookie-forwarding and the 401/toast policy are implemented.

### State & auth

Single Pinia store, `useSessionStore` (`app/stores/session.ts`): `{ user: SessionUser | null, checked: boolean }`, where `SessionUser` is `{ id, phone, name, gender, role }`. **No token in Pinia state** — same HttpOnly-cookie-only model as the API. Hydrated once per session by `middleware/auth.global.ts`, which probes `/auth/me` and redirects to `/login` unless the route is public (`app/utils/route-guard.ts` → `isPublicRoute()`; currently `/login` and `/salons*`).

### Styling & theming

Tailwind v4 (via `@tailwindcss/vite`, no `tailwind.config`) + CSS custom properties in `assets/css/main.css` for two themes — light "Teal Trust" (`--color-accent: #0EA89B`) and dark "Bold Editorial" (`--color-accent: #7A3FF2`). Toggle via `useTheme()` (cookie-persisted), synced with `@custom-variant dark`. Classes reference tokens directly: `bg-(--color-surface-card)`, `text-(--color-accent)`. Font is `@fontsource-variable/vazirmatn` (self-hosted, Persian-optimized).

**No i18n library** — the app is Persian/RTL only (`lang="fa" dir="rtl"` set in `nuxt.config.ts`). Don't reach for `vue-i18n`/`@nuxtjs/i18n` here; there is exactly one locale by design.

### PWA & push

`@vite-pwa/nuxt` with `injectManifest` strategy, service worker source at `app/sw.ts` (precaching + `push`/`notificationclick` handlers). Push subscription flow lives in `usePushSubscription()` — converts the VAPID key, `POST /push/subscribe`, `DELETE` to unsubscribe, rolls back client-side state on API failure, and detects support only in `onMounted` (avoids SSR hydration mismatches).

### Maps

`SalonMap.client.vue` — Leaflet (bundled npm package) + CARTO's free Voyager tile layer, no API key or paid SDK involved, always client-only and lazy-loaded (never SSR'd). Marker popups link out to the customer's own maps app for directions (`nshn.ir/?lat=&lng=` for Neshan, `google.com/maps/dir/?api=1&destination=` for Google Maps) rather than routing turn-by-turn navigation in-app. `SalonPinPicker.vue` (provider-panel's onboarding/settings location picker) uses the same Leaflet + CARTO setup for drag-to-set-pin.

### Testing

- **Unit** (`test/unit/*.spec.ts`, Vitest `environment: 'node'`) — pure functions: `geo.spec.ts`, `slot-format.spec.ts`, `gender-map.spec.ts`, `route-guard.spec.ts`.
- **Component/composable** (`test/nuxt/*.spec.ts`, Vitest `environment: 'nuxt'` via `@nuxt/test-utils`) — anything touching Nuxt context: `useApi.spec.ts`, `SalonCard.spec.ts`, `SlotPicker.spec.ts`, `booking-confirm.spec.ts`, `auth.global.spec.ts`.
- **E2E** (`e2e/*.spec.ts`, Playwright, `workers: 1` per app — serialized because tests share Redis-backed OTP state) exists in all three frontend apps, not just user-app: user-app has `01-happy-path.spec.ts` + `02-admin-featured-badge.spec.ts`; provider-panel has `01-onboarding.spec.ts` + `02-bookings-status.spec.ts`; admin-panel has `01-approve-salon.spec.ts`. All three run in CI (`.github/workflows/ci.yml`), none exercise a flow spanning more than one app (a booking created via user-app is never followed onto provider-panel/admin-panel in the same test — a real, currently-open coverage gap for that specific bug class).
  - **DB prep is a `test:e2e` pretest step (`node e2e/prepare-db.cjs && playwright test`), not Playwright's `globalSetup` option** — Playwright gives no ordering guarantee between `globalSetup` and `webServer` startup (confirmed empirically: the webServer-spawned API process raced ahead of a schema reset/migration happening inside `globalSetup`, on real runs, in all three apps). `prepare-db.cjs` is deliberately plain CommonJS, not TypeScript, so it runs directly via `node` with no loader.
  - **Each suite resets its own `gheychi_e2e` database** (`docker/postgres-init/02-e2e-db.sql` provisions it on a fresh volume; an existing checkout needs a one-time `CREATE DATABASE gheychi_e2e;`), never the shared `gheychi` dev database `pnpm dev` uses — `prepare-db.cjs` `DROP SCHEMA CASCADE`s its target on every run, so sharing the dev DB would destroy real local dev data on every local e2e run.

---

## Domain Model Quick Reference

| Entity | Key states/fields |
|---|---|
| `User.role` | `customer` \| `provider` \| `admin` — becoming a provider is automatic (`UsersService.promoteToProvider()`) when a user creates a salon, not a separate admin step |
| `Salon.status` | `pending` (default on create) → `approved` \| `rejected` \| `suspended`, via `PATCH /api/admin/salons/:id/status` (admin-only, Plan 6); a `rejected` salon can flip back to `pending` via `POST /api/salons/mine/resubmit` (provider-side). Only `approved` salons appear in public search/profile queries |
| `Salon.genderTarget` | `women` \| `men` — every search/listing result respects this filter, including featured/ad-boosted results, with no bypass |
| `Booking.status` | `pending_payment` → `confirmed` → `completed` \| `cancelled_by_user` \| `cancelled_by_salon` \| `expired` \| `no_show` |
| `Payment.status` | `initiated` → `paid` → `refund_pending` → `refunded` \| `failed` — refunds are **real**: `refund_pending` means a refund is owed and being processed; `refunded` means Zarinpal confirmed it (`refund_ref_id` stored). Producers: `cancel()` (inline attempt), reconciliation's late-capture branch; `RefundRetryJob` (cron, 5 min) self-heals failures and escalate-logs after 24 h. Requires `ZARINPAL_ACCESS_TOKEN` in zarinpal mode; the refund contract cannot be sandbox-tested and likely targets Zarinpal's legacy REST API — execute `docs/deployment/ZARINPAL-REFUND-VERIFICATION.md` before production refunds. `RefundRetryJob`'s 24 h escalation and the other operator signals now also page via SMS (`apps/api/src/alerts/`) |
| `Review` | Verified-booking-only (DB `UNIQUE` on `booking_id`), one review per completed booking, editable/deletable within a 72h window (`PATCH`/`DELETE /api/reviews/:id`), moderation is **reactive** (`published` immediately, admin can flip to `rejected` after the fact — no pre-publish queue) |
| One salon per owner | `Salon.ownerId` is looked up via `findOneBy({ ownerId })` — the data model does not support multiple salons per provider account |
| `Referral.status` | `awaiting_qualifying_event` → `reward_granted` \| `partially_granted` (one beneficiary side granted, the other's reward kind not supported at the time — a transient state as of the referral system's slice 6, not a durable dead end) \| `expired` \| `cancelled` (admin-only, only from `awaiting_qualifying_event`) — reward terms are snapshotted onto the row at redemption time and never re-read live, even if the admin later changes `referral_reward_types` |
| `WalletTransaction` | Append-only ledger, never a mutable balance column — `wallet_balances` is a row-locked, recompute-under-lock cache. A debit is capped at the available balance (never negative); any shortfall is recorded, never silently absorbed |
| `FinancialTransaction` / `Invoice` | `invoicing/` module: `financial_transactions` is an append-only per-booking commission ledger (`commissionPercent`/`commissionAmount` FROZEN at write time — a later platform commission-rate change never retroactively alters a past row). `MonthlyInvoiceGenerationJob` (daily cron) rolls unlinked ledger rows into one `Invoice` per (salon, Jalali month), `status`: `issued` → `partially_paid` \| `paid`, `void`. Admin records an already-made bank transfer via `PATCH /api/admin/invoices/:id/payment` (there's no payout infrastructure to initiate one); `GET /api/salons/mine/earnings` reads the same ledger, never a live payments+rate recomputation |

---

## Docs, Specs & Planning Workflow

This repo is developed via the **superpowers skill pipeline** — brainstorming → writing-plans → subagent-driven-development. Before starting any non-trivial feature, check whether a design/plan already exists:

- `docs/superpowers/specs/` — approved design docs (one per plan), e.g. `2026-07-04-gheychi-marketplace-design.md` (original full-product spec), `2026-07-05-plan-4-user-app-frontend-design.md`.
- `docs/superpowers/plans/` — the executed implementation plans, one per numbered plan (`plan-1-foundation-backend-core.md` through `plan-8-blog-cms.md`, dated filenames like `2026-07-10-plan-8-blog-cms.md`). These record what was actually built, including task-by-task completion notes and any deviations from the design doc.
- `docs/phase1-audit.md` / `docs/phase2-plan.md` — outside the `superpowers/` naming convention, but the same kind of record, covering an earlier correctness/security audit and a maintainability/scalability pass (shared `common/` utilities, cities table, cursor pagination, cron locking, storage reconciliation, per-user notification reads).
- A later, broader production-readiness hardening pass (reliability, security, scalability, architecture, observability, performance, API/frontend consistency, testing — `CronJobRunner`, the real health check, request-id correlation, `trusted-image-upload.ts`, the pagination-shape split, `MAX_*_LISTED` caps, etc.) shipped without a dedicated spec/plan doc — its record is the commit history, not a file under `docs/`. Worth writing up retroactively if a `specs/`/`plans/` doc would help onboard the next person touching this surface.

New feature work should follow the same shape: brainstorm to a spec in `specs/`, get it approved, turn it into a task-by-task plan in `plans/`, then execute. Don't skip straight to implementation for anything beyond a small bug fix.

---

## Known Gaps / Future Plans

Carried forward across every plan shipped so far — check these are still accurate before assuming otherwise:

- **Provider Panel (Plan 5) and Admin Panel (Plan 6) are both built.** `apps/provider-panel` (port 3004) covers onboarding, bookings, services, hours, photos, reviews, earnings, and a Salon Settings/resubmit flow. `apps/admin-panel` (port 3005) covers salon approvals, review moderation, categories, users/salons search+suspend, and platform config editing.
- **Salon approval no longer requires a manual DB update.** `PATCH /api/admin/salons/:id/status` (approve/reject/suspend, reason required for reject/suspend) plus `POST /api/salons/mine/resubmit` (provider side, flips `rejected` back to `pending`) close this gap — see the README's "Admin panel (Plan 6)" section for the full endpoint list.
- **No salon photo upload path** was the old gap here — it's closed: `POST /api/salons/mine/photos` (Plan 5) lets a provider upload/manage photos via a swappable `StorageProvider` (`local`/`s3`).
- **Plan 7 (platform hardening) closed the six trust-and-safety gaps** previously listed here: an admin audit log (declarative `@AuditAction` decorator + interceptor on every admin mutation, browsable via `GET /api/admin/audit-log` and the admin-panel's Audit Log page), a first-admin bootstrap script (`pnpm --filter @gheychi/api create-admin 09xxxxxxxxx`, idempotent — pnpm 9 leaks a `--` separator into forwarded args on some invocations, so the script tolerates both `create-admin 09...` and `create-admin -- 09...`), a verified-customer report flow end-to-end (user-app salon/review report form → `POST /api/reports` → admin-panel queue at `/reports`), category delete with restrict semantics (`DELETE /api/admin/categories/:id`, 409 when any salon service references it), user-suspend → salon cascade (`salons.suspended_cause` distinguishes `admin` suspensions from `owner_suspended` cascades so reactivation only restores the latter), and a polled admin notification queue (`salon_resubmitted` / `report_created`, bell badge in the admin-panel header). See `docs/superpowers/plans/2026-07-10-plan-7-platform-hardening.md`.
- **Fixed: an admin could previously approve a pending salon whose owner is suspended.** `PATCH /api/admin/salons/:id/status` now looks up the salon's owner via `UsersService.findById()` before applying an `approved` status change and throws `ConflictException` (409) if the owner's `status` is `'suspended'` — the update is never applied, so the salon stays in its prior state. No frontend change was needed: `admin-panel`'s generic `useApi()` error handling already toasts the exception's message and correctly skips the `updated` emit when `data` is `null`. Covered by a unit test (`admin-salons.controller.spec.ts`) and an e2e test (`admin-salon-status.e2e-spec.ts`) that suspends a real owner account and asserts the 409.
- **The salon-side effect of a user-suspension cascade is not separately audited.** Suspending/reactivating a user writes one `user.status.set` audit row; the cascaded salon suspension/restoration inside the same transaction has no corresponding audit row. Deliberate — reconstructing a salon's status timeline from audit rows alone has this gap.
- **Admin notifications are one shared queue, not per-admin state.** `admin_notifications.read_at` is a single column on the row itself — one admin marking a notification read marks it read for every admin. Deliberate MVP cut.
- **Blog/content CMS shipped in Plan 8.** A lean `apps/api/src/content/` module (posts + admin-managed categories, `draft` → `published` workflow with conditional-update race guards, cover images through the existing `StorageProvider`, a sitemap source for published articles), an admin-panel Markdown editor with live preview at `/blog`, and public SSR pages in the user-app at `/blog` and `/blog/[slug]`. **XSS safety is by construction:** posts store raw Markdown and both frontends render it through their own `markdown-it` utility configured `html: false`, so raw HTML never parses — each utility carries an invariant test pinning that, and the only two `v-html` bindings in the codebase (admin preview pane, user-app article body) are sanctioned solely by it. Deliberate cuts recorded in the spec (`docs/superpowers/specs/2026-07-10-plan-8-blog-cms-design.md`): no comments or reader interaction, no scheduled publishing, no RSS, no post revisions, and no redirects when a published post's slug changes (the editor warns that editing a published slug changes the URL; unpublish is the soft removal path) — the same risk applies to renaming a category without pinning its slug, which changes `/blog?category=<slug>` URLs. Of the smaller fast-follow items from this plan, three were closed on 2026-07-17: manually-edited slugs are now sent atomically in the create POST (`CreateBlogPostDto.slug`, optional — a 409 creates nothing and shows a persistent inline slug error in the editor, both create and edit modes); storage best-effort deletes (salon photos and blog covers) stay fire-and-forget but log every failure with the orphaned key and owner; and a post with neither `metaDescription` nor `excerpt` now derives its `description` meta tag from the markdown body (`apps/user-app/app/utils/markdown-excerpt.ts` — a post with an effectively-empty body still emits none). Still open by choice: an empty-string `?category=` on the public blog list is treated as no-filter, not as an empty-slug match. Two items from this list were closed in a follow-up fix: the salons and blog sitemap sources were capped at 50,000 URLs each (Google's single-sitemap-file limit) — **since superseded**: both sources are now paginated (`?page=`, 5,000/page) behind a real multi-file sitemap index (`/sitemap-index.xml` listing `sitemap-salons-N.xml`/`sitemap-posts-N.xml`; `/sitemap.xml` still resolves, now serving the index), so there's no longer a 50,000-row ceiling on either domain — see the `server/` paragraph above, and `salons/[slug].vue`/the booking page (`booking/[slug]/[serviceId].vue`) now carry the same root `v-if="page"` guard the blog article page already had, closing the Suspense pre-render-pass crash on their `createError(404)` paths (each has a regression test asserting a clean 404 rejection with no unhandled render error).
- **Refunds are real but production-unverified — and the contract is likely stale.** 2026-07-17 research found the implemented `refund.json` call matches Zarinpal's *legacy* REST refund contract (de-documented ~2023); the current official refund API is a GraphQL `AddRefund` mutation (different host, needs `session_id` not `authority`, requires an amount, response has no numeric `code`), and Zarinpal permits one refund request per transaction, which undermines the gateway's crash-retry idempotency assumption. **No sandbox covers refunds** (the old "verify in sandbox" note was impossible as written) — the exact production verification procedure, including how to settle every open question with ~two minimum-value test payments, is `docs/deployment/ZARINPAL-REFUND-VERIFICATION.md`. Until it is executed, refunds fail safe: payments stay `refund_pending` and escalate to a human. **Money-critical operator alerting shipped in Plan 9** (spec: `docs/superpowers/specs/2026-07-16-money-critical-alerting-design.md`): `AlertsService.raise()` routes every money-critical condition (stuck refund, refused refund, captured money on a dead booking, orphaned authority, persist failures) to in-app admin notifications, with SMS paging for `critical` severity to `ALERT_ADMIN_PHONE` (comma-separated list supported), deduped per condition via Redis `SET NX EX` (fail-open) so the 5-minute crons can't storm. Hardening grafted 2026-07-17 from an adversarial review: the dedup claim is released when nothing was delivered (so a transient failure can't mute an alert for the full window), stuck-refund escalations re-page daily instead of every 6 h, and an hourly SMS circuit breaker (`ALERT_SMS_HOURLY_CAP`, default 30) bounds cost during mass incidents. Non-money `logger.error` calls (audit/notification emit failures) remain log-only by design.
- **Salon showcase shipped 2026-07-17** (spec: `docs/superpowers/specs/2026-07-17-salon-showcase-design.md`, record: `docs/superpowers/plans/2026-07-17-salon-showcase.md`): Instagram-style salon **stories** (images only, 24 h TTL as a DB-clock SQL predicate — never a state flip; hourly GC cron with a 1 h grace, open-report evidence pinning, and storage-first delete order so failures self-heal; cap 10 active), **profile** fields on `salons` (`tagline`/`about`/`instagram_handle` — plain text, no markdown, `''→null` clears via `PATCH /api/salons/mine`), and a **portfolio** (`portfolio_items`, cap 40, optional service link, `MAX(sort_order)+1` inserts). Provider management under `salons/mine/stories|portfolio`; public read on `salons/:slug/stories|portfolio` (approved-gated, published+unexpired only); `SearchResult.hasActiveStory` drives story rings on salon cards; admin remove/restore via `PATCH /api/admin/stories|portfolio/:id/status` (audited, reversible — no hard delete). Reports extend to story/portfolio targets with a `reports.target_type` discriminator that survives the `ON DELETE SET NULL` cascade — the open-report dedup index deliberately excludes orphaned content reports (a provider deleting reported content must never 23505). Deliberate cuts in the spec: no video, no cross-salon story feed, no view counts or server-side seen state, hardcoded TTL/caps, no pre-publish moderation queue; named fast-follow: before/after work-sample comparison slider.
- **Production deployment shipped in Plan 9.** Docker images for all four apps (`Dockerfile` per app, `turbo prune --docker` multi-stage builds), a `docker-compose.prod.yml` adding Caddy (automatic HTTPS + baseline security headers) plus the four app containers to Postgres/Redis, and a GitHub Actions workflow that runs the full test suite on every push/PR and builds+pushes images to GHCR on `main`. Deploying those images to the VPS stays a manual `docker compose pull && up -d` step — see `docs/deployment/DEPLOY.md`. **Database backup automation shipped as a follow-up.** A `backup` service in `docker-compose.prod.yml` (built from `docker/backup/`, `postgres:16-alpine` + the MinIO Client) dumps Postgres daily to the same S3-compatible bucket under a `backups/` prefix, keeps 14 days, and the restore path is documented and was actually exercised (not just written) — see `docs/deployment/DEPLOY.md`'s "Restoring a backup" section and `docs/superpowers/specs/2026-07-14-db-backup-automation-design.md`. Along the way this surfaced and fixed a real pre-existing gap: `DEPLOY.md`'s one-time setup never called out that production `.env` needs `DB_HOST=postgres`/`REDIS_HOST=redis` overrides (Plan 9's own validation never exercised a live `docker compose up -d`, only `config` syntax checks). No point-in-time recovery (WAL archiving) — daily full dumps only, accepted up-to-24h data-loss window. No automated alerting on backup failure — matches the existing accepted cut for payment-reconciliation errors. The `api` production image deliberately keeps devDependencies and full source (not just `dist/`) so the existing `pnpm migration:run` script works unchanged via `docker compose exec` — a size/simplicity tradeoff, not an oversight. **The intermittent `apps/user-app/e2e/01-happy-path.spec.ts` CI flake is resolved** (previously marked `continue-on-error` in `.github/workflows/ci.yml`, since removed). True root cause, found via direct browser instrumentation (monkey-patching `window.fetch`/`Storage.prototype.setItem` plus reading Vite/Nuxt source): on a cold `nuxt dev` process, Vite's dependency optimizer only discovers a lazily-loaded route's dependencies the first time that route's code is actually imported by the *browser* — dynamic imports aren't part of Vite's initial crawl. Every route in this test (`/`, the salon page, the booking page) is visited for the first time that session via an in-app client-side navigation rather than a fresh page load; if that first import triggers the optimizer to discover new, not-yet-bundled dependencies, the dev server sends a `full-reload` WebSocket message, and Vite's client handles it with a bare, path-less `location.reload()` (`vite/dist/client/client.mjs`'s `pageReload`/`full-reload` case). If that fires before Vue Router's own `history.pushState` for the new route has committed, the reload lands back on the *old* path instead of the new one — exactly matching every previously-observed symptom (a hard reload back to the previous page moments after a successful in-app navigation, with a valid session cookie throughout, since the reload's own SSR pass always finds the user still logged in). This is exclusively a Vite dev-server/HMR artifact with no equivalent machinery in a production build. Two real, independently-valuable bugs found during the earlier investigation phase are still in place as general hardening even though neither was the actual cause: the `auth.global.ts` stale-probe race (`session.checked` re-check guard) and `login.vue`'s per-step `:key`s. The actual fix has two parts: (1) `nuxt.config.ts`'s `vite.server.warmup.clientFiles` for `/` gives the optimizer a head start during dev-server boot, reducing how often the race is even possible; (2) since that alone can't *guarantee* the optimizer finishes before a given first-time navigation — confirmed empirically, it still failed under worst-case fully-cold conditions (API server cold-compiling concurrently) even with a generous explicit wait — `01-happy-path.spec.ts` now tolerates the known-harmless reload directly via an `expectUrlTolerantOfDevReload()` helper at every first-time client-side navigation: on a timeout, it re-navigates and asserts again, so a *real* navigation/auth failure still fails the test for real rather than being silently masked. Verified with 12/12 consecutive passes under fully-cold conditions (API `dist/`, `.nuxt/`, and `node_modules/.vite` all cleared before every run) locally, matching a genuine fresh CI checkout.
- **Coupon codes and per-service discounts shipped 2026-07-19.** `apps/api/src/coupons/` — salon-scoped coupons (`salons/mine/coupons`, provider-managed) and platform-wide coupons (`admin/coupons`, admin-managed), percent-off, optional expiry, optional total-redemption cap, `coupon_redemptions` `UNIQUE(coupon_id, user_id)` enforcing one redemption per user per code. `SalonService.discountPercent` (1–100, nullable) is a direct per-service discount. `POST /coupons/validate` previews the resolved price/deposit before checkout; the actual booking-creation transaction (`BookingsService.createHold`) re-validates and redeems atomically. **Discount resolution rule** (`apps/api/src/booking/discount.util.ts`): the larger of the service's own discount and an applied coupon's discount wins — never stacked. No coupon-usage UI in the admin/provider coupon list ever double-counts a redemption a customer already used, since the DB unique constraint is the source of truth, not an app-level check alone.
- **Referral & Rating System shipped 2026-07-22** (spec: `docs/superpowers/specs/2026-07-21-referral-and-rating-system-design.md`, record: `docs/superpowers/plans/2026-07-22-referral-and-rating-system.md`). Built as 6 independently-shippable, sequentially-verified slices: (1) a `Worker` concept (salon staff, backed by a real `User` account) with per-worker ratings (`worker_ratings`, submitted atomically alongside the existing salon `Review`) and new editable/deletable reviews (`PATCH`/`DELETE /api/reviews/:id`, 72h window); (2) a wallet ledger (`wallet_balances`/`wallet_transactions`, append-only, row-locked, never-negative — `WalletService.credit()/debit()`); (3) one lifetime referral code per person (not per-role — a deliberate simplification), `referral_reward_types` (admin-configurable per referrer kind: user/salon_owner/worker, all ship `enabled=false` with placeholder reward values), `referrals` tracking rows, `referral_type` resolved dynamically at redemption time from the referrer's current role (worker → salon_owner → user precedence), then frozen forever (never re-derived); (4) reward granting (`tryGrantReward`, wired to booking-completion and an hourly payment-paid sweep honoring a 72h hold-back buffer) and reversal on confirmed refund (`reverseIfNeeded`, wallet debits capped at available balance with any shortfall alerted via the existing `AlertsService`); (5) discount-kind rewards issued as literal, single-recipient rows in the *existing* `coupons` table (`coupons.issued_to_user_id`) rather than a parallel mechanism, reusing the coupon feature's redemption/no-stacking logic verbatim; (6) `fixed_discount` rewards (`coupons.discount_fixed_amount`, mutually exclusive with `discount_percent` via a DB CHECK), via a `resolveBestPrice` extension to `discount.util.ts` that compares actual resulting prices rather than raw percentages — the one slice that touches the original coupon feature's tested code, shipped with zero regressions to it (independently re-verified twice). A `partially_granted` referral status (not in the original design doc, added during implementation — see the spec's "Implementation Addenda") represents "one beneficiary side granted, the other side's kind not yet supported" during the slice rollout; as of slice 6 every reward kind is supported, so this is now a transient state, not a durable dead end. Two real money-adjacent bugs were caught and fixed by each slice's adversarial verify pass rather than shipped: an unlocked `max_referrals_per_referrer` count-then-insert that let a forced 8-way concurrent redemption blow past a cap of 2 (fixed with a row lock, re-proven exactly-2 under the same adversarial probe), and a whitespace-only admin wallet-adjustment reason slipping past `@IsNotEmpty()` (fixed with a trim-before-validate). Deliberate cuts, all recorded as explicit product decisions in the spec rather than oversights: no worker SMS invite flow yet (adding a worker requires already knowing a phone number that resolves via `findOrCreateByPhone`), wallet balance is accrue-only (no spend-at-checkout path), no referral campaigns/tiers/multi-level referrals, no IP/device fraud-signal capture, no automated leak-report for the one accepted non-reversible case (a discount reward already redeemed surviving its qualifying booking's later refund — marked via `referral_rewards.reversal_reason` set with `status` left at `'granted'`, distinguishable from both a fresh grant and a real reversal). Real reward amounts/percentages are an admin data-entry task via the shipped Referral Settings screen (`/referrals/settings`), not a code change — every reward type ships disabled with zero-value terms until an admin configures and enables it.
