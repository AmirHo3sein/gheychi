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
- This repo's non-obvious tradeoffs (bookkeeping-only refunds, reactive moderation, hold-TTL/reconciliation timing) are **deliberate MVP scope cuts**, documented as such in the README and plan docs — don't "fix" them without checking whether they're an intentional cut first.

---

## Project Overview

Arayeshgah is a salon discovery & booking marketplace for Iran, built as a **pnpm + Turborepo monorepo**. Full product spec: `docs/superpowers/specs/2026-07-04-arayeshgah-marketplace-design.md`.

| App | Package | Dev Port | Status | Purpose |
|-----|---------|----------|--------|---------|
| `apps/api` | `@arayeshgah/api` | 3002 | Built (Plans 1–3) | NestJS modular monolith — auth, salons, search, booking/payments, reviews |
| `apps/user-app` | `@arayeshgah/user-app` | 3003 | Built (Plan 4) | Nuxt 4 SSR PWA — customer-facing discovery, booking, account |
| `apps/provider-panel` | `@arayeshgah/provider-panel` | 3004 | Built (Plan 5) | Vue 3 + Vite SPA — salon-owner onboarding, bookings, services, hours, reviews, earnings |
| `apps/admin-panel` | `@arayeshgah/admin-panel` | 3005 | Built (Plan 6) | Vue 3 + Vite SPA — salon approvals, moderation, categories, platform config |

Backend infra: PostgreSQL 16 + PostGIS (geography columns for location/radius search) and Redis (OTP codes, rate limiting). Both run via `docker-compose.yml` at the repo root.

---

## Commands

