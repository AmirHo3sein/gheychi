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
- **Background jobs** live in their owning module as `@Injectable()` classes with `@Cron()` on a `handleCron()` method that delegates to a plain `async run()` (keeps the logic independently callable from tests). Registered as providers in the module. `handleCron()` always goes through `CronJobRunner.run(jobName, fn, {lockTtlMs?, warnAfterMs?})` (`common/cron-job-runner.service.ts`, `@Global()` via `CommonModule`) — wraps `run()` in `CronLockService`'s distributed Redis lock (no overlapping runs across instances), pages `AlertsService` on an uncaught failure, and raises a non-cancelling "still running" warning past `warnAfterMs`. All 11 current jobs (`booking-expiry`, `booking-approval-expiry`, `booking-reminder`, `payment-reconciliation`, `refund-retry`, `referral-expiry`, `referral-grant`, `story-cleanup`, `storage-reconciliation`, `invoicing/monthly-invoice-generation`, `backup-monitoring/backup-staleness-check` — `grep -rn "@Cron(" apps/api/src` is the source of truth) go through it — a new job should too, not call `run()` directly from `handleCron()`.

### Auth & guards

- `AuthGuard` (`auth/auth.guard.ts`) is registered **globally** as an `APP_GUARD` in `app.module.ts` — every route requires a session by default. It reads the JWT from the `session` HttpOnly cookie, verifies it, loads the user, attaches `req.user`; throws `UnauthorizedException` if missing/invalid, `ForbiddenException` if the user is suspended. A route opts **out** with `@Public()` (`auth/public.decorator.ts`, checked first so a public route never touches the cookie) — applying it is a reviewable security decision, and `route-guard-audit.spec.ts` pins every `@Public()` route against an allowlist, counts `@Controller(` decorators exactly, and asserts `RolesGuard`+`@Roles('admin')` on every `admin/*` route and `SalonOwnerGuard` on every `salons/mine*` route (single exception: `GET /salons/mine`, the onboarding probe). Reviewing auth: grep for `@Public()`, not for `@UseGuards(AuthGuard)`.
- `RolesGuard` (`auth/roles.guard.ts`) + `@Roles('admin')` decorator — reads required roles via `Reflector`, compares to `req.user.role`, throws `ForbiddenException`.
- `SalonOwnerGuard` (`salons/salon-owner.guard.ts`) — runs after the global `AuthGuard`; looks up the caller's own salon and attaches `req.salonId`. 404s if the caller doesn't own a salon.

```typescript
@Controller('salons/mine/services')
@UseGuards(SalonOwnerGuard)     // AuthGuard is global; req.user AND req.salonId both available
export class SalonServicesController { ... }
```

(A few controllers still spell `@UseGuards(AuthGuard, SalonOwnerGuard)` explicitly — redundant, harmless.) Tokens are **never** exposed to JS — HttpOnly cookie only, matching the frontend's model (see user-app section below).

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
| SMS | `SmsProvider` (`sms/sms.provider.ts`) | `SMS_PROVIDER` | `ConsoleSmsProvider`, `KavenegarSmsProvider`, `PayamakYabSmsProvider` (a plain SOAP/.asmx panel — hand-rolled envelope via `fetch`, no SOAP client dependency; needs `PAYAMAKYAB_USERNAME`/`PAYAMAKYAB_PASSWORD`/`PAYAMAKYAB_SENDER`), `FaragostareshRelaySmsProvider` (**TEMPORARY stopgap, see that file's own doc comment** — PayamakYab's `SendSimpleSMS` accepts every send but the panel blocks actual delivery (`GetDelivery`→9), and its `SendSms` method 100s ("not authorized") from our server's IP even with credentials confirmed working from the panel owner's own server — relays through a small PHP endpoint he already runs, presumably IP-allowlisted, until he authorizes our IP directly; needs `FARAGOSTARESH_RELAY_TOKEN` (`getOrThrow` in `SmsModule` — the api refuses to boot in this mode without it). Switch back to `SMS_PROVIDER=payamakyab` once that's resolved — don't forget this exists) | `SMS_PROVIDER=console\|kavenegar\|payamakyab\|faragostaresh-relay` |
| Payments | `PaymentGateway` (`booking/payment-gateway.ts`) | `PAYMENT_GATEWAY` | `MockPaymentGateway`, `ZarinpalGateway` | `PAYMENT_GATEWAY=mock\|zarinpal` |
| Push | `PushProvider` (`push/push.provider.ts`) | `PUSH_PROVIDER` | `ConsolePushProvider`, `WebPushProvider` | `PUSH_PROVIDER=console\|webpush` |
| Error tracking | `ErrorTrackingService` (`error-tracking/error-tracking.service.ts`) | `ERROR_TRACKING_PROVIDER` | `LoggerErrorTrackingService` (structured-JSON-to-`Logger`), `SentryErrorTrackingService` (real `@sentry/node`, `skipOpenTelemetrySetup: true` + `tracesSampleRate: 0` since this app's own OTel SDK in `tracing.ts` already owns tracing — Sentry here is error capture only) | `ERROR_TRACKING_PROVIDER=logger\|sentry`, defaults to `logger`; `sentry` mode requires `SENTRY_DSN` too (`getOrThrow`, fails fast if missing — same posture as `PAYMENT_GATEWAY=zarinpal`'s own credentials) |
| Product analytics | `AnalyticsProvider` (`analytics/analytics.provider.ts`), wrapped by `AnalyticsService` (call sites use the service, never the provider directly) | `ANALYTICS_PROVIDER` | `PostgresAnalyticsProvider` (persists each event to `analytics_events`, read back by `GET /api/admin/analytics/summary`), `ConsoleAnalyticsProvider` (structured-JSON-to-`Logger` only; no real Mixpanel/Amplitude/PostHog account exists yet) | `ANALYTICS_PROVIDER=postgres\|console`, defaults to `postgres` — unlike Kavenegar/WebPush there's no external credential to be missing, since Postgres is already this app's own primary datastore |
| AI / LLM | `AiProvider` (`ai/ai.provider.ts`), wrapped by `AiService` (call sites would use the service, never the provider directly) | `AI_PROVIDER` | `UnconfiguredAiProvider` (throws `NotImplementedException`; no real OpenAI/Anthropic/etc. account exists yet) | none yet — always `UnconfiguredAiProvider` until a real vendor is added. **`AiModule` is not imported anywhere** — no feature calls this yet; see [27-ai-foundation.md](./docs/technical-overview/27-ai-foundation.md) |

