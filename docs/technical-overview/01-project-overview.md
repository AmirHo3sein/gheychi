# 01 — Project Overview

## What Gheychi is

Gheychi ("scissors" in Persian) is a salon discovery & booking marketplace for the Iranian market. Customers search for salons near them, filter by gender-target/category, view a salon's services/photos/reviews/stories/portfolio, book an appointment with an optional deposit paid online, and manage that booking through to completion or cancellation. Salon owners get a back office to manage their listing, staff, schedule, services, pricing, and see their earnings. Platform staff get a back office to approve/moderate salons and content, manage platform-wide configuration, and administer the financial ledger.

The full original product spec lives at `docs/superpowers/specs/2026-07-04-gheychi-marketplace-design.md`. This documentation set describes what is **actually implemented**, which has grown substantially beyond that original spec through nine subsequent plans/slices (see [26-system-map.md](./26-system-map.md) for the chronology).

## The four apps

Built as a **pnpm + Turborepo monorepo** (`pnpm-workspace.yaml`: `packages: [apps/*, packages/*]` — note `packages/` does not currently exist, so there is no shared code package between apps; see [24-technical-debt.md](./24-technical-debt.md)).

### `apps/api` — the backend
NestJS 11 modular monolith. Every other app is a pure HTTP client of this one backend; there is no other server-side code anywhere in the monorepo. PostgreSQL 16 with the PostGIS extension (geography columns for location/radius search) and Redis (OTP codes, distributed locks, rate limiting, alert dedup). See [02-system-architecture.md](./02-system-architecture.md).

### `apps/user-app` — customer app
Nuxt 4 SSR PWA, Persian/RTL only (no i18n library — this is a single-locale product by design). The only two SSR/SEO-hardened public surfaces are salon profile pages (`/salons/:slug`) and the blog (`/blog`, `/blog/:slug`); everything else requires a session. Installable PWA with Web Push notifications. See [06-user-panel.md](./06-user-panel.md).

### `apps/provider-panel` — salon-owner back office
Vue 3 + Vite SPA, authenticated-only (no SSR need). Covers onboarding, dashboard, bookings, services, coupons, team/workers, hours, photos, stories, portfolio, salon settings, reviews, and earnings. See [07-salon-panel.md](./07-salon-panel.md).

### `apps/admin-panel` — platform staff back office
Vue 3 + Vite SPA, same minimal stack as provider-panel but **no code is shared between the two** — every "shared-looking" file (UI components, composables, utilities) is a deliberately duplicated copy per app, per an explicit "cross-app isolation convention" repeated in code comments throughout the codebase. Covers salon approvals, review/report moderation, categories, users, wallet, invoices, referrals, blog CMS, audit log, and platform config. See [08-admin-panel.md](./08-admin-panel.md).

## Tech stack summary

**Backend**
- NestJS 11, TypeORM 0.3, PostgreSQL 16 + PostGIS, Redis (`ioredis`)
- `class-validator` + `class-transformer`, global `ValidationPipe({ whitelist: true, transform: true })`
- `@nestjs/schedule` for cron jobs, `@nestjs/jwt` for session tokens (HttpOnly cookie, never localStorage)
- Jest (unit + e2e via `supertest`)
- Swappable provider abstractions selected by env var: SMS (Kavenegar), Payments (Zarinpal), Push (Web Push/VAPID), Storage (local disk/S3) — see [19-third-party-services.md](./19-third-party-services.md)

**`apps/user-app`**
- Nuxt 4 (SSR), Vue 3 Composition API, Pinia
- Tailwind CSS v4 via `@tailwindcss/vite` (no `tailwind.config.js` — CSS-first `@theme static {}` config) + CSS custom properties for light/dark theming
- `@vite-pwa/nuxt` (`injectManifest` strategy, custom service worker at `app/sw.ts`)
- `@nuxt/image` with a custom ArvanCloud provider
- Leaflet + CARTO Voyager tiles for maps (no API key required)
- Vitest (unit + Nuxt-environment component tests) + Playwright (e2e)

**`apps/provider-panel` / `apps/admin-panel`**
- Vue 3.5, Vue Router 4, Pinia 3, Vite 6, Tailwind v4
- `vue-multiselect` for multi/single-select fields, `@lucide/vue` icons
- `jalaali-js` for a hand-rolled Shamsi (Jalali) date picker (used in both apps)
- admin-panel additionally: `echarts`/`vue-echarts` (dashboard charts), `markdown-it` (blog editor preview)
- provider-panel additionally: `leaflet` (salon location pin picker)
- Vitest + Playwright, `vue-tsc -b --noEmit` for typechecking

## Ports & local dev

| Service | Port |
|---|---|
| API | 3002 |
| user-app | 3003 |
| provider-panel | 3004 |
| admin-panel | 3005 |
| Postgres (dev, non-default) | 5544 |
| Redis (dev, non-default) | 6381 |

```bash
docker compose up -d                                  # postgres (postgis) + redis
cp .env.example apps/api/.env
pnpm install
pnpm --filter @gheychi/api migration:run
pnpm dev:api / dev:user-app / dev:provider-panel / dev:admin-panel
```

Setup and port details: root `README.md` and `CLAUDE.md`.

## Development history (chronological plans)

The product was built in numbered, sequentially-shipped plans, each with a design spec (`docs/superpowers/specs/`) and an execution record (`docs/superpowers/plans/`):

1. Foundation & backend core (users, salons, search)
2. Booking & payments (Zarinpal, deposits, holds)
3. Reviews & moderation
4. User-app frontend (Plan 4)
5. Provider panel (Plan 5)
6. Admin panel (Plan 6)
7. Platform hardening — audit log, reports, first-admin bootstrap, category delete, cascade suspend, admin notifications (Plan 7)
8. Blog/content CMS (Plan 8)
9. Production deployment — Docker images, Caddy, CI/CD, DB backups (Plan 9)
10. Real payment refunds
11. Money-critical operator alerting
12. Salon showcase — stories, profile, portfolio (2026-07-17)
13. Coupons & per-service discounts (2026-07-19)
14. Referral & rating system — six sequentially-verified slices (2026-07-22)
15. Salon multi-category tagging + worker-level service restrictions (most recent)

Each of these is described in depth in the relevant numbered document in this set; see [26-system-map.md](./26-system-map.md) for a consolidated timeline cross-referenced to the files each plan touched.

## Related documents

- [02-system-architecture.md](./02-system-architecture.md) — how the pieces fit together
- [03-domain-model.md](./03-domain-model.md) — the core business concepts
- [23-known-limitations.md](./23-known-limitations.md) — what's deliberately not built yet