```bash
# Setup (first time)
docker compose up -d                                  # postgres (postgis) + redis
cp .env.example apps/api/.env
pnpm install
pnpm --filter @arayeshgah/api migration:run
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
pnpm --filter @arayeshgah/api test                     # backend unit (Jest)
pnpm --filter @arayeshgah/api test:e2e                 # backend e2e (Jest + supertest, needs docker services)
pnpm --filter @arayeshgah/user-app test                # frontend unit/component (Vitest)
pnpm --filter @arayeshgah/user-app test:e2e            # frontend e2e (Playwright)
pnpm --filter @arayeshgah/user-app typecheck            # nuxt typecheck

# Migrations (apps/api)
pnpm --filter @arayeshgah/api migration:run
pnpm --filter @arayeshgah/api migration:revert
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
- **DTOs** live in `dto/`, named `{Action}{Entity}Dto` (`CreateBookingDto`, `UpdateSalonDto`). Validated via `class-validator` decorators (`@Matches`, `@IsIn`, `@Length`, `@Type(() => Number)`, etc.) — global `ValidationPipe` enforces them.
- **Unit tests (`.spec.ts`) are colocated** next to the file they test, not in a parallel `test/` tree. Only e2e tests live under `test/`.
- **Background jobs** live in their owning module as `@Injectable()` classes with `@Cron()` on a `handleCron()` method that delegates to a plain `async run()` (keeps the logic independently callable from tests). Registered as providers in the module.

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
- Migrations: `src/migrations/<unix-timestamp>-<name>.ts`. Run via `pnpm --filter @arayeshgah/api migration:run` (wraps `typeorm-ts-node-commonjs migration:run -d src/data-source.ts`).
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

Default local/test config runs everything through the console/mock implementations — **no real Zarinpal account or SMS credits needed for dev.** If you add a new external integration, follow this exact pattern rather than hard-wiring a client.

### Error handling & config

- Throw NestJS built-ins directly from services (`NotFoundException`, `BadRequestException`, `ConflictException`, `ForbiddenException`) — no global exception filter; NestJS's default mapping to HTTP status is relied on.
- `@nestjs/config`, global module, env file picked by `NODE_ENV` (`.env.test` vs `.env`). **No schema validation** — services call `config.getOrThrow('KEY')` (throws at runtime if missing) or `config.get('KEY', default)`. Be careful introducing a new required env var — nothing will catch a missing one until the code path runs.

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

There's a minimal `server/` directory (`server/api/__sitemap__/urls.ts`, `blog.ts`) — Nitro handlers feeding `@nuxtjs/sitemap`, wired via `nuxt.config.ts`'s `sitemap.sources`. Beyond that, the app has no SSR API routes of its own; all data comes from `@arayeshgah/api` at a separate origin.

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
- **E2E** (`e2e/*.spec.ts`, Playwright, `workers: 1` — serialized because tests share Redis-backed OTP state) — `01-happy-path.spec.ts`, `02-admin-featured-badge.spec.ts`.

---

## Domain Model Quick Reference

| Entity | Key states/fields |
|---|---|
| `User.role` | `customer` \| `provider` \| `admin` — becoming a provider is automatic (`UsersService.promoteToProvider()`) when a user creates a salon, not a separate admin step |
| `Salon.status` | `pending` (default on create) → `approved` \| `rejected` \| `suspended`, via `PATCH /api/admin/salons/:id/status` (admin-only, Plan 6); a `rejected` salon can flip back to `pending` via `POST /api/salons/mine/resubmit` (provider-side). Only `approved` salons appear in public search/profile queries |
| `Salon.genderTarget` | `women` \| `men` — every search/listing result respects this filter, including featured/ad-boosted results, with no bypass |
| `Booking.status` | `pending_payment` → `confirmed` → `completed` \| `cancelled_by_user` \| `cancelled_by_salon` \| `expired` \| `no_show` |
| `Payment.status` | `initiated` → `paid` \| `failed` \| `refunded` — **bookkeeping labels only**; there is no real Zarinpal refund API call anywhere. `refunded` means "customer is owed a refund," not "a refund was issued" |
| `Review` | Verified-booking-only (DB `UNIQUE` on `booking_id`), one review per completed booking, moderation is **reactive** (`published` immediately, admin can flip to `rejected` after the fact — no pre-publish queue) |
| One salon per owner | `Salon.ownerId` is looked up via `findOneBy({ ownerId })` — the data model does not support multiple salons per provider account |

---

## Docs, Specs & Planning Workflow

This repo is developed via the **superpowers skill pipeline** — brainstorming → writing-plans → subagent-driven-development. Before starting any non-trivial feature, check whether a design/plan already exists:

- `docs/superpowers/specs/` — approved design docs (one per plan), e.g. `2026-07-04-arayeshgah-marketplace-design.md` (original full-product spec), `2026-07-05-plan-4-user-app-frontend-design.md`.
- `docs/superpowers/plans/` — the executed implementation plans, one per numbered plan (`plan-1-foundation-backend-core.md` through `plan-8-blog-cms.md`, dated filenames like `2026-07-10-plan-8-blog-cms.md`). These record what was actually built, including task-by-task completion notes and any deviations from the design doc.

New feature work should follow the same shape: brainstorm to a spec in `specs/`, get it approved, turn it into a task-by-task plan in `plans/`, then execute. Don't skip straight to implementation for anything beyond a small bug fix.

---

## Known Gaps / Future Plans

Carried forward across every plan shipped so far — check these are still accurate before assuming otherwise:

- **Provider Panel (Plan 5) and Admin Panel (Plan 6) are both built.** `apps/provider-panel` (port 3004) covers onboarding, bookings, services, hours, photos, reviews, earnings, and a Salon Settings/resubmit flow. `apps/admin-panel` (port 3005) covers salon approvals, review moderation, categories, users/salons search+suspend, and platform config editing.
- **Salon approval no longer requires a manual DB update.** `PATCH /api/admin/salons/:id/status` (approve/reject/suspend, reason required for reject/suspend) plus `POST /api/salons/mine/resubmit` (provider side, flips `rejected` back to `pending`) close this gap — see the README's "Admin panel (Plan 6)" section for the full endpoint list.
- **No salon photo upload path** was the old gap here — it's closed: `POST /api/salons/mine/photos` (Plan 5) lets a provider upload/manage photos via a swappable `StorageProvider` (`local`/`s3`).
- **Plan 7 (platform hardening) closed the six trust-and-safety gaps** previously listed here: an admin audit log (declarative `@AuditAction` decorator + interceptor on every admin mutation, browsable via `GET /api/admin/audit-log` and the admin-panel's Audit Log page), a first-admin bootstrap script (`pnpm --filter @arayeshgah/api create-admin 09xxxxxxxxx`, idempotent — pnpm 9 leaks a `--` separator into forwarded args on some invocations, so the script tolerates both `create-admin 09...` and `create-admin -- 09...`), a verified-customer report flow end-to-end (user-app salon/review report form → `POST /api/reports` → admin-panel queue at `/reports`), category delete with restrict semantics (`DELETE /api/admin/categories/:id`, 409 when any salon service references it), user-suspend → salon cascade (`salons.suspended_cause` distinguishes `admin` suspensions from `owner_suspended` cascades so reactivation only restores the latter), and a polled admin notification queue (`salon_resubmitted` / `report_created`, bell badge in the admin-panel header). See `docs/superpowers/plans/2026-07-10-plan-7-platform-hardening.md`.
- **An admin can approve a pending salon whose owner is suspended.** `PATCH /api/admin/salons/:id/status` has no guard checking the owner's `user.status` before setting `status: 'approved'` — the salon goes publicly live while its owner is locked out of managing it. No guard exists on either side of this interaction.
- **The salon-side effect of a user-suspension cascade is not separately audited.** Suspending/reactivating a user writes one `user.status.set` audit row; the cascaded salon suspension/restoration inside the same transaction has no corresponding audit row. Deliberate — reconstructing a salon's status timeline from audit rows alone has this gap.
- **Admin notifications are one shared queue, not per-admin state.** `admin_notifications.read_at` is a single column on the row itself — one admin marking a notification read marks it read for every admin. Deliberate MVP cut.
- **Blog/content CMS shipped in Plan 8.** A lean `apps/api/src/content/` module (posts + admin-managed categories, `draft` → `published` workflow with conditional-update race guards, cover images through the existing `StorageProvider`, a sitemap source for published articles), an admin-panel Markdown editor with live preview at `/blog`, and public SSR pages in the user-app at `/blog` and `/blog/[slug]`. **XSS safety is by construction:** posts store raw Markdown and both frontends render it through their own `markdown-it` utility configured `html: false`, so raw HTML never parses — each utility carries an invariant test pinning that, and the only two `v-html` bindings in the codebase (admin preview pane, user-app article body) are sanctioned solely by it. Deliberate cuts recorded in the spec (`docs/superpowers/specs/2026-07-10-plan-8-blog-cms-design.md`): no comments or reader interaction, no scheduled publishing, no RSS, no post revisions, and no redirects when a published post's slug changes (the editor warns that editing a published slug changes the URL; unpublish is the soft removal path) — the same risk applies to renaming a category without pinning its slug, which changes `/blog?category=<slug>` URLs. A few smaller fast-follow items from this plan: creating a post with a manually-edited slug applies it via a follow-up PATCH after the initial create — if that PATCH 409s (slug taken), the post silently keeps its auto-generated slug and the only signal is a transient toast; an empty-string `?category=` on the public blog list is treated as no-filter, not as an empty-slug match; storage best-effort deletes (salon photos and blog covers alike) swallow failures with no logging, so orphaned objects accumulate without observability; and a post with neither `metaDescription` nor `excerpt` emits no `description` meta tag at all. Two items from this list were closed in a follow-up fix: the salons and blog sitemap sources are now capped at 50,000 URLs each (Google's single-sitemap-file limit — a real sitemap index is still future work if the platform ever approaches that many rows), and `salons/[slug].vue`/the booking page (`booking/[slug]/[serviceId].vue`) now carry the same root `v-if="page"` guard the blog article page already had, closing the Suspense pre-render-pass crash on their `createError(404)` paths (each has a regression test asserting a clean 404 rejection with no unhandled render error).
- **No real payment refunds**, and no real alerting/paging on the `logger.error(...)` calls that flag payments needing manual review — both are explicit MVP scope cuts, not bugs.
- **Production deployment shipped in Plan 9.** Docker images for all four apps (`Dockerfile` per app, `turbo prune --docker` multi-stage builds), a `docker-compose.prod.yml` adding Caddy (automatic HTTPS + baseline security headers) plus the four app containers to Postgres/Redis, and a GitHub Actions workflow that runs the full test suite on every push/PR and builds+pushes images to GHCR on `main`. Deploying those images to the VPS stays a manual `docker compose pull && up -d` step — see `docs/deployment/DEPLOY.md`. **No database backup automation** — flagged as an immediate next follow-up, not part of this plan's scope. The `api` production image deliberately keeps devDependencies and full source (not just `dist/`) so the existing `pnpm migration:run` script works unchanged via `docker compose exec` — a size/simplicity tradeoff, not an oversight. One real CI-discovered bug remains open: `apps/user-app/e2e/01-happy-path.spec.ts` fails intermittently in a fresh CI environment — marked `continue-on-error` in `.github/workflows/ci.yml` rather than silently dropped. **Investigated in depth (7+ CI round-trips with Playwright trace/network/console capture, `trace: 'retain-on-failure'` now on permanently in `playwright.config.ts` to make the next attempt faster):** the failure is a hard browser reload back to `/login` roughly 450–850ms after `PATCH /auth/profile` succeeds and `navigateTo('/')` fires. Confirmed NOT an auth bug — the reload's own SSR pass shows the session cookie present and the user correctly recognized as logged in. Two real, independently-valuable bugs were found and fixed along the way but neither resolved this specific symptom: (1) a stale-`/auth/me`-probe race in `auth.global.ts` where a slow initial anonymous check could overwrite a newer, authoritative `session.setUser()` call — fixed with a `session.checked` re-check guard, own regression test in `auth.global.spec.ts`; (2) `login.vue`'s three step `<form>`s had no `:key`, so Vue's `v-if`/`v-else-if` patch could reuse the same DOM node across a step transition — keyed each step's form as a general hardening, though CI evidence afterward showed the same failure still occurs, so this wasn't the (sole) mechanism either. Ruled out: Nuxt's built-in chunk-error/manifest-update auto-reload (`chunk-reload.client.js`, `chunk-reload-immediate.client.js` — both reload at the navigation *target*, never at `/login` specifically); the PWA service worker (disabled in dev, no `devOptions.enabled`). Leading unconfirmed theory: a native (non-`.prevent()`-intercepted) form submission on the profile-completion step's submit button, causing a genuine full-page GET to whatever the current URL is at the exact moment of the click — consistent with every observed trace, but the precise trigger (why `@submit.prevent` doesn't reliably intercept in this specific cold-CI-server timing window) is still unconfirmed. Next step for whoever picks this up: instrument the click/submit DOM event directly in the browser (not just server/network traces) to see whether a native `submit` event actually fires alongside the Vue-handled one.