Default local/test config runs everything through the console/mock implementations — **no real Zarinpal account or SMS credits needed for dev.** If you add a new external integration, follow this exact pattern rather than hard-wiring a client.

### Error handling & config

- Throw NestJS built-ins directly from services (`NotFoundException`, `BadRequestException`, `ConflictException`, `ForbiddenException`) — NestJS's default mapping to HTTP status is relied on. `GlobalExceptionFilter` (`error-tracking/global-exception.filter.ts`, registered as `APP_FILTER`) is a catch-all that subclasses `@nestjs/core`'s `BaseExceptionFilter` and calls `super.catch()` to produce the *exact same* response NestJS's default handling would — its only added behavior is capturing 5xx/unknown exceptions through `ErrorTrackingService` (with `requestId`/`userId`/`route`) before that response goes out. Ordinary sub-500 business-rule throws (`NotFoundException`, `BadRequestException`, etc.) are deliberately NOT captured — see the filter's own doc comment.
- `@nestjs/config`, global module, env file picked by `NODE_ENV` (`.env.test` vs `.env`). **No schema validation** — services call `config.getOrThrow('KEY')` (throws at runtime if missing) or `config.get('KEY', default)`. Be careful introducing a new required env var — nothing will catch a missing one until the code path runs.

### Observability

- `GET /api/health` (`health/health.controller.ts`) does real dependency checks, not a bare liveness stub — `SELECT 1` against Postgres and Redis `PING`, each with a 2s timeout, returning `{status:'ok',db:'ok',redis:'ok'}` (200) or `{status:'error',...}` (503) per-dependency. Safe for an orchestrator's restart-on-unhealthy policy.
- Every request gets an `X-Request-Id` (generated, or reused from a trusted incoming header) via `common/request-logging.middleware.ts`, echoed on the response and appended to one access-log line per request (`main.ts`; deliberately NOT mirrored into the e2e test harness — see the middleware's own doc comment for why).
- `AlertsService` (`alerts/`) is the one place money-critical or job-critical failures get **paged**, not just logged: every alert becomes an admin-panel notification, `severity: 'critical'` also SMS's `ALERT_ADMIN_PHONE`. Dedup'd per key/window so a repeatedly-failing condition doesn't spam. Used by `CronJobRunner` (any job failure), payment/refund failure paths, and per-salon invoice-generation failures.
- `AnalyticsService.track(event, properties?, context?)` (`analytics/`, see the abstractions table above) is the one seam for product-analytics events — call sites never talk to `AnalyticsProvider`/a vendor SDK directly. Every call is genuinely fire-and-forget (`void this.analytics.track(...).catch(() => {})`, never awaited inline) so an analytics outage can't add latency or fail the real operation. Only a small seed set from the booking funnel is wired today (`booking_started`, `booking_confirmed`, `booking_cancelled`, `payment_succeeded`, plus `user_registered`/`salon_submitted`/`search_performed` — see `booking/bookings.service.ts`/`booking/payments.service.ts`/`auth/auth.controller.ts`/`salons/salons.service.ts`/`search/search.service.ts`), not a full event catalog. `properties`/`context` must never carry a phone number, payment authority, JWT, OTP, or other credential/PII — bare id references (`userId`, `bookingId`, `salonId`) are fine, the review responsibility is on each call site. Persisted to `analytics_events` by `PostgresAnalyticsProvider`; `AnalyticsAggregationService` (`GET /api/admin/analytics/summary`, admin-only) returns a per-`event_name` total count plus a day-by-day breakdown of the three booking-funnel events for the given date range (defaults to the last 30 days), rendered by the admin-panel's `AnalyticsView.vue`.

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
├── pages/            file-based routes: index.vue, login.vue, profile.vue, salons/[slug].vue,
│                     booking/[slug]/[serviceId].vue, booking/callback.vue, bookings/index.vue, bookings/[id].vue,
│                     blog/index.vue, blog/[slug].vue, account/{activity,favorites,referral,wallet}.vue
├── components/       feature-organized: booking/, layout/, salon/, ui/ (Base* primitives, JalaliDatePicker)
│                     — PascalCase, global auto-import with pathPrefix:false (SalonCard.vue → <SalonCard>,
│                     not <SalonSalonCard>); client-only components use the .client.vue suffix (SalonMap.client.vue)
├── composables/      useApi.ts, useTheme.ts, useToast.ts, useDialog.ts, useFeatureFlags.ts, useLogout.ts,
│                     useNow.ts, usePushSubscription.ts
├── stores/           session.ts (single Pinia store)
├── layouts/          default.vue (with AppHeader), bare.vue
├── middleware/        auth.global.ts (the only middleware; runs on every route)
├── utils/            route-guard.ts, geo.ts, slot-format.ts, gender-map.ts, attribution.ts, markdown.ts, types.ts, …
├── assets/css/       main.css (Tailwind + Vazirmatn + light/dark CSS custom properties)
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

Single Pinia store, `useSessionStore` (`app/stores/session.ts`): `{ user: SessionUser | null, checked: boolean }`, where `SessionUser` is `{ id, phone, name, gender, role }`. **No token in Pinia state** — same HttpOnly-cookie-only model as the API. Hydrated once per session by `middleware/auth.global.ts`, which probes `/auth/me` and redirects to `/login` unless the route is public (`app/utils/route-guard.ts` → `isPublicRoute()`; currently `/`, `/login`, `/salons*` and `/blog*`).

### Styling & theming

Tailwind v4 (via `@tailwindcss/vite`, no `tailwind.config`) + CSS custom properties in `assets/css/main.css` for two themes — light "Teal Trust" (`--color-accent: #0EA89B`) and dark "Bold Editorial" (`--color-accent: #7A3FF2`). Toggle via `useTheme()` (cookie-persisted), synced with `@custom-variant dark`. Classes reference tokens directly: `bg-(--color-surface-card)`, `text-(--color-accent)`. Font is `@fontsource-variable/vazirmatn` (self-hosted, Persian-optimized).

**No i18n library** — the app is Persian/RTL only (`lang="fa" dir="rtl"` set in `nuxt.config.ts`). Don't reach for `vue-i18n`/`@nuxtjs/i18n` here; there is exactly one locale by design.

### PWA & push

`@vite-pwa/nuxt` with `injectManifest` strategy, service worker source at `app/sw.ts` (precaching + `push`/`notificationclick` handlers). Push subscription flow lives in `usePushSubscription()` — converts the VAPID key, `POST /push/subscribe`, `DELETE` to unsubscribe, rolls back client-side state on API failure, and detects support only in `onMounted` (avoids SSR hydration mismatches).

### Maps

`SalonMap.client.vue` — Leaflet (bundled npm package) + CARTO's free Voyager tile layer, no API key or paid SDK involved, always client-only and lazy-loaded (never SSR'd). Marker popups link out to the customer's own maps app for directions (`nshn.ir/?lat=&lng=` for Neshan, `google.com/maps/dir/?api=1&destination=` for Google Maps) rather than routing turn-by-turn navigation in-app. `SalonPinPicker.vue` (provider-panel's onboarding/settings location picker) uses the same Leaflet + CARTO setup for drag-to-set-pin.

### Testing

- **Unit** (`test/unit/*.spec.ts`, Vitest `environment: 'node'`) — pure functions: `geo.spec.ts`, `slot-format.spec.ts`, `gender-map.spec.ts`, `route-guard.spec.ts`, `attribution.spec.ts`, `markdown*.spec.ts`, etc.
- **Component/composable** (`test/nuxt/*.spec.ts`, Vitest `environment: 'nuxt'` via `@nuxt/test-utils`) — anything touching Nuxt context: `useApi.spec.ts`, `SalonCard.spec.ts`, `SlotPicker.spec.ts`, `booking-confirm.spec.ts`, `auth.global.spec.ts`, plus one spec per page (`bookings-list`, `booking-detail`, `salon-detail`, `login`, …).
- **E2E** (`e2e/*.spec.ts`, Playwright, `workers: 1` per app — serialized because tests share Redis-backed OTP state) exists in all three frontend apps: user-app has `01-happy-path`, `02-admin-featured-badge`, `03-review-flow`; provider-panel `01-onboarding`, `02-bookings-status`, `03-manual-booking-and-time-off`, `04-services-and-hours-management`; admin-panel `01-approve-salon` through `05-plans-and-subscriptions`. A fourth, Playwright-only package, **`apps/e2e-cross-app`** (`@gheychi/e2e-cross-app`, no app of its own), spins up api + user-app + provider-panel together and drives one booking across both frontends from two browser contexts (`e2e/01-booking-flows-across-apps.spec.ts`) — this closes the old "no test spans more than one app" gap. All four run in CI (`.github/workflows/ci.yml`).
  - **DB prep is a `test:e2e` pretest step (`node e2e/prepare-db.cjs && playwright test`), not Playwright's `globalSetup` option** — Playwright gives no ordering guarantee between `globalSetup` and `webServer` startup (confirmed empirically: the webServer-spawned API process raced ahead of a schema reset/migration happening inside `globalSetup`, on real runs, in all three apps). `prepare-db.cjs` is deliberately plain CommonJS, not TypeScript, so it runs directly via `node` with no loader.
  - **Each suite resets its own `gheychi_e2e` database** (`docker/postgres-init/02-e2e-db.sql` provisions it on a fresh volume; an existing checkout needs a one-time `CREATE DATABASE gheychi_e2e;`), never the shared `gheychi` dev database `pnpm dev` uses — `prepare-db.cjs` `DROP SCHEMA CASCADE`s its target on every run, so sharing the dev DB would destroy real local dev data on every local e2e run.

---

## Domain Model Quick Reference

| Entity | Key states/fields |
|---|---|
| `User.role` | `customer` \| `provider` \| `admin` — becoming a provider is automatic (`UsersService.promoteToProvider()`) when a user creates a salon, not a separate admin step |
| `Salon.status` | `pending` (default on create) → `approved` \| `rejected` \| `suspended`, via `PATCH /api/admin/salons/:id/status` (admin-only, Plan 6); a `rejected` salon can flip back to `pending` via `POST /api/salons/mine/resubmit` (provider-side). Only `approved` salons appear in public search/profile queries |
| `Salon.genderTarget` | `women` \| `men` — every search/listing result respects this filter, including featured/ad-boosted results, with no bypass |
| `Booking.status` | (`pending_approval` →, manual-approval salons only) `pending_payment` → `confirmed` → `completed` \| `cancelled_by_user` \| `cancelled_by_salon` \| `rejected_by_salon` (manual-approval only) \| `expired` \| `no_show`. `source` is `online` \| `manual` (owner-entered via `POST /api/salons/mine/bookings`); `attributionSource` (`qr`/`direct`/`search`/null) is a separate, customer-side marketing field |
| `Payment.status` | `initiated` → `paid` → `refund_pending` → `refunded` \| `failed` — refunds are **real**: `refund_pending` means a refund is owed and being processed; `refunded` means Zarinpal confirmed it (`refund_ref_id` stored). Producers: `cancel()` (inline attempt), reconciliation's late-capture branch; `RefundRetryJob` (cron, 5 min) self-heals failures and escalate-logs after 24 h. Requires `ZARINPAL_ACCESS_TOKEN` in zarinpal mode; the refund contract cannot be sandbox-tested and likely targets Zarinpal's legacy REST API — execute `docs/deployment/ZARINPAL-REFUND-VERIFICATION.md` before production refunds. `RefundRetryJob`'s 24 h escalation and the other operator signals now also page via SMS (`apps/api/src/alerts/`). A `pending_approval` booking has **no** Payment row at all, and with `feature_online_payment_enabled` off no Payment row is ever created — customer responses expose `depositPaid: boolean` (true iff a Payment reached `paid`/`refund_pending`/`refunded`) so the UI never infers "paid" from `depositAmount` |
| `Review` | Verified-booking-only (DB `UNIQUE` on `booking_id`), one review per completed booking, editable/deletable within a 72h window (`PATCH`/`DELETE /api/reviews/:id`), moderation is **reactive** (`published` immediately, admin can flip to `rejected` after the fact — no pre-publish queue) |
| One salon per owner | `Salon.ownerId` is looked up via `findOneBy({ ownerId })` — the data model does not support multiple salons per provider account |
| `Referral.status` | `awaiting_qualifying_event` → `reward_granted` \| `partially_granted` (one beneficiary side granted, the other's reward kind not supported at the time — a transient state as of the referral system's slice 6, not a durable dead end) \| `expired` \| `cancelled` (admin-only, only from `awaiting_qualifying_event`) — reward terms are snapshotted onto the row at redemption time and never re-read live, even if the admin later changes `referral_reward_types` |
| `WalletTransaction` | Append-only ledger, never a mutable balance column — `wallet_balances` is a row-locked, recompute-under-lock cache. A debit is capped at the available balance (never negative); any shortfall is recorded, never silently absorbed |
| `FinancialTransaction` / `Invoice` | `invoicing/` module: `financial_transactions` is an append-only per-booking commission ledger (`commissionPercent`/`commissionAmount` FROZEN at write time — a later platform commission-rate change never retroactively alters a past row). **Commission accrues only on captured money**: `InvoicingService.recordCommission()` reads the booking's `paid` Payment row and uses `payment.amount` as gross — no paid Payment (online payment flag off, manual booking, pending-approval death) → no ledger row, never `booking.depositAmount`. `MonthlyInvoiceGenerationJob` (daily cron) rolls unlinked ledger rows into one `Invoice` per (salon, Jalali month), `status`: `issued` → `partially_paid` \| `paid`, `void`. Admin records an already-made bank transfer via `PATCH /api/admin/invoices/:id/payment` (row-locks the invoice, 409 on `void`; there's no payout infrastructure to initiate one); `GET /api/salons/mine/earnings` reads the same ledger, never a live payments+rate recomputation |

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

- **A production-hardening sprint ran 2026-09-03.** Its gap analysis of all 31
  production-readiness areas is `docs/engineering/PRODUCTION_COMPLETION_AUDIT.md` — read it
  before assuming anything in this list is still open. Landed in that sprint: no-show grace
  period + one consistent forfeited-deposit commission rule (a late cancellation now accrues
  commission exactly like a no-show — see [14-commission.md](./docs/technical-overview/14-commission.md));
  **rescheduling** (customer + salon, [09](./docs/technical-overview/09-booking-engine.md));
  **session revocation** (`jti` + Redis denylist, [05](./docs/technical-overview/05-authentication.md));
  the **entitlement engine** ([35](./docs/technical-overview/35-entitlement-engine.md));
  salon **handle history + permanent redirects**; `GET /admin/bookings` + an admin bookings
  page; provider polling for new booking requests; a crawlable public salon listing +
  canonicals; frontend error reporting; uploads backup; and a batch of job/lock/IDOR fixes
  ([18](./docs/technical-overview/18-background-jobs.md), [21](./docs/technical-overview/21-security.md)).
  **Every salon-triggered SMS is now metered** through one seam — adding a new
  salon-triggered send without routing it through `SalonSmsQuotaService` reintroduces an
  unbounded cost channel.
- **Do not run the API's jest e2e suite and the Playwright suites at the same time.** Both
  call `redis.flushdb()` during their own DB reset against the SAME Redis instance, so a
  concurrent run wipes the other's live OTP codes and rate-limit state mid-login. They use
  different Postgres databases (`gheychi_test` vs `gheychi_e2e`), which makes this look like
  they are isolated when they are not. Symptoms are login failures in unrelated suites
  (a redirect to `/login` or `/forbidden`, or "OTP was not found in Redis") — always re-run
  the suspect suite alone before believing a failure.

- **Provider Panel (Plan 5) and Admin Panel (Plan 6) are both built.** `apps/provider-panel` (port 3004) covers onboarding, bookings, services, hours, photos, reviews, earnings, and a Salon Settings/resubmit flow. `apps/admin-panel` (port 3005) covers salon approvals, review moderation, categories, users/salons search+suspend, and platform config editing.
- **Salon approval no longer requires a manual DB update.** `PATCH /api/admin/salons/:id/status` (approve/reject/suspend, reason required for reject/suspend) plus `POST /api/salons/mine/resubmit` (provider side, flips `rejected` back to `pending`) close this gap — see the README's "Admin panel (Plan 6)" section for the full endpoint list.
- **No salon photo upload path** was the old gap here — it's closed: `POST /api/salons/mine/photos` (Plan 5) lets a provider upload/manage photos via a swappable `StorageProvider` (`local`/`s3`).
- **Plan 7 (platform hardening) closed the six trust-and-safety gaps** previously listed here: an admin audit log (declarative `@AuditAction` decorator + interceptor on every admin mutation, browsable via `GET /api/admin/audit-log` and the admin-panel's Audit Log page), a first-admin bootstrap script (`pnpm --filter @gheychi/api create-admin 09xxxxxxxxx`, idempotent — pnpm 9 leaks a `--` separator into forwarded args on some invocations, so the script tolerates both `create-admin 09...` and `create-admin -- 09...`), a verified-customer report flow end-to-end (user-app salon/review report form → `POST /api/reports` → admin-panel queue at `/reports`), category delete with restrict semantics (`DELETE /api/admin/categories/:id`, 409 when any salon service references it), user-suspend → salon cascade (`salons.suspended_cause` distinguishes `admin` suspensions from `owner_suspended` cascades so reactivation only restores the latter), and a polled admin notification queue (`salon_resubmitted` / `report_created`, bell badge in the admin-panel header). See `docs/superpowers/plans/2026-07-10-plan-7-platform-hardening.md`.
- **Fixed: an admin could previously approve a pending salon whose owner is suspended.** `PATCH /api/admin/salons/:id/status` now looks up the salon's owner via `UsersService.findById()` before applying an `approved` status change and throws `ConflictException` (409) if the owner's `status` is `'suspended'` — the update is never applied, so the salon stays in its prior state. No frontend change was needed: `admin-panel`'s generic `useApi()` error handling already toasts the exception's message and correctly skips the `updated` emit when `data` is `null`. Covered by a unit test (`admin-salons.controller.spec.ts`) and an e2e test (`admin-salon-status.e2e-spec.ts`) that suspends a real owner account and asserts the 409.
- **The salon-side effect of a user-suspension cascade is not separately audited.** Suspending/reactivating a user writes one `user.status.set` audit row; the cascaded salon suspension/restoration inside the same transaction has no corresponding audit row. Deliberate — reconstructing a salon's status timeline from audit rows alone has this gap.
- **Admin notification read state is per admin** (`admin_notification_reads` join table, migration `1754400000000`, LEFT JOINed per caller in `admin-notifications.service.ts`). The older `admin_notifications.read_at` column is still present but is no longer written or read — kept only for rollback safety; don't treat it as the source of truth.
- **Blog/content CMS shipped in Plan 8.** A lean `apps/api/src/content/` module (posts + admin-managed categories, `draft` → `published` workflow with conditional-update race guards, cover images through the existing `StorageProvider`, a sitemap source for published articles), an admin-panel Markdown editor with live preview at `/blog`, and public SSR pages in the user-app at `/blog` and `/blog/[slug]`. **XSS safety is by construction:** posts store raw Markdown and both frontends render it through their own `markdown-it` utility configured `html: false`, so raw HTML never parses — each utility carries an invariant test pinning that, and the only two `v-html` bindings in the codebase (admin preview pane, user-app article body) are sanctioned solely by it. Deliberate cuts recorded in the spec (`docs/superpowers/specs/2026-07-10-plan-8-blog-cms-design.md`): no comments or reader interaction, no scheduled publishing, no RSS, no post revisions, and no redirects when a published post's slug changes (the editor warns that editing a published slug changes the URL; unpublish is the soft removal path) — the same risk applies to renaming a category without pinning its slug, which changes `/blog?category=<slug>` URLs. Of the smaller fast-follow items from this plan, three were closed on 2026-07-17: manually-edited slugs are now sent atomically in the create POST (`CreateBlogPostDto.slug`, optional — a 409 creates nothing and shows a persistent inline slug error in the editor, both create and edit modes); storage best-effort deletes (salon photos and blog covers) stay fire-and-forget but log every failure with the orphaned key and owner; and a post with neither `metaDescription` nor `excerpt` now derives its `description` meta tag from the markdown body (`apps/user-app/app/utils/markdown-excerpt.ts` — a post with an effectively-empty body still emits none). Still open by choice: an empty-string `?category=` on the public blog list is treated as no-filter, not as an empty-slug match. Two items from this list were closed in a follow-up fix: the salons and blog sitemap sources were capped at 50,000 URLs each (Google's single-sitemap-file limit) — **since superseded**: both sources are now paginated (`?page=`, 5,000/page) behind a real multi-file sitemap index (`/sitemap-index.xml` listing `sitemap-salons-N.xml`/`sitemap-posts-N.xml`; `/sitemap.xml` still resolves, now serving the index), so there's no longer a 50,000-row ceiling on either domain — see the `server/` paragraph above, and `salons/[slug].vue`/the booking page (`booking/[slug]/[serviceId].vue`) now carry the same root `v-if="page"` guard the blog article page already had, closing the Suspense pre-render-pass crash on their `createError(404)` paths (each has a regression test asserting a clean 404 rejection with no unhandled render error).
- **Refunds are real but production-unverified — and the contract is likely stale.** 2026-07-17 research found the implemented `refund.json` call matches Zarinpal's *legacy* REST refund contract (de-documented ~2023); the current official refund API is a GraphQL `AddRefund` mutation (different host, needs `session_id` not `authority`, requires an amount, response has no numeric `code`), and Zarinpal permits one refund request per transaction, which undermines the gateway's crash-retry idempotency assumption. **No sandbox covers refunds** (the old "verify in sandbox" note was impossible as written) — the exact production verification procedure, including how to settle every open question with ~two minimum-value test payments, is `docs/deployment/ZARINPAL-REFUND-VERIFICATION.md`. Until it is executed, refunds fail safe: payments stay `refund_pending` and escalate to a human. **Money-critical operator alerting shipped in Plan 9** (spec: `docs/superpowers/specs/2026-07-16-money-critical-alerting-design.md`): `AlertsService.raise()` routes every money-critical condition (stuck refund, refused refund, captured money on a dead booking, orphaned authority, persist failures) to in-app admin notifications, with SMS paging for `critical` severity to `ALERT_ADMIN_PHONE` (comma-separated list supported), deduped per condition via Redis `SET NX EX` (fail-open) so the 5-minute crons can't storm. Hardening grafted 2026-07-17 from an adversarial review: the dedup claim is released when nothing was delivered (so a transient failure can't mute an alert for the full window), stuck-refund escalations re-page daily instead of every 6 h, and an hourly SMS circuit breaker (`ALERT_SMS_HOURLY_CAP`, default 30) bounds cost during mass incidents. Non-money `logger.error` calls (audit/notification emit failures) remain log-only by design.
- **Salon showcase shipped 2026-07-17** (spec: `docs/superpowers/specs/2026-07-17-salon-showcase-design.md`, record: `docs/superpowers/plans/2026-07-17-salon-showcase.md`): Instagram-style salon **stories** (images only, 24 h TTL as a DB-clock SQL predicate — never a state flip; hourly GC cron with a 1 h grace, open-report evidence pinning, and storage-first delete order so failures self-heal; cap 10 active), **profile** fields on `salons` (`tagline`/`about`/`instagram_handle` — plain text, no markdown, `''→null` clears via `PATCH /api/salons/mine`), and a **portfolio** (`portfolio_items`, cap 40, optional service link, `MAX(sort_order)+1` inserts). Provider management under `salons/mine/stories|portfolio`; public read on `salons/:slug/stories|portfolio` (approved-gated, published+unexpired only); `SearchResult.hasActiveStory` drives story rings on salon cards; admin remove/restore via `PATCH /api/admin/stories|portfolio/:id/status` (audited, reversible — no hard delete). Reports extend to story/portfolio targets with a `reports.target_type` discriminator that survives the `ON DELETE SET NULL` cascade — the open-report dedup index deliberately excludes orphaned content reports (a provider deleting reported content must never 23505). Deliberate cuts in the spec: no video, no cross-salon story feed, no view counts or server-side seen state, hardcoded TTL/caps, no pre-publish moderation queue; named fast-follow: before/after work-sample comparison slider.
- **Production deployment shipped in Plan 9.** Docker images for all four apps (`Dockerfile` per app, `turbo prune --docker` multi-stage builds), a `docker-compose.prod.yml` adding Caddy (automatic HTTPS + baseline security headers) plus the four app containers to Postgres/Redis, and a GitHub Actions workflow that runs the full test suite on every push/PR and builds+pushes images to GHCR on `main`. Deploying those images to the VPS stays a manual `docker compose pull && up -d` step — see `docs/deployment/DEPLOY.md`. **Database backup automation shipped as a follow-up.** A `backup` service in `docker-compose.prod.yml` (built from `docker/backup/`, `postgres:16-alpine` + the MinIO Client) dumps Postgres daily to the same S3-compatible bucket under a `backups/` prefix, keeps 14 days, and the restore path is documented and was actually exercised (not just written) — see `docs/deployment/DEPLOY.md`'s "Restoring a backup" section and `docs/superpowers/specs/2026-07-14-db-backup-automation-design.md`. Along the way this surfaced and fixed a real pre-existing gap: `DEPLOY.md`'s one-time setup never called out that production `.env` needs `DB_HOST=postgres`/`REDIS_HOST=redis` overrides (Plan 9's own validation never exercised a live `docker compose up -d`, only `config` syntax checks). No point-in-time recovery (WAL archiving) — daily full dumps only, accepted up-to-24h data-loss window. **Backup monitoring/alerting shipped as a further follow-up** (`apps/api/src/backup-monitoring/`): `docker/backup/backup.sh` now sanity-checks its own dump (rejects anything under 10 KiB — a genuinely-empty/truncated custom-format dump vs. a real schema's minimum size) and verifies the S3 upload via `mc stat --json` (local byte size must match what actually landed in S3, catching a partial/corrupt upload `mc cp`'s own exit code can miss) before best-effort POSTing the outcome (status/size/duration/error) to `POST /api/internal/backup-report`, guarded by a `BACKUP_REPORT_SECRET` shared-secret header (constant-time compare) rather than network topology alone — Caddy's `{$DOMAIN_API}` block has no path restriction, so this route is technically reachable from the public internet like any other, not merely from the internal Docker network. On success it writes a durable `backup:last-success` timestamp to Redis (no TTL) and increments the `backup_reports_total` Prometheus counter; on failure it pages via the same `AlertsService` every other money/job-critical condition in this codebase uses (`key: 'backup-failed'`, `severity: 'critical'`). A new hourly-cadence-adjacent cron, `BackupStalenessCheckJob` (every 4h), independently catches a *fully silent* failure (e.g. the whole `backup` container crash-looping and never even attempting `pg_dump`, so it never reaches the reporting endpoint at all) by alerting (`key: 'backup-stale'`) when `backup:last-success` is missing or older than 27h (one 24h daily cycle + a 3h jitter buffer). The reporting POST itself is best-effort by design and can never flip a genuinely successful backup's own exit code to failure — see `backup.sh`'s `report_backup()`. The `api` production image deliberately keeps devDependencies and full source (not just `dist/`) so the existing `pnpm migration:run` script works unchanged via `docker compose exec` — a size/simplicity tradeoff, not an oversight. **The intermittent `apps/user-app/e2e/01-happy-path.spec.ts` CI flake is resolved** (previously marked `continue-on-error` in `.github/workflows/ci.yml`, since removed). True root cause, found via direct browser instrumentation (monkey-patching `window.fetch`/`Storage.prototype.setItem` plus reading Vite/Nuxt source): on a cold `nuxt dev` process, Vite's dependency optimizer only discovers a lazily-loaded route's dependencies the first time that route's code is actually imported by the *browser* — dynamic imports aren't part of Vite's initial crawl. Every route in this test (`/`, the salon page, the booking page) is visited for the first time that session via an in-app client-side navigation rather than a fresh page load; if that first import triggers the optimizer to discover new, not-yet-bundled dependencies, the dev server sends a `full-reload` WebSocket message, and Vite's client handles it with a bare, path-less `location.reload()` (`vite/dist/client/client.mjs`'s `pageReload`/`full-reload` case). If that fires before Vue Router's own `history.pushState` for the new route has committed, the reload lands back on the *old* path instead of the new one — exactly matching every previously-observed symptom (a hard reload back to the previous page moments after a successful in-app navigation, with a valid session cookie throughout, since the reload's own SSR pass always finds the user still logged in). This is exclusively a Vite dev-server/HMR artifact with no equivalent machinery in a production build. Two real, independently-valuable bugs found during the earlier investigation phase are still in place as general hardening even though neither was the actual cause: the `auth.global.ts` stale-probe race (`session.checked` re-check guard) and `login.vue`'s per-step `:key`s. The actual fix has two parts: (1) `nuxt.config.ts`'s `vite.server.warmup.clientFiles` for `/` gives the optimizer a head start during dev-server boot, reducing how often the race is even possible; (2) since that alone can't *guarantee* the optimizer finishes before a given first-time navigation — confirmed empirically, it still failed under worst-case fully-cold conditions (API server cold-compiling concurrently) even with a generous explicit wait — `01-happy-path.spec.ts` now tolerates the known-harmless reload directly via an `expectUrlTolerantOfDevReload()` helper at every first-time client-side navigation: on a timeout, it re-navigates and asserts again, so a *real* navigation/auth failure still fails the test for real rather than being silently masked. Verified with 12/12 consecutive passes under fully-cold conditions (API `dist/`, `.nuxt/`, and `node_modules/.vite` all cleared before every run) locally, matching a genuine fresh CI checkout.
- **Monetization/subscription platform initiative started 2026-08-30** (spec:
  `docs/superpowers/specs/2026-08-30-monetization-platform-design.md`). A large, owner-scoped
  request (global payment toggle, provider-editable public salon links + QR, salon-managed
  customer SMS with quota, a full admin-configurable subscription/plan/entitlement system,
  subscription coupons, salon CRM, supporting dashboards) is being built in dependency-ordered
  phases, each with its own implementation record, rather than as one combined change — see
  the spec for the full phase list and the owner decisions locked in before any phase's code
  was written (billing stays architecture-only for now; every plan name/price/limit ships as
  an admin-editable placeholder; the public link reuses `salon.slug` rather than a new route).
  **Phase 1 (global payment toggle) shipped 2026-08-30** — `feature_online_payment_enabled`
  (seeded off) gates online (Zarinpal) payment collection platform-wide with no code deploy
  needed to enable it later; see `docs/technical-overview/29-global-payment-toggle.md`.
  **Phase 2 (subscription/plan foundation) shipped 2026-08-30, backend-only** — a
  `Plan`/`SalonSubscription` backbone (admin CRUD at `/admin/plans`, a per-salon
  `/admin/salons/:id/subscription`, an unwired `SubscriptionsService.getEntitlements()`
  resolution seam for later phases to consume) with every existing and new salon backfilled
  onto a seeded FREE default plan; see `docs/technical-overview/30-subscription-plan-foundation.md`.
  **Phase 3 (admin override + usage/plan dashboards) shipped 2026-08-30** — the
  salon-specific entitlement override (`salon_subscriptions.entitlement_overrides`, merged
  over the plan's own entitlements, admin-only), the first real UI (admin-panel's
  `/plans` page + a `SalonSubscriptionCard` on each salon's detail page; provider-panel's
  read-only `/plan` page, no controls at all per the owner's "nothing commercial" decision).
  Entitlement enforcement itself remains deliberately unwired — each later phase wires its
  own keys as it introduces them, rather than a hollow generic gate.
  **Phase 4 (public handle + QR + attribution) shipped 2026-08-30** — `salon.slug` is now
  provider-editable (reserved-word-checked, admin-override recourse), reused directly as the
  shareable link (`gheychi.co/salons/<handle>`) with a client-side-generated QR
  (provider-panel's `PublicLinkCard.vue`); a new `Booking.attributionSource`
  ('qr'/'direct'/'search'/null, distinct from the pre-existing `Booking.source`
  online/manual) is resolved client-side on the salon page and threaded through booking
  creation into both the `bookings` row and the `booking_started` analytics event. See
  `docs/technical-overview/31-public-handle-and-attribution.md`.
  **Phase 5 (salon CRM) shipped 2026-08-30** — a customer list/detail/notes surface derived
  entirely from existing `bookings`/`payments`/`financial_transactions` rows (no new Customer
  entity; ownership isolation is the booking-history query's own `salon_id AND user_id` shape,
  not a separate check), plus a financial dashboard with deliberately precise terminology —
  `grossBookingValue` (full price) vs. `onlineCollected` (real payments) vs. `commission`
  (real accrual) vs. `estimatedSalonRevenue` (gross − commission, labeled "تخمینی" since the
  salon's own cash portion is never actually observed). Segmentation (`new`/`returning`/
  `lapsed`) is a fixed 60-day heuristic, not admin/owner-configurable. `analytics_events`
  gained an indexed `salon_id` column (lifted from existing event properties, zero call-site
  changes) for later salon-scoped-funnel use, not yet consumed by anything. See
  `docs/technical-overview/32-salon-crm.md`.
  **Phase 6 (salon SMS + quota) shipped 2026-08-30** — a salon owner can send a free-text SMS
  to one of their own customers from the CRM customer-detail screen, reusing the existing
  `SmsProvider` send path with no new gateway/template infrastructure, gated by a real
  monthly quota (`entitlements.smsMonthlyQuota`, resolved through the Phase 2/3 engine —
  the first phase to actually *enforce* an entitlement rather than just resolve one). A
  missing/non-numeric quota resolves to 0 (blocked), the opposite default from the referral
  system's `null → unlimited` convention, since an SMS quota bounds a real per-message cost.
  Usage is derived (not stored) as a `COUNT` of an append-only `salon_sms_messages` log
  within the current Jalali month, reusing the invoicing module's own month-boundary
  utility; a send is quota-checked → sent → logged in that order (a failed send never
  consumes quota), and — unlike every automated notification SMS elsewhere in this
  codebase — a real send failure is deliberately NOT swallowed, since this is the owner's
  own primary action. The migration backfilled a placeholder `smsMonthlyQuota: 20` onto
  every existing plan rather than shipping the feature silently blocked; no new admin
  endpoint was needed since the existing plan-entitlement and per-salon-override UIs already
  cover it. See `docs/technical-overview/33-salon-sms-quota.md`.
  **Phase 7 (subscription coupons + billing-architecture scaffolding) shipped 2026-08-30 —
  the final phase of this initiative.** `SubscriptionCoupon`/`SubscriptionCouponRedemption`
  (`apps/api/src/billing/`) are a genuinely separate entity from the booking `Coupon`
  (`coupon_redemptions.booking_id` is `NOT NULL UNIQUE` there, structurally incompatible with
  a subscription-period redemption) — percent-only, redeemed by salon rather than user, one
  redemption per salon per code, reusing the booking coupon system's own row-lock pattern for
  capped-coupon concurrency safety. `SubscriptionBillingPeriod` gives the owner's own
  `Plan → Subscription → BillingPeriod → Invoice` shape real substance: `baseAmountToman` is
  the plan price frozen at creation (never retroactively altered by a later price change), an
  optional coupon code discounts `amountToman` atomically with the redemption record, and
  `status` (`pending → paid | comped | void`) is admin-set and only resolvable once — a
  settled period is never overwritten, matching how an issued invoice is already immutable
  elsewhere in this codebase. **No cron ever creates a billing period** — every one is
  admin-created, deliberately, so nothing about this scaffolding could be mistaken for real
  automated billing; no dedicated `Invoice` entity exists yet either, since a `BillingPeriod`
  already carries everything one would for an architecture-only phase. The owner has a
  read-only billing-history view (`salons/mine/subscription/billing-periods`); admin manages
  both coupons (`/subscription-coupons`) and billing periods (a new section on each salon's
  `SalonSubscriptionCard.vue`). See `docs/technical-overview/34-subscription-coupons-and-billing.md`.
  **Every phase of the monetization/subscription platform initiative is now shipped.**
- **Optional manual booking approval shipped 2026-08-28** (record: [docs/technical-overview/28-booking-approval-workflow.md](./docs/technical-overview/28-booking-approval-workflow.md)). A salon can require that it accept a booking **before** the customer pays anything (`salons.booking_confirmation_mode`: `automatic` | `manual_approval`; every pre-existing salon backfilled to `automatic`, so nothing about existing behaviour changed). Manual mode adds two `BookingStatus` members — `pending_approval` and `rejected_by_salon` — and the central guarantee is that **a `pending_approval` booking has no `Payment` row and no gateway authority at all**, so declining or expiring one can never owe a refund. The `Payment` row is inserted by `approve()` in the same transaction that opens the payment window. Wallet/coupon are still staked at request time (they determine the deposit the salon is accepting) and handed back on every death path by the *existing* `releaseBookingHold()` — rejection and approval-expiry are exactly the "never captured" case it already covered, so no new reversal logic exists. **Deadlines are snapshots**: `approval_expires_at`/`payment_expires_at` are stamped from the config in force at that instant and never recomputed, which also fixed a pre-existing bug where editing `booking_hold_ttl_minutes` silently moved the deadline of every in-flight hold (`BookingExpiryJob` now reads the snapshot, falling back to the old `created_at` derivation only for rows predating the column). **Configuration split is the enforcement boundary**: the owner sets the mode and nothing else via `PATCH /salons/mine`, while both timeouts are admin-only — globally (`booking_approval_timeout_minutes`, seeded **10** — a deliberate product decision, not a tuning default: a customer should not hold an unpayable slot for half an hour waiting on an owner; the payment default deliberately *reuses* `booking_hold_ttl_minutes` rather than forking a second key) and per salon via `PATCH /admin/salons/:id/booking-settings` (`1..1440`, `null` = inherit, audited). The timeout columns are deliberately **absent from `UpdateSalonDto`** because `SalonsService.updateMine()` applies its DTO with a blanket `Object.assign` — their mere presence there would be a privilege escalation, and an e2e test pins that a provider PATCHing them leaves the columns NULL. A prerequisite refactor replaced six inline copies of the blocking-status list with one `SLOT_BLOCKING_STATUSES` constant (updating five of six by hand would have been a silent double-booking bug, not a test failure). The late-payment race needed **no new code**: a customer paying after their window closed hits the pre-existing `pending_payment → confirmed` CAS failure and is refunded via `recoverCapturedOnDeadBooking` rather than resurrecting the booking. SMS is spent deliberately: the customer is NOT texted when they submit a request (they are on the screen — push only) while the owner IS (short window, not in the app), and the payment-window-expired SMS fires for manual-approval bookings only — an abandoned automatic checkout is never texted. Approve/reject additionally write real `audit_log` rows (`booking.approval.approved`/`.rejected`) since a provider is a real actor, while the cron-driven halves of the same state machine cannot (audit_log.actor_id is NOT NULL) — which is precisely why booking_events exists alongside it. New `booking_events` table is an append-only lifecycle log (deliberately *not* the admin `audit_log`, which answers "which admin did what" — most transitions here have no admin actor), read back at `GET /admin/bookings/:id/events` and rendered as a timeline in the admin panel. **`approve()` re-checks availability** (salon capacity and, when requested, worker eligibility/activity/overlap — this booking's own row excluded) inside the same per-salon Redis lock `createHold` uses, since platform state can move between request and decision; a failed re-check auto-expires the request in the same transaction (never left pending for the same unavoidable cron-tick outcome) and notifies the customer with honest copy distinct from a genuine timeout (`notifyApprovalFailedAvailability`, not `notifyApprovalExpired` — "به دلیل عدم پاسخ سالن" would be false when the salon DID respond). Deliberate, permanent cuts: **no provider reminder SMS before the 10-minute approval deadline** (a second SMS would repeat something the owner was already told once — an explicit SMS-budget decision, not deferred work), no approval-rate analytics dashboard (the event model makes it computable later), and mode is per salon rather than per service.
- **Coupon codes and per-service discounts shipped 2026-07-19.** `apps/api/src/coupons/` — salon-scoped coupons (`salons/mine/coupons`, provider-managed) and platform-wide coupons (`admin/coupons`, admin-managed), percent-off, optional expiry, optional total-redemption cap, `coupon_redemptions` `UNIQUE(coupon_id, user_id)` enforcing one redemption per user per code. `SalonService.discountPercent` (1–100, nullable) is a direct per-service discount. `POST /coupons/validate` previews the resolved price/deposit before checkout; the actual booking-creation transaction (`BookingsService.createHold`) re-validates and redeems atomically. **Discount resolution rule** (`apps/api/src/booking/discount.util.ts`): the larger of the service's own discount and an applied coupon's discount wins — never stacked. No coupon-usage UI in the admin/provider coupon list ever double-counts a redemption a customer already used, since the DB unique constraint is the source of truth, not an app-level check alone.
- **Referral & Rating System shipped 2026-07-22** (spec: `docs/superpowers/specs/2026-07-21-referral-and-rating-system-design.md`, record: `docs/superpowers/plans/2026-07-22-referral-and-rating-system.md`). Built as 6 independently-shippable, sequentially-verified slices: (1) a `Worker` concept (salon staff, backed by a real `User` account) with per-worker ratings (`worker_ratings`, submitted atomically alongside the existing salon `Review`) and new editable/deletable reviews (`PATCH`/`DELETE /api/reviews/:id`, 72h window); (2) a wallet ledger (`wallet_balances`/`wallet_transactions`, append-only, row-locked, never-negative — `WalletService.credit()/debit()`); (3) one lifetime referral code per person (not per-role — a deliberate simplification), `referral_reward_types` (admin-configurable per referrer kind: user/salon_owner/worker, all ship `enabled=false` with placeholder reward values), `referrals` tracking rows, `referral_type` resolved dynamically at redemption time from the referrer's current role (worker → salon_owner → user precedence), then frozen forever (never re-derived); (4) reward granting (`tryGrantReward`, wired to booking-completion and an hourly payment-paid sweep honoring a 72h hold-back buffer) and reversal on confirmed refund (`reverseIfNeeded`, wallet debits capped at available balance with any shortfall alerted via the existing `AlertsService`); (5) discount-kind rewards issued as literal, single-recipient rows in the *existing* `coupons` table (`coupons.issued_to_user_id`) rather than a parallel mechanism, reusing the coupon feature's redemption/no-stacking logic verbatim; (6) `fixed_discount` rewards (`coupons.discount_fixed_amount`, mutually exclusive with `discount_percent` via a DB CHECK), via a `resolveBestPrice` extension to `discount.util.ts` that compares actual resulting prices rather than raw percentages — the one slice that touches the original coupon feature's tested code, shipped with zero regressions to it (independently re-verified twice). A `partially_granted` referral status (not in the original design doc, added during implementation — see the spec's "Implementation Addenda") represents "one beneficiary side granted, the other side's kind not yet supported" during the slice rollout; as of slice 6 every reward kind is supported, so this is now a transient state, not a durable dead end. Two real money-adjacent bugs were caught and fixed by each slice's adversarial verify pass rather than shipped: an unlocked `max_referrals_per_referrer` count-then-insert that let a forced 8-way concurrent redemption blow past a cap of 2 (fixed with a row lock, re-proven exactly-2 under the same adversarial probe), and a whitespace-only admin wallet-adjustment reason slipping past `@IsNotEmpty()` (fixed with a trim-before-validate). Deliberate cuts, all recorded as explicit product decisions in the spec rather than oversights: no worker SMS invite flow yet (adding a worker requires already knowing a phone number that resolves via `findOrCreateByPhone`), wallet balance is accrue-only (no spend-at-checkout path), no referral campaigns/tiers/multi-level referrals, no IP/device fraud-signal capture, no automated leak-report for the one accepted non-reversible case (a discount reward already redeemed surviving its qualifying booking's later refund — marked via `referral_rewards.reversal_reason` set with `status` left at `'granted'`, distinguishable from both a fresh grant and a real reversal). Real reward amounts/percentages are an admin data-entry task via the shipped Referral Settings screen (`/referrals/settings`), not a code change — every reward type ships disabled with zero-value terms until an admin configures and enables it.
