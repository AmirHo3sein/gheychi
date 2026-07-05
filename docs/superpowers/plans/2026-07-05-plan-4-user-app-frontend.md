# Plan 4 — User App Frontend (Nuxt 4 PWA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first real UI for Arayeshgah — a Nuxt 4 SSR PWA covering login, discovery (list + map), salon profiles, booking, my bookings, and profile — plus an admin-flagged "featured salon" ad placement and push/SMS appointment notifications.

**Note on "Nuxt 4" vs the design docs' "Nuxt 3":** both specs were written using "Nuxt 3" as shorthand for "Nuxt." Nuxt 3 reaches end-of-life this month (July 2026); this plan uses Nuxt 4, the current stable release, confirmed with the user during plan-writing. Nuxt 4's default source layout nests Vue-side code under an `app/` directory (see File Structure below) — the only structural difference that matters for this plan.

**Architecture:** New `apps/user-app` Nuxt 4 workspace package alongside the existing `apps/api` NestJS backend. Backend gets a handful of additive, narrowly-scoped changes (a featured flag + boost query, push subscriptions, a reminder cron job, three new public read endpoints, a favorites table, and two small admin endpoints) — nothing existing is restructured. The frontend is SSR-first for public pages (home, salon profile) and consumes the API via cookie-forwarded fetches.

**Tech Stack:** Nuxt 4, Tailwind CSS, Pinia (auth identity only), `@fontsource/vazirmatn`, Leaflet + Neshan tiles (client-only), `@nuxt/image`, `@vite-pwa/nuxt`, `web-push` (backend), `@nuxtjs/sitemap`, Vitest + `@vue/test-utils` (frontend component tests), Jest + Supertest (backend, existing).

**Design spec:** `docs/superpowers/specs/2026-07-05-plan-4-user-app-frontend-design.md`

---

## Reference: current backend contracts this plan builds on

Confirmed by reading the actual source before writing this plan (not assumed):

- API is mounted under global prefix `/api` (`apps/api/src/main.ts`), session cookie name `session` (see `SESSION_COOKIE` in `auth.guard.ts`), **no CORS is currently enabled**.
- `POST /api/auth/request-otp`, `POST /api/auth/verify-otp` → `{ user: {id,phone,name,gender,role}, isNewUser }`, `GET /api/auth/me`, `PATCH /api/auth/profile`, `POST /api/auth/logout`.
- `GET /api/categories` → `ServiceCategory[]` (`{id, name, icon}`).
- `GET /api/search?lat&lng&gender&radiusKm&categoryId&sort` → `SearchResult[]` (`{id,name,slug,city,address,ratingAvg,ratingCount,distanceKm,minPrice,coverPhoto}`), always filtered to `status='approved'` and `gender_target = :gender`.
- `GET /api/salons/:slug` → full `Salon` row (public, `approved` only). **No endpoint currently returns a salon's services, hours, or photos publicly** — those exist only under the owner-guarded `/api/salons/mine/...` routes, or (for photos) not at all. This plan adds three public read endpoints (Task 5).
- `GET /api/salons/:salonId/availability?serviceId=` → `DayAvailability[]` (`{date: 'YYYY-MM-DD', slots: string[] /* ISO instants */}`).
- `POST /api/bookings` (auth) body `{salonId, serviceId, startsAt}` → `{booking: Booking, paymentUrl: string}`. `GET /api/bookings/mine`, `GET /api/bookings/:id`, `POST /api/bookings/:id/cancel`.
- `Booking` fields: `id, userId, salonId, serviceId, startsAt, endsAt, priceSnapshot, depositAmount, status ('pending_payment'|'confirmed'|'completed'|'cancelled_by_user'|'cancelled_by_salon'|'expired'|'no_show'), createdAt`.
- `GET /api/payments/callback?Authority=&Status=` — Zarinpal redirects here. **Currently returns raw JSON** (`{status, bookingId}`); this plan changes it to an HTTP redirect to the frontend (Task 1), since there's now a frontend to redirect to.
- `POST /api/reviews` (auth) `{bookingId, rating, comment?}`; `GET /api/salons/:salonId/reviews` (public); `PATCH /api/salons/mine/reviews/:id/reply` (owner); `PATCH /api/admin/reviews/:id` (admin).
- `RolesGuard`/`@Roles('admin')` pattern (see `apps/api/src/reviews/admin-reviews.controller.ts`): `@Controller('admin/x') @UseGuards(AuthGuard, RolesGuard) @Roles('admin')`.
- `platform_config` is a `{key varchar PK, value jsonb}` table read via `PlatformConfigService.getNumber(key)`; seeded in `1751600000000-initial-schema.ts`.
- `salon_photos` table (`id, salon_id, url, sort_order, is_cover`) **exists in the schema but has no entity, no controller, and nothing ever inserts into it** — there is no photo upload capability anywhere in the system yet (that belongs to the not-yet-built provider-panel). This plan adds a read-only public endpoint only; galleries will be empty until provider-panel ships photo upload. Tests seed rows directly via SQL.
- No salon-approval admin workflow exists at all (no way to move a salon from `pending` to `approved` via API) — out of scope for this plan; e2e tests set `status='approved'` via direct SQL, matching the existing test pattern in `reviews.e2e-spec.ts` (which sets a user's role to admin the same way).
- e2e test helpers: `loginAs(app, phone)` (`apps/api/test/utils/auth-helper.ts`) returns a `Cookie` header string; `resetDatabase()` (`apps/api/test/utils/db.ts`) drops+recreates the schema and runs migrations; `createTestApp()` (`apps/api/test/utils/test-app.ts`) boots a Nest test app with the same global prefix/pipes as `main.ts`.

## File Structure

### Backend (`apps/api`) — additive changes only

```
apps/api/src/
├── main.ts                                    # MODIFY: enable CORS
├── app.module.ts                               # MODIFY: register PushModule, FavoritesModule
├── migrations/
│   ├── 1751900000000-featured-and-favorites.ts # NEW
│   └── 1752000000000-push-and-reminders.ts     # NEW
├── salons/
│   ├── salon.entity.ts                         # MODIFY: isFeatured, featuredUntil columns
│   ├── admin-salons.controller.ts              # NEW: GET/PATCH featured
│   ├── public-salon-content.controller.ts      # NEW: GET services/hours/photos by slug
│   ├── sitemap-salons.controller.ts            # NEW: GET all approved slugs, for the sitemap
│   ├── salon-photo.entity.ts                   # NEW
│   ├── salons.module.ts                        # MODIFY: register new controllers/entity
│   └── dto/admin-salon.dto.ts                  # NEW
├── search/
│   └── search.service.ts                       # MODIFY: featured boost, cap 2
├── booking/
│   ├── payments.controller.ts                  # MODIFY: redirect instead of JSON
│   ├── payments.service.ts                     # MODIFY: send push alongside SMS
│   ├── booking.entity.ts                       # MODIFY: remindedAt column
│   ├── bookings.service.ts                     # MODIFY: retry-payment, salon/service names on mine/:id
│   ├── bookings.controller.ts                  # MODIFY: POST :id/retry-payment route
│   ├── booking.module.ts                       # MODIFY: register PushModule import
│   └── booking-reminder.job.ts                 # NEW
├── platform-config/
│   ├── platform-config.service.ts              # MODIFY: getReminderLeadHours()
│   ├── platform-config.controller.ts           # NEW: GET booking-terms (deposit/cancellation, public)
│   └── platform-config.module.ts               # MODIFY: register the new controller
├── push/                                        # NEW MODULE
│   ├── push-subscription.entity.ts
│   ├── push.provider.ts                        # interface + injection token
│   ├── console-push.provider.ts                # dev-default implementation
│   ├── web-push.provider.ts                    # web-push implementation
│   ├── push.service.ts                         # sendToUser(), used by booking module
│   ├── push.controller.ts                      # subscribe/unsubscribe
│   └── push.module.ts
├── favorites/                                   # NEW MODULE
│   ├── favorite.entity.ts
│   ├── favorites.controller.ts
│   └── favorites.module.ts
└── test/ (apps/api/test)
    ├── search-featured.e2e-spec.ts             # NEW
    ├── admin-salons.e2e-spec.ts                # NEW
    ├── push.e2e-spec.ts                        # NEW
    ├── booking-reminder.e2e-spec.ts            # NEW
    ├── public-salon-content.e2e-spec.ts        # NEW (also covers the sitemap-slugs route)
    ├── platform-config.e2e-spec.ts             # NEW
    ├── favorites.e2e-spec.ts                   # NEW
    ├── payments.e2e-spec.ts                    # MODIFY: callback redirect + push-on-confirm assertions
    └── bookings.e2e-spec.ts                    # MODIFY: retry-payment + salon/service name assertions
```

### Frontend (`apps/user-app`) — new package

Built on **Nuxt 4** (Nuxt 3 reaches end-of-life this month — see Task 8 for why this plan doesn't literally use "Nuxt 3" as named in both design docs). Nuxt 4 defaults to an `app/` source directory for everything Vue-side; `server/` and `public/` stay at the package root.

```
apps/user-app/
├── package.json / nuxt.config.ts / vitest.config.ts / tsconfig.json / playwright.config.ts
├── app/
│   ├── app.vue
│   ├── sw.ts                                   # custom service worker source (injectManifest)
│   ├── assets/css/main.css                     # Tailwind entry + light/dark theme tokens
│   ├── providers/arvancloud.ts                 # @nuxt/image custom provider
│   ├── utils/
│   │   ├── route-guard.ts                      # isPublicRoute() -- pure, unit-tested
│   │   ├── slot-format.ts                      # pickDefaultDate/formatSlotTime/formatDateLabel -- pure, unit-tested
│   │   └── city-centers.ts                     # geolocation-denied fallback list
│   ├── middleware/
│   │   ├── auth.global.ts                      # redirect to /login if no session (all routes except isPublicRoute)
│   │   └── admin.ts                            # named middleware, gates /admin/* pages
│   ├── layouts/
│   │   ├── default.vue                         # AppHeader + slot
│   │   └── bare.vue                            # no header (login, booking/callback)
│   ├── composables/
│   │   ├── useApi.ts                           # SSR-safe fetch wrapper, 401 redirect, toasts
│   │   ├── useToast.ts
│   │   ├── useTheme.ts
│   │   └── usePushSubscription.ts
│   ├── stores/session.ts                       # Pinia
│   ├── components/
│   │   ├── layout/AppHeader.vue
│   │   ├── layout/ThemeToggle.vue
│   │   ├── layout/ToastStack.vue
│   │   ├── salon/SalonCard.vue
│   │   ├── salon/SalonGallery.vue
│   │   ├── salon/SalonMap.client.vue
│   │   ├── booking/SlotPicker.vue
│   │   └── booking/ReviewPromptModal.vue
│   └── pages/
│       ├── login.vue
│       ├── index.vue                           # Home
│       ├── salons/[slug].vue
│       ├── booking/[slug]/[serviceId].vue
│       ├── booking/callback.vue
│       ├── bookings/index.vue
│       ├── bookings/[id].vue
│       ├── profile.vue
│       └── admin/featured.vue
├── server/
│   └── api/__sitemap__/urls.ts                 # NOT under app/ -- server/ stays at the package root in Nuxt 4
├── public/robots.txt, pwa-192.png, pwa-512.png
├── test/
│   ├── unit/                                   # plain-function tests, no Nuxt context
│   │   ├── route-guard.spec.ts
│   │   └── slot-format.spec.ts
│   └── nuxt/                                   # composable/component tests needing Nuxt auto-imports
│       ├── useApi.spec.ts
│       ├── SlotPicker.spec.ts
│       └── SalonCard.spec.ts
├── e2e/                                        # Playwright, whole-system
│   ├── global-setup.ts
│   ├── happy-path.spec.ts
│   └── admin-featured-badge.spec.ts
└── .env.example
```

---

## Task 1: Backend prep — CORS, frontend base URL, payment callback redirect

**Files:**
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/booking/payments.controller.ts`
- Modify: `apps/api/.env.example` (repo root `.env.example`)
- Test: `apps/api/test/payments.e2e-spec.ts` (existing file — add one test)

- [ ] **Step 1: Read the existing payments callback test to match its style**

Run: `grep -n "callback" apps/api/test/payments.e2e-spec.ts`

Confirm the existing tests assert on JSON bodies like `{ status: 'success', bookingId }` — you're about to change this to a redirect, so those assertions need updating too (Step 3 shows the diff shape; find every `.expect(200)` / body assertion on `/payments/callback` in that file and adapt it the same way).

- [ ] **Step 2: Write the failing test for the new redirect behavior**

Add to `apps/api/test/payments.e2e-spec.ts` (alongside the existing callback describe block):

```typescript
it('redirects to the frontend booking callback page on success', async () => {
  const { bookingId, authority } = await createPendingBooking(app, cookie); // use whatever existing helper this file already uses to get to a pending payment; see the top of this file for the established helper name and reuse it verbatim
  const res = await request(app.getHttpServer())
    .get(`/api/payments/callback?Authority=${authority}&Status=OK`)
    .expect(302);
  expect(res.headers.location).toBe(`http://localhost:3003/booking/callback?status=success&bookingId=${bookingId}`);
});

it('redirects to the frontend booking callback page on failure', async () => {
  const { bookingId, authority } = await createPendingBooking(app, cookie);
  const res = await request(app.getHttpServer())
    .get(`/api/payments/callback?Authority=${authority}&Status=NOK`)
    .expect(302);
  expect(res.headers.location).toBe(`http://localhost:3003/booking/callback?status=failed&bookingId=${bookingId}`);
});
```

Note: replace `createPendingBooking(app, cookie)` with whatever this file's actual existing setup helper is called — read the file first (Step 1) and reuse it; do not invent a new one.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @arayeshgah/api test:e2e -- payments.e2e-spec.ts`
Expected: FAIL — existing tests fail on status code (200 vs 302) since the controller hasn't changed yet.

- [ ] **Step 4: Add `FRONTEND_BASE_URL` to env config**

In `.env.example` (repo root), add after `APP_BASE_URL=http://localhost:3002`:

```
FRONTEND_BASE_URL=http://localhost:3003
```

Also add the same line to `apps/api/.env.test` if that file hardcodes its own values rather than inheriting `.env.example` — check with `cat apps/api/.env.test` first and match its existing style.

- [ ] **Step 5: Enable CORS in `main.ts`**

```typescript
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.FRONTEND_BASE_URL ?? 'http://localhost:3003',
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

- [ ] **Step 6: Change the callback controller to redirect**

```typescript
import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('callback')
  async callback(
    @Query('Authority') authority: string,
    @Query('Status') status: string,
    @Res() res: Response,
  ) {
    const { status: outcome, bookingId } = await this.payments.handleCallback(authority, status);
    const frontendBase = process.env.FRONTEND_BASE_URL ?? 'http://localhost:3003';
    const redirectStatus = outcome === 'failed' ? 'failed' : 'success';
    res.redirect(302, `${frontendBase}/booking/callback?status=${redirectStatus}&bookingId=${bookingId}`);
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @arayeshgah/api test:e2e -- payments.e2e-spec.ts`
Expected: PASS — all tests in the file, including the two new ones and the adapted existing ones.

- [ ] **Step 8: Run the full backend test suite to check for regressions**

Run: `pnpm --filter @arayeshgah/api test && pnpm --filter @arayeshgah/api test:e2e`
Expected: all suites PASS (this touches shared bootstrap code — confirm nothing else silently depended on the JSON response).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/main.ts apps/api/src/booking/payments.controller.ts apps/api/test/payments.e2e-spec.ts .env.example
git commit -m "feat(api): enable CORS and redirect payment callback to the frontend"
```

---

## Task 2: Backend — featured salon flag, boost in search, admin toggle

**Files:**
- Create: `apps/api/src/migrations/1751900000000-featured-and-favorites.ts`
- Modify: `apps/api/src/salons/salon.entity.ts`
- Create: `apps/api/src/salons/dto/admin-salon.dto.ts`
- Create: `apps/api/src/salons/admin-salons.controller.ts`
- Modify: `apps/api/src/salons/salons.module.ts`
- Modify: `apps/api/src/search/search.service.ts`
- Test: `apps/api/test/search-featured.e2e-spec.ts`
- Test: `apps/api/test/admin-salons.e2e-spec.ts`

- [ ] **Step 1: Write the migration** (this migration also creates `salon_favorites` and `salon_photos`-adjacent indexes needed later in this plan — bundling schema changes for Tasks 2 and 6 into one migration file keeps the migration count sane; the favorites table is unused until Task 6 wires it up)

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class FeaturedAndFavorites1751900000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE salons ADD COLUMN is_featured boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE salons ADD COLUMN featured_until timestamptz`);
    await q.query(`CREATE INDEX salons_featured_idx ON salons(is_featured) WHERE is_featured = true`);

    await q.query(`
      CREATE TABLE salon_favorites (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, salon_id)
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE salon_favorites`);
    await q.query(`DROP INDEX salons_featured_idx`);
    await q.query(`ALTER TABLE salons DROP COLUMN featured_until`);
    await q.query(`ALTER TABLE salons DROP COLUMN is_featured`);
  }
}
```

- [ ] **Step 2: Add the new columns to the `Salon` entity**

In `apps/api/src/salons/salon.entity.ts`, add after `ratingCount`:

```typescript
  @Column({ name: 'is_featured', type: 'boolean', default: false })
  isFeatured: boolean;

  @Column({ name: 'featured_until', type: 'timestamptz', nullable: true })
  featuredUntil: Date | null;
```

- [ ] **Step 3: Write the failing e2e test for the search boost**

Create `apps/api/test/search-featured.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { resetDatabase, testDataSource } from './utils/db';

describe('Search — featured salon boost (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedApprovedSalon(name: string, lng: number, lat: number, featured: boolean) {
    const ds = testDataSource();
    await ds.initialize();
    const [{ id: ownerId }] = await ds.query(
      `INSERT INTO users (phone, role) VALUES ($1, 'provider') RETURNING id`,
      [`09${Math.floor(100000000 + Math.random() * 899999999)}`],
    );
    const slug = name.toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 7);
    const [{ id }] = await ds.query(
      `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location, is_featured)
       VALUES ($1, $2, $3, 'women', 'approved', 'test address', 'Tehran',
         ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6)
       RETURNING id`,
      [ownerId, name, slug, lng, lat, featured],
    );
    await ds.destroy();
    return id as string;
  }

  it('places featured salons ahead of closer non-featured ones, capped at 2', async () => {
    // all salons within a few hundred meters of this point
    const lng = 51.389, lat = 35.7;
    await seedApprovedSalon('Closest Non-Featured', lng + 0.0001, lat, false);
    const featured1 = await seedApprovedSalon('Featured One', lng + 0.01, lat, true);
    const featured2 = await seedApprovedSalon('Featured Two', lng + 0.011, lat, true);
    await seedApprovedSalon('Featured Three (over cap)', lng + 0.012, lat, true);

    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat, lng, gender: 'women', radiusKm: 5 })
      .expect(200);

    const featuredCount = res.body.filter((r: { isFeatured: boolean }) => r.isFeatured).length;
    expect(featuredCount).toBe(2);
    expect(res.body[0].isFeatured).toBe(true);
    expect(res.body[1].isFeatured).toBe(true);
    expect([featured1, featured2]).toContain(res.body[0].id);
    expect([featured1, featured2]).toContain(res.body[1].id);
  });

  it('never surfaces a featured salon that does not match the gender filter', async () => {
    const lng = 51.4, lat = 35.71;
    const ds = testDataSource();
    await ds.initialize();
    const [{ id: ownerId }] = await ds.query(
      `INSERT INTO users (phone, role) VALUES ($1, 'provider') RETURNING id`,
      [`09${Math.floor(100000000 + Math.random() * 899999999)}`],
    );
    await ds.query(
      `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location, is_featured)
       VALUES ($1, 'Mens Featured', 'mens-featured-test', 'men', 'approved', 'addr', 'Tehran',
         ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, true)`,
      [ownerId, lng, lat],
    );
    await ds.destroy();

    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat, lng, gender: 'women', radiusKm: 1 })
      .expect(200);

    expect(res.body.find((r: { name: string }) => r.name === 'Mens Featured')).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test:e2e -- search-featured.e2e-spec.ts`
Expected: FAIL — `isFeatured` is `undefined` in the response, ordering doesn't boost featured salons.

- [ ] **Step 5: Implement the boost in `SearchService`**

**Corrected during code review (execution):** the first version of this cap logic demoted an over-cap featured salon's `isFeatured` flag to `false` but left it in its original SQL-ordered position — still ranked ahead of closer/higher-rated non-featured salons. That defeats the point of the cap. The version below merges demoted overflow entries back into the non-featured tail by the same sort key, so an over-cap salon lands exactly where it would have ranked if it had never been featured.

Replace the body of `apps/api/src/search/search.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SearchQueryDto } from './dto/search.dto';

export interface SearchResult {
  id: string;
  name: string;
  slug: string;
  city: string;
  address: string;
  ratingAvg: number;
  ratingCount: number;
  distanceKm: number;
  minPrice: number | null;
  coverPhoto: string | null;
  isFeatured: boolean;
}

const FEATURED_CAP = 2;

@Injectable()
export class SearchService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async search(q: SearchQueryDto): Promise<SearchResult[]> {
    const radiusMeters = (q.radiusKm ?? 5) * 1000;
    const sortByRating = q.sort === 'rating';
    const secondarySort = sortByRating ? 's.rating_avg DESC, distance_km ASC' : 'distance_km ASC';

    const rows = await this.dataSource.query(
      `
      SELECT
        s.id, s.name, s.slug, s.city, s.address,
        s.rating_avg, s.rating_count,
        (s.is_featured AND (s.featured_until IS NULL OR s.featured_until > now())) AS is_featured,
        ST_Distance(s.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0 AS distance_km,
        (SELECT MIN(ss.price) FROM salon_services ss
           WHERE ss.salon_id = s.id AND ss.is_active
             AND ($5::int IS NULL OR ss.category_id = $5)) AS min_price,
        (SELECT sp.url FROM salon_photos sp
           WHERE sp.salon_id = s.id ORDER BY sp.is_cover DESC, sp.sort_order ASC LIMIT 1) AS cover_photo
      FROM salons s
      WHERE s.status = 'approved'
        AND s.gender_target = $3
        AND ST_DWithin(s.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $4)
        AND ($5::int IS NULL OR EXISTS (
          SELECT 1 FROM salon_services ss2
          WHERE ss2.salon_id = s.id AND ss2.category_id = $5 AND ss2.is_active))
      ORDER BY is_featured DESC, ${secondarySort}
      LIMIT 50
      -- MVP cap, no pagination yet. Revisit if a single search radius
      -- can plausibly exceed 50 approved salons.
      `,
      [q.lng, q.lat, q.gender, radiusMeters, q.categoryId ?? null],
    );

    const mapped = rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      name: r.name as string,
      slug: r.slug as string,
      city: r.city as string,
      address: r.address as string,
      ratingAvg: Number(r.rating_avg),
      ratingCount: Number(r.rating_count),
      distanceKm: Number(r.distance_km),
      minPrice: r.min_price === null ? null : Number(r.min_price),
      coverPhoto: (r.cover_photo as string) ?? null,
      isFeatured: r.is_featured as boolean,
    }));

    // The query already orders featured salons first (each group internally sorted by
    // secondarySort); enforce the display cap here so no more than FEATURED_CAP results
    // ever carry the featured boost/badge. Salons past the cap must NOT simply keep their
    // spot in the featured block -- they have to fall back to wherever they'd rank among
    // the non-featured results, or the cap does nothing to bound how far an over-featured
    // catalog can distort results. Since both the kept-featured and non-featured slices are
    // already sorted by secondarySort, demoted overflow entries can be merged into the
    // non-featured tail with a simple sorted merge instead of a full re-sort.
    const compare = (a: SearchResult, b: SearchResult): number => {
      if (sortByRating && a.ratingAvg !== b.ratingAvg) return b.ratingAvg - a.ratingAvg;
      return a.distanceKm - b.distanceKm;
    };

    const featuredKept: SearchResult[] = [];
    const overflow: SearchResult[] = [];
    const nonFeatured: SearchResult[] = [];
    let featuredSeen = 0;
    for (const r of mapped) {
      if (!r.isFeatured) {
        nonFeatured.push(r);
        continue;
      }
      featuredSeen += 1;
      if (featuredSeen <= FEATURED_CAP) {
        featuredKept.push(r);
      } else {
        overflow.push({ ...r, isFeatured: false });
      }
    }

    const merged: SearchResult[] = [];
    let i = 0;
    let j = 0;
    while (i < overflow.length && j < nonFeatured.length) {
      merged.push(compare(overflow[i], nonFeatured[j]) <= 0 ? overflow[i++] : nonFeatured[j++]);
    }
    while (i < overflow.length) merged.push(overflow[i++]);
    while (j < nonFeatured.length) merged.push(nonFeatured[j++]);

    return [...featuredKept, ...merged];
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test:e2e -- search-featured.e2e-spec.ts`
Expected: PASS

- [ ] **Step 7: Write the failing e2e test for the admin endpoints**

Create `apps/api/test/admin-salons.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { loginAs } from './utils/auth-helper';
import { resetDatabase, testDataSource } from './utils/db';

describe('Admin — featured salon toggle (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let salonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAs(app, '09120000001');

    const ds = testDataSource();
    await ds.initialize();
    await ds.query(`UPDATE users SET role = 'admin' WHERE phone = '09120000001'`);
    const [{ id: ownerId }] = await ds.query(
      `INSERT INTO users (phone, role) VALUES ('09120000002', 'provider') RETURNING id`,
    );
    const [{ id }] = await ds.query(
      `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
       VALUES ($1, 'Test Salon', 'test-salon-admin', 'women', 'approved', 'addr', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.4, 35.7), 4326)::geography)
       RETURNING id`,
      [ownerId],
    );
    salonId = id;
    await ds.destroy();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a non-admin caller', async () => {
    const customerCookie = await loginAs(app, '09120000003');
    await request(app.getHttpServer())
      .get('/api/admin/salons')
      .set('Cookie', customerCookie)
      .expect(403);
  });

  it('lists approved salons for an admin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.find((s: { id: string }) => s.id === salonId)).toBeDefined();
  });

  it('toggles a salon to featured with an expiry', async () => {
    const featuredUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/featured`)
      .set('Cookie', adminCookie)
      .send({ isFeatured: true, featuredUntil })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/admin/salons')
      .set('Cookie', adminCookie)
      .expect(200);
    const updated = res.body.find((s: { id: string }) => s.id === salonId);
    expect(updated.isFeatured).toBe(true);
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test:e2e -- admin-salons.e2e-spec.ts`
Expected: FAIL — `/api/admin/salons` doesn't exist (404).

- [ ] **Step 9: Write the admin DTO and controller**

Create `apps/api/src/salons/dto/admin-salon.dto.ts`:

```typescript
import { IsBoolean, IsISO8601, IsOptional } from 'class-validator';

export class SetFeaturedDto {
  @IsBoolean()
  isFeatured: boolean;

  @IsOptional()
  @IsISO8601()
  featuredUntil?: string;
}
```

Create `apps/api/src/salons/admin-salons.controller.ts`:

```typescript
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SetFeaturedDto } from './dto/admin-salon.dto';
import { Salon } from './salon.entity';

@Controller('admin/salons')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminSalonsController {
  constructor(@InjectRepository(Salon) private readonly salons: Repository<Salon>) {}

  @Get()
  list() {
    return this.salons.find({
      where: { status: 'approved' },
      select: ['id', 'name', 'city', 'isFeatured', 'featuredUntil'],
      order: { name: 'ASC' },
    });
  }

  @Patch(':id/featured')
  async setFeatured(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetFeaturedDto) {
    const result = await this.salons.update(
      { id },
      { isFeatured: dto.isFeatured, featuredUntil: dto.featuredUntil ? new Date(dto.featuredUntil) : null },
    );
    if (!result.affected) throw new NotFoundException();
    return this.salons.findOneBy({ id });
  }
}
```

(`NotFoundException` needs adding to the `@nestjs/common` import line above — corrected during code review: `ParseUUIDPipe` only validates format, so a well-formed but non-existent salon ID originally fell through to a silent `200` with a `null` body, unlike every other write path in this module.)

- [ ] **Step 10: Register the controller**

In `apps/api/src/salons/salons.module.ts`, add `AdminSalonsController` to the `controllers` array (alongside the existing ones) — read the file first to match its existing import/array style exactly.

- [ ] **Step 11: Run the test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test:e2e -- admin-salons.e2e-spec.ts`
Expected: PASS

- [ ] **Step 12: Run the full backend suite**

Run: `pnpm --filter @arayeshgah/api test && pnpm --filter @arayeshgah/api test:e2e`
Expected: all PASS

- [ ] **Step 13: Commit**

```bash
git add apps/api/src/migrations/1751900000000-featured-and-favorites.ts apps/api/src/salons apps/api/src/search/search.service.ts apps/api/test/search-featured.e2e-spec.ts apps/api/test/admin-salons.e2e-spec.ts
git commit -m "feat(api): admin-flagged featured salons, boosted in search results"
```

---

## Task 3: Backend — public salon content endpoints (services, hours, photos)

**Files:**
- Create: `apps/api/src/salons/salon-photo.entity.ts`
- Create: `apps/api/src/salons/public-salon-content.controller.ts`
- Modify: `apps/api/src/salons/salons.module.ts`
- Test: `apps/api/test/public-salon-content.e2e-spec.ts`

- [ ] **Step 1: Write the failing e2e test**

Create `apps/api/test/public-salon-content.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { resetDatabase, testDataSource } from './utils/db';

describe('Public salon content (e2e)', () => {
  let app: INestApplication;
  let slug: string;
  let salonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    const ds = testDataSource();
    await ds.initialize();
    const [{ id: ownerId }] = await ds.query(
      `INSERT INTO users (phone, role) VALUES ('09130000001', 'provider') RETURNING id`,
    );
    slug = 'content-test-salon';
    const [{ id }] = await ds.query(
      `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
       VALUES ($1, 'Content Test Salon', $2, 'women', 'approved', 'addr', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.4, 35.7), 4326)::geography)
       RETURNING id`,
      [ownerId, slug],
    );
    salonId = id;
    const [{ id: categoryId }] = await ds.query(`SELECT id FROM service_categories LIMIT 1`);
    await ds.query(
      `INSERT INTO salon_services (salon_id, category_id, name, price, duration_min, is_active)
       VALUES ($1, $2, 'Haircut', 300000, 30, true), ($1, $2, 'Inactive Service', 100000, 15, false)`,
      [salonId, categoryId],
    );
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time) VALUES ($1, 6, '09:00', '18:00')`,
      [salonId],
    );
    await ds.query(
      `INSERT INTO salon_photos (salon_id, url, sort_order, is_cover) VALUES
        ($1, 'https://cdn.example.com/cover.jpg', 0, true),
        ($1, 'https://cdn.example.com/second.jpg', 1, false)`,
      [salonId],
    );
    await ds.destroy();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists only active services for a salon', async () => {
    const res = await request(app.getHttpServer()).get(`/api/salons/${slug}/services`).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Haircut');
  });

  it('lists working hours for a salon', async () => {
    const res = await request(app.getHttpServer()).get(`/api/salons/${slug}/hours`).expect(200);
    expect(res.body).toEqual([expect.objectContaining({ weekday: 6, openTime: '09:00:00', closeTime: '18:00:00' })]);
  });

  it('lists photos ordered cover-first', async () => {
    const res = await request(app.getHttpServer()).get(`/api/salons/${slug}/photos`).expect(200);
    expect(res.body.map((p: { url: string }) => p.url)).toEqual([
      'https://cdn.example.com/cover.jpg',
      'https://cdn.example.com/second.jpg',
    ]);
  });

  it('404s for an unknown slug on all three endpoints', async () => {
    await request(app.getHttpServer()).get('/api/salons/does-not-exist/services').expect(404);
    await request(app.getHttpServer()).get('/api/salons/does-not-exist/hours').expect(404);
    await request(app.getHttpServer()).get('/api/salons/does-not-exist/photos').expect(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test:e2e -- public-salon-content.e2e-spec.ts`
Expected: FAIL (404s on all real requests too, but for the wrong reason — the routes don't exist yet; this will become clear once you diff against the "unknown slug" 404 case after implementing).

- [ ] **Step 3: Create the `SalonPhoto` entity**

```typescript
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('salon_photos')
export class SalonPhoto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column()
  url: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_cover', type: 'boolean', default: false })
  isCover: boolean;
}
```

- [ ] **Step 4: Implement the public content controller**

**Corrected during code review (execution):** the first version looked up the salon directly via an injected `Repository<Salon>`, duplicating the exact `{slug, status: 'approved'}` visibility rule that `SalonsService.findPublicBySlug` already encodes. The version below delegates to that service instead, so "what makes a salon publicly visible" has one definition, not two.

```typescript
import { Controller, Get, Param } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalonService } from './salon-service.entity';
import { SalonPhoto } from './salon-photo.entity';
import { SalonsService } from './salons.service';
import { WorkingHour } from './working-hour.entity';

@Controller('salons/:slug')
export class PublicSalonContentController {
  constructor(
    private readonly salonsService: SalonsService,
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    @InjectRepository(WorkingHour) private readonly hours: Repository<WorkingHour>,
    @InjectRepository(SalonPhoto) private readonly photos: Repository<SalonPhoto>,
  ) {}

  private async requireSalonId(slug: string): Promise<string> {
    const salon = await this.salonsService.findPublicBySlug(slug);
    return salon.id;
  }

  @Get('services')
  async listServices(@Param('slug') slug: string) {
    const salonId = await this.requireSalonId(slug);
    return this.services.find({ where: { salonId, isActive: true }, order: { createdAt: 'ASC' } });
  }

  @Get('hours')
  async listHours(@Param('slug') slug: string) {
    const salonId = await this.requireSalonId(slug);
    return this.hours.find({ where: { salonId }, order: { weekday: 'ASC', openTime: 'ASC' } });
  }

  @Get('photos')
  async listPhotos(@Param('slug') slug: string) {
    const salonId = await this.requireSalonId(slug);
    return this.photos.find({ where: { salonId }, order: { isCover: 'DESC', sortOrder: 'ASC' } });
  }
}
```

Note the route path is `salons/:slug` (not `salons/:slug/...` per method) so Nest composes `GET /salons/:slug/services` etc. — this sits alongside the existing `SalonsController` which owns bare `GET /salons/:slug`; make sure this new controller is registered so its more specific paths don't get shadowed (NestJS matches routes in registration order per controller, and since `services`/`hours`/`photos` are literal path segments distinct from the `SalonsController`'s param-only `:slug` route... actually **both controllers define `GET /salons/:slug/...` vs `GET /salons/:slug`, which don't conflict** — only exactly-identical paths conflict. No ordering fix needed, but register `PublicSalonContentController` in the module regardless).

- [ ] **Step 5: Register the entity and controller**

In `apps/api/src/salons/salons.module.ts`: add `SalonPhoto` to the `TypeOrmModule.forFeature([...])` array, and `PublicSalonContentController` to `controllers`, **after** `SalonServicesController` and `ScheduleController` in that array (both own literal `salons/mine/...`-shaped routes at the same path depth as this controller's `salons/:slug/...` routes — NestJS/Express matches by registration order, not specificity, so registering this controller earlier would silently shadow those literal routes). Add a short comment above its entry recording this constraint, since nothing else about the file signals it. Read the file first to match its existing style.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test:e2e -- public-salon-content.e2e-spec.ts`
Expected: PASS

- [ ] **Step 7: Run the full backend suite**

Run: `pnpm --filter @arayeshgah/api test && pnpm --filter @arayeshgah/api test:e2e`
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/salons/salon-photo.entity.ts apps/api/src/salons/public-salon-content.controller.ts apps/api/src/salons/salons.module.ts apps/api/test/public-salon-content.e2e-spec.ts
git commit -m "feat(api): public read endpoints for a salon's services, hours, and photos"
```

---

## Task 4: Backend — saved salons (favorites)

**Files:**
- Create: `apps/api/src/favorites/favorite.entity.ts`
- Create: `apps/api/src/favorites/favorites.controller.ts`
- Create: `apps/api/src/favorites/favorites.module.ts`
- Create: `apps/api/src/common/postgres-error-codes.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/reviews/reviews.service.ts` (pure refactor — see the note on Step 4 below)
- Test: `apps/api/test/favorites.e2e-spec.ts`

The `salon_favorites` table was already created in Task 2's migration (`1751900000000-featured-and-favorites.ts`) — no new migration needed here.

**Corrected during code review (execution):** the original controller's `POST` handler used a plain check-then-insert with no protection against a genuine concurrent double-favorite (two simultaneous requests can both pass the existence check before either inserts, and the second hits the composite-PK unique violation as an unhandled 500). Step 4 below fixes this using the exact same pattern already established in `apps/api/src/reviews/reviews.service.ts` for the identical class of problem — catch the Postgres unique-violation error code and treat it as the no-op it semantically is. Since that error code was about to be defined in two places, it's hoisted into a small shared `apps/api/src/common/postgres-error-codes.ts` module that both files import, rather than staying duplicated.

- [ ] **Step 1: Write the failing e2e test**

Create `apps/api/test/favorites.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { loginAs } from './utils/auth-helper';
import { resetDatabase, testDataSource } from './utils/db';

describe('Favorites (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let salonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09140000001');

    const ds = testDataSource();
    await ds.initialize();
    const [{ id: ownerId }] = await ds.query(
      `INSERT INTO users (phone, role) VALUES ('09140000002', 'provider') RETURNING id`,
    );
    const [{ id }] = await ds.query(
      `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
       VALUES ($1, 'Favorite Test Salon', 'favorite-test-salon', 'women', 'approved', 'addr', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.4, 35.7), 4326)::geography)
       RETURNING id`,
      [ownerId],
    );
    salonId = id;
    await ds.destroy();
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts with an empty favorites list', async () => {
    const res = await request(app.getHttpServer()).get('/api/favorites').set('Cookie', cookie).expect(200);
    expect(res.body).toEqual([]);
  });

  it('adds and lists a favorite', async () => {
    await request(app.getHttpServer()).post(`/api/salons/${salonId}/favorite`).set('Cookie', cookie).expect(201);
    const res = await request(app.getHttpServer()).get('/api/favorites').set('Cookie', cookie).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(salonId);
  });

  it('is idempotent when favoriting twice', async () => {
    await request(app.getHttpServer()).post(`/api/salons/${salonId}/favorite`).set('Cookie', cookie).expect(201);
    const res = await request(app.getHttpServer()).get('/api/favorites').set('Cookie', cookie).expect(200);
    expect(res.body).toHaveLength(1);
  });

  it('removes a favorite', async () => {
    await request(app.getHttpServer()).delete(`/api/salons/${salonId}/favorite`).set('Cookie', cookie).expect(204);
    const res = await request(app.getHttpServer()).get('/api/favorites').set('Cookie', cookie).expect(200);
    expect(res.body).toEqual([]);
  });

  it('no-ops when deleting a favorite that was never added', async () => {
    await request(app.getHttpServer())
      .delete('/api/salons/00000000-0000-0000-0000-000000000000/favorite')
      .set('Cookie', cookie)
      .expect(204);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test:e2e -- favorites.e2e-spec.ts`
Expected: FAIL — 404s, nothing implemented yet.

- [ ] **Step 3: Create the `Favorite` entity**

```typescript
import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('salon_favorites')
export class Favorite {
  @PrimaryColumn({ name: 'user_id' })
  userId: string;

  @PrimaryColumn({ name: 'salon_id' })
  salonId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 4: Create the shared Postgres error-code constant, then the controller**

First, create `apps/api/src/common/postgres-error-codes.ts` (this is the first file under `common/` in this codebase — create the directory):

```typescript
/** Postgres error codes referenced when translating `QueryFailedError`s into clean HTTP responses. */
export const UNIQUE_VIOLATION = '23505';
```

Then update `apps/api/src/reviews/reviews.service.ts`: remove its own local `const UNIQUE_VIOLATION = '23505';` and instead `import { UNIQUE_VIOLATION } from '../common/postgres-error-codes';`. This is a pure refactor of an already-shipped file — same behavior, single source of truth for the error code, since the controller below is about to need the exact same constant.

```typescript
import {
  Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { QueryFailedError, Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { UNIQUE_VIOLATION } from '../common/postgres-error-codes';
import { Salon } from '../salons/salon.entity';
import { User } from '../users/user.entity';
import { Favorite } from './favorite.entity';

@Controller()
@UseGuards(AuthGuard)
export class FavoritesController {
  constructor(
    @InjectRepository(Favorite) private readonly favorites: Repository<Favorite>,
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
  ) {}

  @Get('favorites')
  async list(@Req() req: Request) {
    const rows = await this.favorites.find({ where: { userId: (req.user as User).id } });
    if (rows.length === 0) return [];
    return this.salons.find({ where: rows.map((r) => ({ id: r.salonId })) });
  }

  @Post('salons/:id/favorite')
  async add(@Req() req: Request, @Param('id', ParseUUIDPipe) salonId: string) {
    const userId = (req.user as User).id;
    const existing = await this.favorites.findOneBy({ userId, salonId });
    if (existing) return { ok: true };
    try {
      await this.favorites.save(this.favorites.create({ userId, salonId }));
    } catch (err) {
      // The pre-check above handles the common case, but the composite
      // (user_id, salon_id) PRIMARY KEY is the actual source of truth --
      // two truly concurrent POSTs can both pass the check above before either
      // inserts. Treat the resulting unique violation as the no-op it
      // semantically is, rather than letting it surface as an unhandled 500.
      if (!(err instanceof QueryFailedError) || (err as unknown as { code?: string }).code !== UNIQUE_VIOLATION) {
        throw err;
      }
    }
    return { ok: true };
  }

  @Delete('salons/:id/favorite')
  @HttpCode(204)
  async remove(@Req() req: Request, @Param('id', ParseUUIDPipe) salonId: string) {
    await this.favorites.delete({ userId: (req.user as User).id, salonId });
  }
}
```

- [ ] **Step 5: Create the module and register it**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Salon } from '../salons/salon.entity';
import { Favorite } from './favorite.entity';
import { FavoritesController } from './favorites.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Favorite, Salon]), AuthModule],
  controllers: [FavoritesController],
})
export class FavoritesModule {}
```

In `apps/api/src/app.module.ts`, import and register `FavoritesModule` in the `imports` array (read the file first to match its existing ordering/style).

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test:e2e -- favorites.e2e-spec.ts`
Expected: PASS

- [ ] **Step 7: Run the full backend suite**

Run: `pnpm --filter @arayeshgah/api test && pnpm --filter @arayeshgah/api test:e2e`
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/favorites apps/api/src/app.module.ts apps/api/test/favorites.e2e-spec.ts
git commit -m "feat(api): saved salons (favorites)"
```

---

## Task 5: Backend — push notification infrastructure

**Files:**
- Create: `apps/api/src/migrations/1752000000000-push-and-reminders.ts`
- Create: `apps/api/src/push/push-subscription.entity.ts`
- Create: `apps/api/src/push/push.provider.ts`
- Create: `apps/api/src/push/console-push.provider.ts`
- Create: `apps/api/src/push/web-push.provider.ts`
- Create: `apps/api/src/push/push.service.ts`
- Create: `apps/api/src/push/push.controller.ts`
- Create: `apps/api/src/push/dto/push.dto.ts`
- Create: `apps/api/src/push/push.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/package.json` (add `web-push` dependency)
- Modify: `.env.example`
- Test: `apps/api/test/push.e2e-spec.ts`

This migration also adds `bookings.reminded_at` and seeds the `reminder_lead_hours` platform_config key, both used by Task 7 — bundled here to keep the migration count reasonable, same as Task 2.

- [ ] **Step 1: Install `web-push`**

Run: `pnpm --filter @arayeshgah/api add web-push` and `pnpm --filter @arayeshgah/api add -D @types/web-push`

- [ ] **Step 2: Write the migration**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class PushAndReminders1752000000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE push_subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint text NOT NULL UNIQUE,
        p256dh varchar(255) NOT NULL,
        auth varchar(255) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX push_subscriptions_user_idx ON push_subscriptions(user_id)`);

    await q.query(`ALTER TABLE bookings ADD COLUMN reminded_at timestamptz`);

    await q.query(`INSERT INTO platform_config (key, value) VALUES ('reminder_lead_hours', '3')`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM platform_config WHERE key = 'reminder_lead_hours'`);
    await q.query(`ALTER TABLE bookings DROP COLUMN reminded_at`);
    await q.query(`DROP TABLE push_subscriptions`);
  }
}
```

- [ ] **Step 3: Write the failing e2e test for subscribe/unsubscribe**

Create `apps/api/test/push.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { loginAs } from './utils/auth-helper';
import { resetDatabase, testDataSource } from './utils/db';

describe('Push subscriptions (e2e)', () => {
  let app: INestApplication;
  let cookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09150000001');
  });

  afterAll(async () => {
    await app.close();
  });

  it('subscribes a device', async () => {
    await request(app.getHttpServer())
      .post('/api/push/subscribe')
      .set('Cookie', cookie)
      .send({ endpoint: 'https://push.example.com/device-1', p256dh: 'key1', auth: 'auth1' })
      .expect(201);

    const ds = testDataSource();
    await ds.initialize();
    const rows = await ds.query(`SELECT * FROM push_subscriptions WHERE endpoint = $1`, [
      'https://push.example.com/device-1',
    ]);
    await ds.destroy();
    expect(rows).toHaveLength(1);
  });

  it('is idempotent for the same endpoint (updates keys rather than duplicating)', async () => {
    await request(app.getHttpServer())
      .post('/api/push/subscribe')
      .set('Cookie', cookie)
      .send({ endpoint: 'https://push.example.com/device-1', p256dh: 'key1-updated', auth: 'auth1' })
      .expect(201);

    const ds = testDataSource();
    await ds.initialize();
    const rows = await ds.query(`SELECT * FROM push_subscriptions WHERE endpoint = $1`, [
      'https://push.example.com/device-1',
    ]);
    await ds.destroy();
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe('key1-updated');
  });

  it('unsubscribes a device', async () => {
    await request(app.getHttpServer())
      .delete('/api/push/subscribe')
      .set('Cookie', cookie)
      .send({ endpoint: 'https://push.example.com/device-1' })
      .expect(204);

    const ds = testDataSource();
    await ds.initialize();
    const rows = await ds.query(`SELECT * FROM push_subscriptions WHERE endpoint = $1`, [
      'https://push.example.com/device-1',
    ]);
    await ds.destroy();
    expect(rows).toHaveLength(0);
  });

  it('rejects an unauthenticated subscribe attempt', async () => {
    await request(app.getHttpServer())
      .post('/api/push/subscribe')
      .send({ endpoint: 'https://push.example.com/device-2', p256dh: 'k', auth: 'a' })
      .expect(401);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test:e2e -- push.e2e-spec.ts`
Expected: FAIL — `/api/push/subscribe` doesn't exist (404).

- [ ] **Step 5: Create the entity, provider interface, and both provider implementations**

`apps/api/src/push/push-subscription.entity.ts`:

```typescript
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('push_subscriptions')
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ unique: true })
  endpoint: string;

  @Column()
  p256dh: string;

  @Column()
  auth: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

`apps/api/src/push/push.provider.ts`:

```typescript
export const PUSH_PROVIDER = 'PUSH_PROVIDER';

export interface PushPayload {
  title: string;
  body: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushProvider {
  send(target: PushTarget, payload: PushPayload): Promise<void>;
}
```

`apps/api/src/push/console-push.provider.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PushPayload, PushProvider, PushTarget } from './push.provider';

@Injectable()
export class ConsolePushProvider implements PushProvider {
  private readonly logger = new Logger('Push');

  async send(target: PushTarget, payload: PushPayload): Promise<void> {
    this.logger.log(`Push to ${target.endpoint}: ${payload.title} — ${payload.body}`);
  }
}
```

`apps/api/src/push/web-push.provider.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { PushPayload, PushProvider, PushTarget } from './push.provider';

@Injectable()
export class WebPushProvider implements PushProvider {
  private readonly logger = new Logger('Push');

  constructor(publicKey: string, privateKey: string, subject: string) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  async send(target: PushTarget, payload: PushPayload): Promise<void> {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
      );
    } catch (err) {
      this.logger.warn(`Push send failed for ${target.endpoint}: ${(err as Error).message}`);
      throw err;
    }
  }
}
```

- [ ] **Step 6: Create the DTO**

```typescript
import { IsString, IsUrl } from 'class-validator';

export class SubscribePushDto {
  @IsUrl({ require_tld: false })
  endpoint: string;

  @IsString()
  p256dh: string;

  @IsString()
  auth: string;
}

export class UnsubscribePushDto {
  @IsUrl({ require_tld: false })
  endpoint: string;
}
```

- [ ] **Step 7: Create `PushService`**

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PushSubscription } from './push-subscription.entity';
import { PUSH_PROVIDER, PushPayload, PushProvider } from './push.provider';

@Injectable()
export class PushService {
  constructor(
    @InjectRepository(PushSubscription) private readonly subs: Repository<PushSubscription>,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
  ) {}

  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    const subscriptions = await this.subs.find({ where: { userId } });
    // Best-effort, per the design spec's error-handling section: a push failure on one
    // device (or all of them) never throws back to the caller.
    await Promise.all(subscriptions.map((s) => this.provider.send(s, payload).catch(() => {})));
  }
}
```

- [ ] **Step 8: Create the controller**

```typescript
import { Body, Controller, Delete, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import { SubscribePushDto, UnsubscribePushDto } from './dto/push.dto';
import { PushSubscription } from './push-subscription.entity';

@Controller('push')
@UseGuards(AuthGuard)
export class PushController {
  constructor(
    @InjectRepository(PushSubscription) private readonly subs: Repository<PushSubscription>,
  ) {}

  @Post('subscribe')
  async subscribe(@Req() req: Request, @Body() dto: SubscribePushDto) {
    const userId = (req.user as User).id;
    const existing = await this.subs.findOneBy({ endpoint: dto.endpoint });
    if (existing) {
      await this.subs.update({ endpoint: dto.endpoint }, { userId, p256dh: dto.p256dh, auth: dto.auth });
    } else {
      await this.subs.save(this.subs.create({ userId, ...dto }));
    }
    return { ok: true };
  }

  @Delete('subscribe')
  @HttpCode(204)
  async unsubscribe(@Body() dto: UnsubscribePushDto) {
    await this.subs.delete({ endpoint: dto.endpoint });
  }
}
```

- [ ] **Step 9: Create the module**

```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ConsolePushProvider } from './console-push.provider';
import { PushSubscription } from './push-subscription.entity';
import { PUSH_PROVIDER } from './push.provider';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { WebPushProvider } from './web-push.provider';

@Module({
  imports: [TypeOrmModule.forFeature([PushSubscription]), AuthModule],
  controllers: [PushController],
  providers: [
    PushService,
    {
      provide: PUSH_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get('PUSH_PROVIDER') === 'webpush'
          ? new WebPushProvider(
              config.getOrThrow('VAPID_PUBLIC_KEY'),
              config.getOrThrow('VAPID_PRIVATE_KEY'),
              config.getOrThrow('VAPID_SUBJECT'),
            )
          : new ConsolePushProvider(),
    },
  ],
  exports: [PushService],
})
export class PushModule {}
```

- [ ] **Step 10: Register `PushModule` in `app.module.ts`**

Add `PushModule` to the `imports` array — read the file first to match its existing ordering/style.

- [ ] **Step 11: Add new env vars**

In `.env.example`, add:

```
PUSH_PROVIDER=console
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@arayeshgah.ir
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test:e2e -- push.e2e-spec.ts`
Expected: PASS

- [ ] **Step 13: Run the full backend suite**

Run: `pnpm --filter @arayeshgah/api test && pnpm --filter @arayeshgah/api test:e2e`
Expected: all PASS

- [ ] **Step 14: Commit**

```bash
git add apps/api/src/migrations/1752000000000-push-and-reminders.ts apps/api/src/push apps/api/src/app.module.ts apps/api/package.json pnpm-lock.yaml .env.example apps/api/test/push.e2e-spec.ts
git commit -m "feat(api): push notification subscription infrastructure"
```

---

## Task 6: Backend — send push alongside SMS on booking confirmation

**Files:**
- Modify: `apps/api/src/booking/payments.service.ts`
- Modify: `apps/api/src/booking/booking.module.ts`
- Test: `apps/api/test/payments.e2e-spec.ts` (existing file — add assertions)

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/payments.e2e-spec.ts`, inside the existing successful-confirmation test (or as a new test right after it — match the file's existing setup helper for getting to a paid/confirmed state):

```typescript
it('sends a push notification to the customer and salon owner on confirmation, alongside SMS', async () => {
  const pushService = app.get(PushService);
  const sendToUserSpy = jest.spyOn(pushService, 'sendToUser');

  const { bookingId, authority, customerId, ownerId } = await createPendingBooking(app, cookie);
  await request(app.getHttpServer())
    .get(`/api/payments/callback?Authority=${authority}&Status=OK`)
    .expect(302);

  expect(sendToUserSpy).toHaveBeenCalledWith(customerId, expect.objectContaining({ title: expect.any(String) }));
  expect(sendToUserSpy).toHaveBeenCalledWith(ownerId, expect.objectContaining({ title: expect.any(String) }));
});
```

Add `import { PushService } from '../src/push/push.service';` to the top of the file. As in Task 1, replace `createPendingBooking(app, cookie)` with this file's actual existing helper, extended (or read alongside a second query) to also give you back `customerId`/`ownerId` — those are just `booking.userId` and `salon.ownerId`, fetchable via a couple of extra `testDataSource()` queries if the existing helper doesn't already return them.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test:e2e -- payments.e2e-spec.ts`
Expected: FAIL — `sendToUserSpy` was never called (push isn't wired in yet).

- [ ] **Step 3: Inject `PushService` into `PaymentsService` and call it in `notifyConfirmed`**

In `apps/api/src/booking/payments.service.ts`, add the import and constructor param:

```typescript
import { PushService } from '../push/push.service';
```

```typescript
  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly dataSource: DataSource,
    private readonly salonsService: SalonsService,
    private readonly usersService: UsersService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly push: PushService,
  ) {}
```

Update `notifyConfirmed` to send push in parallel with SMS:

```typescript
  private async notifyConfirmed(bookingId: string): Promise<void> {
    const booking = await this.bookings.findOneBy({ id: bookingId });
    if (!booking) return;
    const salon = await this.salonsService.findById(booking.salonId);
    if (!salon) return;
    const [customer, owner] = await Promise.all([
      this.usersService.findById(booking.userId),
      this.usersService.findById(salon.ownerId),
    ]);
    const when = booking.startsAt.toISOString();

    // SMS/push failures never roll back a confirmed booking (per the design spec's
    // error-handling section) -- these are best-effort notifications, not a queued-with-retry
    // system yet.
    if (customer) {
      await this.sms.send(customer.phone, `Booking confirmed at ${salon.name}, ${when}. Address: ${salon.address}`).catch(() => {});
      await this.push.sendToUser(customer.id, {
        title: 'Booking confirmed',
        body: `${salon.name} — ${when}`,
      });
    }
    if (owner) {
      await this.sms.send(owner.phone, `New booking at ${salon.name} for ${when}`).catch(() => {});
      await this.push.sendToUser(owner.id, {
        title: 'New booking',
        body: `${salon.name} — ${when}`,
      });
    }
  }
```

(`PushService.sendToUser` already swallows per-device failures internally — see Task 5 — so no extra `.catch()` is needed here.)

- [ ] **Step 4: Wire `PushModule` into `BookingModule`**

In `apps/api/src/booking/booking.module.ts`, add `import { PushModule } from '../push/push.module';` and add `PushModule` to the `imports` array (alongside `SmsModule`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test:e2e -- payments.e2e-spec.ts`
Expected: PASS

- [ ] **Step 6: Run the full backend suite**

Run: `pnpm --filter @arayeshgah/api test && pnpm --filter @arayeshgah/api test:e2e`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/booking/payments.service.ts apps/api/src/booking/booking.module.ts apps/api/test/payments.e2e-spec.ts
git commit -m "feat(api): send push notifications alongside SMS on booking confirmation"
```

---

## Task 7: Backend — appointment reminder job (SMS + push)

Closes the reminder gap left open in Plan 2. The `reminded_at` column and `reminder_lead_hours` config key were already added by Task 5's migration.

**Files:**
- Modify: `apps/api/src/platform-config/platform-config.service.ts`
- Modify: `apps/api/src/booking/booking.entity.ts`
- Create: `apps/api/src/booking/booking-reminder.job.ts`
- Modify: `apps/api/src/booking/booking.module.ts`
- Test: `apps/api/test/booking-reminder.e2e-spec.ts`

- [ ] **Step 1: Add `remindedAt` to the `Booking` entity**

In `apps/api/src/booking/booking.entity.ts`, add after `status`:

```typescript
  @Column({ name: 'reminded_at', type: 'timestamptz', nullable: true })
  remindedAt: Date | null;
```

- [ ] **Step 2: Add `getReminderLeadHours()` to `PlatformConfigService`**

In `apps/api/src/platform-config/platform-config.service.ts`, add:

```typescript
  getReminderLeadHours(): Promise<number> {
    return this.getNumber('reminder_lead_hours');
  }
```

- [ ] **Step 3: Write the failing e2e test**

Create `apps/api/test/booking-reminder.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { BookingReminderJob } from '../src/booking/booking-reminder.job';
import { PushService } from '../src/push/push.service';
import { SMS_PROVIDER, SmsProvider } from '../src/sms/sms.provider';
import { createTestApp } from './utils/test-app';
import { resetDatabase, testDataSource } from './utils/db';

describe('Booking reminder job (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedConfirmedBooking(startsInHours: number, remindedAt: Date | null = null) {
    const ds = testDataSource();
    await ds.initialize();
    const [{ id: customerId }] = await ds.query(
      `INSERT INTO users (phone, role) VALUES ($1, 'customer') RETURNING id`,
      [`09${Math.floor(100000000 + Math.random() * 899999999)}`],
    );
    const [{ id: ownerId }] = await ds.query(
      `INSERT INTO users (phone, role) VALUES ($1, 'provider') RETURNING id`,
      [`09${Math.floor(100000000 + Math.random() * 899999999)}`],
    );
    const [{ id: salonId }] = await ds.query(
      `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
       VALUES ($1, 'Reminder Test Salon', $2, 'women', 'approved', 'addr', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.4, 35.7), 4326)::geography)
       RETURNING id`,
      [ownerId, 'reminder-test-' + Math.random().toString(36).slice(2, 7)],
    );
    const [{ id: categoryId }] = await ds.query(`SELECT id FROM service_categories LIMIT 1`);
    const [{ id: serviceId }] = await ds.query(
      `INSERT INTO salon_services (salon_id, category_id, name, price, duration_min, is_active)
       VALUES ($1, $2, 'Haircut', 300000, 30, true) RETURNING id`,
      [salonId, categoryId],
    );
    const startsAt = new Date(Date.now() + startsInHours * 60 * 60_000);
    const [{ id: bookingId }] = await ds.query(
      `INSERT INTO bookings (user_id, salon_id, service_id, starts_at, ends_at, price_snapshot, deposit_amount, status, reminded_at)
       VALUES ($1, $2, $3, $4, $4, 300000, 60000, 'confirmed', $5) RETURNING id`,
      [customerId, salonId, serviceId, startsAt.toISOString(), remindedAt],
    );
    await ds.destroy();
    return { bookingId, customerId, ownerId };
  }

  it('reminds a booking starting within the lead time and marks it reminded', async () => {
    const job = app.get(BookingReminderJob);
    const pushService = app.get(PushService);
    const sms = app.get<SmsProvider>(SMS_PROVIDER);
    const pushSpy = jest.spyOn(pushService, 'sendToUser');
    const smsSpy = jest.spyOn(sms, 'send');

    const { bookingId, customerId } = await seedConfirmedBooking(2); // default lead time is 3 hours

    const remindedCount = await job.run();
    expect(remindedCount).toBeGreaterThanOrEqual(1);
    expect(pushSpy).toHaveBeenCalledWith(customerId, expect.objectContaining({ title: expect.any(String) }));
    expect(smsSpy).toHaveBeenCalled();

    const ds = testDataSource();
    await ds.initialize();
    const [row] = await ds.query(`SELECT reminded_at FROM bookings WHERE id = $1`, [bookingId]);
    await ds.destroy();
    expect(row.reminded_at).not.toBeNull();
  });

  it('does not remind a booking outside the lead time window', async () => {
    const job = app.get(BookingReminderJob);
    const pushService = app.get(PushService);
    const pushSpy = jest.spyOn(pushService, 'sendToUser').mockClear();

    const { customerId } = await seedConfirmedBooking(48); // far in the future

    await job.run();
    expect(pushSpy).not.toHaveBeenCalledWith(customerId, expect.anything());
  });

  it('never reminds the same booking twice', async () => {
    const job = app.get(BookingReminderJob);
    await seedConfirmedBooking(2, new Date()); // already reminded

    const pushService = app.get(PushService);
    const pushSpy = jest.spyOn(pushService, 'sendToUser').mockClear();
    const remindedCount = await job.run();

    expect(remindedCount).toBe(0);
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test:e2e -- booking-reminder.e2e-spec.ts`
Expected: FAIL — `BookingReminderJob` doesn't exist yet.

- [ ] **Step 5: Implement the job**

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { PushService } from '../push/push.service';
import { SalonsService } from '../salons/salons.service';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';
import { UsersService } from '../users/users.service';
import { Booking } from './booking.entity';

@Injectable()
export class BookingReminderJob {
  private readonly logger = new Logger(BookingReminderJob.name);

  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly config: PlatformConfigService,
    private readonly salonsService: SalonsService,
    private readonly usersService: UsersService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly push: PushService,
  ) {}

  @Cron('*/5 * * * *')
  async handleCron(): Promise<void> {
    await this.run();
  }

  async run(): Promise<number> {
    const leadHours = await this.config.getReminderLeadHours();
    const now = new Date();
    const cutoff = new Date(now.getTime() + leadHours * 60 * 60_000);

    const due = await this.bookings.find({
      where: { status: 'confirmed', remindedAt: IsNull(), startsAt: LessThanOrEqual(cutoff) },
    });

    let remindedCount = 0;
    for (const booking of due) {
      if (booking.startsAt <= now) continue; // don't remind about a booking that already started

      // Conditional update guards against this job double-reminding the same booking if
      // two ticks overlap (or in a future multi-instance deployment) -- same pattern as the
      // affected-count guards used throughout the booking module for concurrent status writes.
      const claim = await this.bookings.update(
        { id: booking.id, remindedAt: IsNull() },
        { remindedAt: now },
      );
      if (!claim.affected) continue;

      const salon = await this.salonsService.findById(booking.salonId);
      if (!salon) continue;
      const customer = await this.usersService.findById(booking.userId);
      if (!customer) continue;

      const when = booking.startsAt.toISOString();
      await this.sms
        .send(customer.phone, `Reminder: your appointment at ${salon.name} is at ${when}. Address: ${salon.address}`)
        .catch(() => {});
      await this.push.sendToUser(customer.id, {
        title: 'Upcoming appointment',
        body: `${salon.name} — ${when}`,
      });
      remindedCount += 1;
    }

    if (remindedCount > 0) this.logger.log(`Sent ${remindedCount} appointment reminder(s)`);
    return remindedCount;
  }
}
```

- [ ] **Step 6: Register the job in `BookingModule`**

In `apps/api/src/booking/booking.module.ts`, add `BookingReminderJob` to the `providers` array (alongside `BookingExpiryJob` and `PaymentReconciliationJob`).

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test:e2e -- booking-reminder.e2e-spec.ts`
Expected: PASS

- [ ] **Step 8: Run the full backend suite**

Run: `pnpm --filter @arayeshgah/api test && pnpm --filter @arayeshgah/api test:e2e`
Expected: all PASS

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/platform-config/platform-config.service.ts apps/api/src/booking/booking.entity.ts apps/api/src/booking/booking-reminder.job.ts apps/api/src/booking/booking.module.ts apps/api/test/booking-reminder.e2e-spec.ts
git commit -m "feat(api): appointment reminders via SMS and push, closing Plan 2's reminder gap"
```

---

**This is the end of the backend-only tasks.** From here on, tasks build the `apps/user-app` Nuxt frontend, which consumes everything above.

---

## Task 8: Scaffold `apps/user-app` (Nuxt 4)

No TDD here — this is project scaffolding with no behavior to test yet. Verification is "the dev server boots and serves a page."

**Files:**
- Create: `apps/user-app/package.json`
- Create: `apps/user-app/nuxt.config.ts`
- Create: `apps/user-app/vitest.config.ts`
- Create: `apps/user-app/tsconfig.json`
- Create: `apps/user-app/app/app.vue`
- Create: `apps/user-app/.env.example`
- Create: `apps/user-app/.gitignore`
- Modify: `package.json` (repo root)

- [ ] **Step 1: Create the package manifest**

```json
{
  "name": "@arayeshgah/user-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "nuxt build",
    "dev": "nuxt dev --port 3003",
    "generate": "nuxt generate",
    "preview": "nuxt preview",
    "postinstall": "nuxt prepare",
    "test": "vitest run",
    "typecheck": "nuxt typecheck"
  },
  "dependencies": {
    "nuxt": "^4.4.0",
    "pinia": "^2.3.0",
    "@pinia/nuxt": "^0.9.0"
  },
  "devDependencies": {
    "@nuxt/test-utils": "^3.15.0",
    "@vue/test-utils": "^2.4.6",
    "vitest": "^2.1.8",
    "happy-dom": "^15.11.0",
    "playwright-core": "^1.49.0",
    "typescript": "^5.7.0"
  }
}
```

(`vitest`'s "nuxt" test project — see Step 2a — needs `happy-dom` and `playwright-core` as peer tooling even though nothing imports them directly; this matches the current official Nuxt testing setup, confirmed against `nuxt.com/docs/getting-started/testing`.)

- [ ] **Step 2: Create the Nuxt config**

```typescript
export default defineNuxtConfig({
  compatibilityDate: '2026-07-05',
  modules: ['@pinia/nuxt', '@nuxt/test-utils/module'],
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:3002/api',
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'fa', dir: 'rtl' },
    },
  },
})
```

(Modules for Tailwind, `@nuxt/image`, `@vite-pwa/nuxt`, and `@nuxtjs/sitemap` are added incrementally in later tasks that need them — each task shows the exact diff to this file rather than front-loading config for features that don't exist yet.)

- [ ] **Step 2a: Create `vitest.config.ts`**

Two test projects, matching the official Nuxt testing setup: plain `unit` tests (pure functions, `environment: 'node'`) run fast with no Nuxt context; `nuxt` tests (composables/components needing auto-imports like `useRuntimeConfig`) run inside a real Nuxt environment. Later tasks place their test files under `test/unit/` or `test/nuxt/` accordingly.

```typescript
import { defineConfig } from 'vitest/config'
import { defineVitestProject } from '@nuxt/test-utils/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.spec.ts'],
          environment: 'node',
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          include: ['test/nuxt/**/*.spec.ts'],
          environment: 'nuxt',
        },
      }),
    ],
  },
})
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "extends": "./.nuxt/tsconfig.json"
}
```

- [ ] **Step 4: Create the root app component**

```vue
<template>
  <NuxtRouteAnnouncer />
  <NuxtPage />
</template>
```

Save as `apps/user-app/app/app.vue`.

- [ ] **Step 5: Create env and gitignore files**

`apps/user-app/.env.example`:

```
NUXT_PUBLIC_API_BASE=http://localhost:3002/api
```

`apps/user-app/.gitignore`:

```
.nuxt
.output
node_modules
dist
.env
```

- [ ] **Step 6: Wire up the root workspace scripts**

In the repo root `package.json`, add a `dev:user-app` script next to the existing `dev:api` one:

```json
    "dev:api": "turbo run dev --filter=@arayeshgah/api",
    "dev:user-app": "turbo run dev --filter=@arayeshgah/user-app",
```

(`pnpm-workspace.yaml` already includes `apps/*`, so no change needed there. Turbo's generic `build`/`test` tasks in `turbo.json` apply automatically to any package defining matching script names — no per-package turbo config needed.)

- [ ] **Step 7: Install dependencies**

Run: `pnpm install`
Expected: resolves cleanly, creates/updates `pnpm-lock.yaml` to include the new package.

- [ ] **Step 8: Verify the dev server boots**

Run: `pnpm dev:user-app` (run in the background or a separate terminal — it's a persistent dev server)
Then: `curl -s http://localhost:3003/ -o /dev/null -w '%{http_code}\n'`
Expected: `200`

Stop the dev server before continuing.

- [ ] **Step 9: Commit**

```bash
git add apps/user-app package.json pnpm-lock.yaml
git commit -m "chore(user-app): scaffold Nuxt 4 workspace package"
```

---

## Task 9: Design tokens — Tailwind v4, light/dark theme, Vazirmatn font

Tailwind CSS v4 changed its setup from a `tailwind.config.js` + PostCSS plugin to a CSS-first `@tailwindcss/vite` plugin (confirmed against the current official Nuxt install guide — v3-era guides referencing `@nuxtjs/tailwindcss` and `tailwind.config.js` are out of date). No TDD — this is styling infrastructure; verification is visual/manual via the dev server.

**Files:**
- Modify: `apps/user-app/nuxt.config.ts`
- Modify: `apps/user-app/package.json`
- Create: `apps/user-app/app/assets/css/main.css`
- Modify: `apps/user-app/app/app.vue`

- [ ] **Step 1: Install Tailwind v4 and the font**

Run: `pnpm --filter @arayeshgah/user-app add tailwindcss @tailwindcss/vite @fontsource-variable/vazirmatn`

- [ ] **Step 2: Create the CSS entry point with theme tokens**

Create `apps/user-app/app/assets/css/main.css`:

```css
@import "tailwindcss";
@import "@fontsource-variable/vazirmatn/wght.css";

/* Manual light/dark toggle instead of the OS-only default (see useTheme.ts, Task 12) */
@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --font-sans: 'Vazirmatn Variable', ui-sans-serif, system-ui, sans-serif;

  /* Light mode -- "Teal Trust" */
  --color-surface: #F4FBFA;
  --color-surface-card: #FFFFFF;
  --color-text: #0B4F4A;
  --color-accent: #0EA89B;
  --color-ad: #FF7A45;
}

.dark {
  --color-surface: #151217;
  --color-surface-card: #211D24;
  --color-text: #F5F0F2;
  --color-accent: #7A3FF2;
  --color-ad: #F24F8D;
}

html, body {
  background-color: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-sans);
}
```

Note: `--color-*` variables are plain CSS custom properties (not Tailwind `@theme` color tokens generating utility classes) because their values must swap between light and dark via the `.dark` class selector — Tailwind's `@theme` block itself is static at build time. Components reference them via arbitrary-value utilities (e.g. `bg-(--color-surface)`) or plain inline `style` bindings; `--font-sans` is a real theme token since it doesn't vary by mode and Tailwind's `font-sans` utility should pick it up.

- [ ] **Step 3: Wire the Vite plugin and CSS into `nuxt.config.ts`**

```typescript
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-07-05',
  modules: ['@pinia/nuxt'],
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:3002/api',
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'fa', dir: 'rtl' },
    },
  },
})
```

- [ ] **Step 4: Verify with a visible utility class**

Temporarily edit `apps/user-app/app/app.vue`:

```vue
<template>
  <NuxtRouteAnnouncer />
  <div class="p-8 text-2xl font-bold">تست فونت و رنگ</div>
  <NuxtPage />
</template>
```

Run: `pnpm dev:user-app`, open `http://localhost:3003/` in a browser.
Expected: Persian text renders in Vazirmatn (not a fallback serif/sans), page background is `#F4FBFA`, text color `#0B4F4A`, right-to-left layout.

Revert `app.vue` back to just `<NuxtRouteAnnouncer /><NuxtPage />` once confirmed — that temporary div was only to eyeball the font/color, not a real page.

- [ ] **Step 5: Commit**

```bash
git add apps/user-app/nuxt.config.ts apps/user-app/package.json apps/user-app/app/assets/css/main.css apps/user-app/app/app.vue
git commit -m "feat(user-app): Tailwind v4, Vazirmatn font, light/dark design tokens"
```

---

## Task 10: API client composable (SSR cookie forwarding, 401 handling, silent mode)

This is the piece every later page/component depends on, so it gets real TDD. The core problem it solves: on the server, Nuxt's `$fetch` does **not** automatically forward the browser's cookies to a separate API origin — the incoming request's `Cookie` header has to be read and re-attached by hand, or every SSR-fetched page (home, salon profile) would render as logged-out.

**Files:**
- Create: `apps/user-app/app/composables/useToast.ts`
- Create: `apps/user-app/app/components/layout/ToastStack.vue`
- Create: `apps/user-app/app/composables/useApi.ts`
- Modify: `apps/user-app/app/app.vue`
- Test: `apps/user-app/test/nuxt/useApi.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/user-app/test/nuxt/useApi.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

const fetchMock = vi.fn()
mockNuxtImport('$fetch', () => {
  const fn = (...args: unknown[]) => fetchMock(...args)
  fn.create = () => fn
  return fn
})

const navigateToMock = vi.fn()
mockNuxtImport('navigateTo', () => navigateToMock)

describe('useApi', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    navigateToMock.mockReset()
  })

  it('returns { data } on success', async () => {
    fetchMock.mockResolvedValue({ id: '1' })
    const { apiFetch } = useApi()
    const result = await apiFetch('/salons/foo')
    expect(result).toEqual({ data: { id: '1' }, error: null })
  })

  it('in silent mode, returns the error instead of throwing or redirecting', async () => {
    fetchMock.mockRejectedValue({ response: { status: 409 }, statusMessage: 'Conflict' })
    const { apiFetch } = useApi()
    const result = await apiFetch('/bookings', { method: 'POST', silent: true })
    expect(result.data).toBeNull()
    expect(result.error?.status).toBe(409)
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('on a 401, redirects to /login even when not silent', async () => {
    fetchMock.mockRejectedValue({ response: { status: 401 } })
    const { apiFetch } = useApi()
    await apiFetch('/bookings/mine')
    expect(navigateToMock).toHaveBeenCalledWith('/login')
  })

  it('on a non-401 error without silent mode, pushes a toast and still returns the error', async () => {
    fetchMock.mockRejectedValue({ response: { status: 500 }, statusMessage: 'Server error' })
    const { apiFetch } = useApi()
    const { toasts } = useToast()
    const before = toasts.value.length
    const result = await apiFetch('/search')
    expect(toasts.value.length).toBe(before + 1)
    expect(result.error?.status).toBe(500)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @arayeshgah/user-app test`
Expected: FAIL — `useApi` is not defined.

- [ ] **Step 3: Implement `useToast`**

```typescript
export interface Toast {
  id: number
  message: string
}

const toasts = ref<Toast[]>([])
let nextId = 1

export function useToast() {
  function push(message: string) {
    const id = nextId++
    toasts.value.push({ id, message })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, 5000)
  }

  return { toasts, push }
}
```

Save as `apps/user-app/app/composables/useToast.ts`. Module-level `toasts`/`nextId` (rather than inside the returned function) make this a singleton shared across every call site, same intent as the Pinia session store but without needing a full store for one array.

- [ ] **Step 4: Implement `ToastStack.vue`**

```vue
<script setup lang="ts">
const { toasts } = useToast()
</script>

<template>
  <div class="fixed bottom-4 inset-x-4 z-50 flex flex-col gap-2 items-center">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="bg-(--color-surface-card) text-(--color-text) shadow-lg rounded-xl px-4 py-3 text-sm max-w-sm"
    >
      {{ toast.message }}
    </div>
  </div>
</template>
```

Save as `apps/user-app/app/components/layout/ToastStack.vue`.

- [ ] **Step 5: Implement `useApi`**

```typescript
export interface ApiError {
  status: number
  message: string
}

export interface ApiResult<T> {
  data: T | null
  error: ApiError | null
}

interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, unknown>
  silent?: boolean
}

export function useApi() {
  const config = useRuntimeConfig()

  async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {}
    if (import.meta.server) {
      // The browser's cookies never reach a server-side $fetch call automatically since
      // this is a separate origin from the API -- forward the incoming request's Cookie
      // header by hand, or every SSR-rendered page would look logged out.
      const forwarded = useRequestHeaders(['cookie'])
      if (forwarded.cookie) headers.cookie = forwarded.cookie
    }

    try {
      const data = await $fetch<T>(path, {
        baseURL: config.public.apiBase,
        method: options.method ?? 'GET',
        body: options.body,
        query: options.query,
        credentials: 'include',
        headers,
      })
      return { data, error: null }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status ?? 0
      const message = (err as { statusMessage?: string })?.statusMessage ?? 'Something went wrong'
      const apiError: ApiError = { status, message }

      if (status === 401) {
        await navigateTo('/login')
        return { data: null, error: apiError }
      }

      if (!options.silent) {
        useToast().push(message)
      }

      return { data: null, error: apiError }
    }
  }

  return { apiFetch }
}
```

- [ ] **Step 6: Mount `ToastStack` globally**

```vue
<template>
  <NuxtRouteAnnouncer />
  <NuxtPage />
  <ToastStack />
</template>
```

Save as `apps/user-app/app/app.vue`.

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @arayeshgah/user-app test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/user-app/app/composables/useToast.ts apps/user-app/app/components/layout/ToastStack.vue apps/user-app/app/composables/useApi.ts apps/user-app/app/app.vue apps/user-app/test/nuxt/useApi.spec.ts
git commit -m "feat(user-app): SSR-safe API client with cookie forwarding, 401 redirect, toasts"
```

---

## Task 11: Auth — login page, session store, route middleware

**Design decision made here (not fully spelled out in either design doc):** salon profile pages must stay reachable by an unauthenticated visitor (that's the entire point of their SEO investment — a Googler lands there with no session). Everything else (`/`, `/bookings/*`, `/profile`, `/admin/*`, the booking flow) requires a session, matching the original spec's "Login → Home" sequencing. Route middleware treats `/login` and `/salons/*` as public and gates everything else.

**Files:**
- Create: `apps/user-app/app/utils/route-guard.ts`
- Create: `apps/user-app/app/stores/session.ts`
- Create: `apps/user-app/app/middleware/auth.global.ts`
- Create: `apps/user-app/app/pages/login.vue`
- Test: `apps/user-app/test/unit/route-guard.spec.ts`

- [ ] **Step 1: Write the failing test for the route-guard logic**

Create `apps/user-app/test/unit/route-guard.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { isPublicRoute } from '../../app/utils/route-guard'

describe('isPublicRoute', () => {
  it('treats /login as public', () => {
    expect(isPublicRoute('/login')).toBe(true)
  })

  it('treats any /salons/:slug path as public', () => {
    expect(isPublicRoute('/salons/best-salon-tehran')).toBe(true)
  })

  it('treats home and account pages as private', () => {
    expect(isPublicRoute('/')).toBe(false)
    expect(isPublicRoute('/profile')).toBe(false)
    expect(isPublicRoute('/bookings')).toBe(false)
    expect(isPublicRoute('/admin/featured')).toBe(false)
  })

  it('does not treat /salons-something-else as public (no false-positive prefix match)', () => {
    expect(isPublicRoute('/salons-archive')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @arayeshgah/user-app test`
Expected: FAIL — `route-guard.ts` doesn't exist.

- [ ] **Step 3: Implement the pure guard function**

```typescript
export function isPublicRoute(path: string): boolean {
  if (path === '/login') return true
  if (path === '/salons' || path.startsWith('/salons/')) return true
  return false
}
```

Save as `apps/user-app/app/utils/route-guard.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @arayeshgah/user-app test`
Expected: PASS

- [ ] **Step 5: Create the session store**

```typescript
import { defineStore } from 'pinia'

export interface SessionUser {
  id: string
  phone: string
  name: string | null
  gender: 'female' | 'male' | null
  role: 'customer' | 'provider' | 'admin'
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    user: null as SessionUser | null,
    checked: false, // becomes true once we've asked the API at least once this session
  }),
  getters: {
    isLoggedIn: (state) => !!state.user,
    needsProfileCompletion: (state) => !!state.user && (!state.user.name || !state.user.gender),
  },
  actions: {
    setUser(user: SessionUser | null) {
      this.user = user
      this.checked = true
    },
  },
})
```

- [ ] **Step 6: Create the global auth middleware**

```typescript
import { isPublicRoute } from '../utils/route-guard'

export default defineNuxtRouteMiddleware(async (to) => {
  const session = useSessionStore()

  if (!session.checked) {
    const { apiFetch } = useApi()
    const { data } = await apiFetch<{ id: string; phone: string; name: string | null; gender: 'female' | 'male' | null; role: 'customer' | 'provider' | 'admin' }>(
      '/auth/me',
      { silent: true },
    )
    session.setUser(data)
  }

  if (!session.isLoggedIn && !isPublicRoute(to.path)) {
    return navigateTo('/login')
  }
})
```

Save as `apps/user-app/app/middleware/auth.global.ts` — the `.global.ts` suffix makes Nuxt run it on every route automatically, no per-page `definePageMeta` needed.

- [ ] **Step 7: Create the login page**

No `definePageMeta` override is needed on this page — `auth.global.ts` already exempts `/login` via `isPublicRoute`, so the page renders with no special setup:

```vue
<script setup lang="ts">
const { apiFetch } = useApi()
const session = useSessionStore()

const step = ref<'phone' | 'code' | 'profile'>('phone')
const phone = ref('')
const code = ref('')
const name = ref('')
const gender = ref<'female' | 'male' | ''>('')
const submitting = ref(false)
const formError = ref('')

async function requestOtp() {
  submitting.value = true
  formError.value = ''
  const { error } = await apiFetch('/auth/request-otp', { method: 'POST', body: { phone: phone.value }, silent: true })
  submitting.value = false
  if (error) { formError.value = 'شماره موبایل نامعتبر است'; return }
  step.value = 'code'
}

async function verifyOtp() {
  submitting.value = true
  formError.value = ''
  const { data, error } = await apiFetch<{ user: { id: string; phone: string; name: string | null; gender: 'female' | 'male' | null; role: 'customer' | 'provider' | 'admin' }; isNewUser: boolean }>(
    '/auth/verify-otp',
    { method: 'POST', body: { phone: phone.value, code: code.value }, silent: true },
  )
  submitting.value = false
  if (error || !data) { formError.value = 'کد وارد شده اشتباه است'; return }

  session.setUser(data.user)
  if (!data.user.name || !data.user.gender) {
    step.value = 'profile'
  } else {
    await navigateTo('/')
  }
}

async function completeProfile() {
  submitting.value = true
  const { data, error } = await apiFetch<{ id: string; phone: string; name: string | null; gender: 'female' | 'male' | null; role: 'customer' | 'provider' | 'admin' }>(
    '/auth/profile',
    { method: 'PATCH', body: { name: name.value, gender: gender.value } },
  )
  submitting.value = false
  if (error || !data) return
  session.setUser(data)
  await navigateTo('/')
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-6">
    <div class="w-full max-w-sm space-y-4">
      <h1 class="text-xl font-bold text-center">ورود به آرایشگاه</h1>

      <form v-if="step === 'phone'" class="space-y-3" @submit.prevent="requestOtp">
        <input v-model="phone" type="tel" placeholder="09xxxxxxxxx" class="w-full rounded-lg border p-3" required />
        <button type="submit" :disabled="submitting" class="w-full rounded-lg bg-(--color-accent) text-white p-3 font-semibold">
          دریافت کد
        </button>
      </form>

      <form v-else-if="step === 'code'" class="space-y-3" @submit.prevent="verifyOtp">
        <input v-model="code" inputmode="numeric" maxlength="6" placeholder="کد ۶ رقمی" class="w-full rounded-lg border p-3" required />
        <button type="submit" :disabled="submitting" class="w-full rounded-lg bg-(--color-accent) text-white p-3 font-semibold">
          تایید
        </button>
      </form>

      <form v-else class="space-y-3" @submit.prevent="completeProfile">
        <input v-model="name" type="text" placeholder="نام" class="w-full rounded-lg border p-3" required />
        <select v-model="gender" class="w-full rounded-lg border p-3" required>
          <option value="" disabled>جنسیت</option>
          <option value="female">زن</option>
          <option value="male">مرد</option>
        </select>
        <button type="submit" :disabled="submitting" class="w-full rounded-lg bg-(--color-accent) text-white p-3 font-semibold">
          تکمیل ثبت‌نام
        </button>
      </form>

      <p v-if="formError" class="text-(--color-ad) text-sm text-center">{{ formError }}</p>
    </div>
  </div>
</template>
```

Save as `apps/user-app/app/pages/login.vue`.

- [ ] **Step 8: Manual verification**

Run: `pnpm dev:api` (separate terminal) and `pnpm dev:user-app`. Visit `http://localhost:3003/` — expect a redirect to `/login` (no session yet). Request an OTP for a real phone number; since `SMS_PROVIDER=console` in dev, read the code from the API server's console log instead of an actual SMS. Complete the flow and confirm landing on `/` (which will currently 404 or render blank — the Home page itself is built in Task 13; confirming the redirect and cookie exchange work is the goal here, not a finished home screen).

- [ ] **Step 9: Commit**

```bash
git add apps/user-app/app/utils/route-guard.ts apps/user-app/app/stores/session.ts apps/user-app/app/middleware/auth.global.ts apps/user-app/app/pages/login.vue apps/user-app/test/unit/route-guard.spec.ts
git commit -m "feat(user-app): phone+OTP login, session store, route auth guard"
```

---

## Task 12: App shell — header, theme toggle, layouts, RTL

**Approach for no-flash dark mode:** the theme preference is stored in a cookie (`useCookie`, SSR + client synced) rather than `localStorage`, and a small blocking inline script in `<head>` applies the `dark` class before the body paints. `localStorage` alone would cause a visible flash on every load (server has no way to read it), and using only `prefers-color-scheme` media queries would prevent a manual override — this combines both, matching the design spec's "OS-aware with a manual override toggle."

**Files:**
- Create: `apps/user-app/app/composables/useTheme.ts`
- Create: `apps/user-app/app/components/layout/ThemeToggle.vue`
- Create: `apps/user-app/app/components/layout/AppHeader.vue`
- Create: `apps/user-app/app/layouts/default.vue`
- Create: `apps/user-app/app/layouts/bare.vue`
- Modify: `apps/user-app/app/pages/login.vue`
- Modify: `apps/user-app/nuxt.config.ts`

No TDD — this is presentational/browser-API-driven UI (theme application touches `document`/`matchMedia` directly, which the project's own testing philosophy excludes from required component tests: "component tests only where logic is nontrivial" per the original design spec §9, and there's no nontrivial branching logic here beyond what `route-guard.spec.ts` already covers for a similar pattern in Task 11). Verification is manual via the browser.

- [ ] **Step 1: Add the anti-flash inline script to `nuxt.config.ts`**

Add an `app.head.script` entry (alongside the existing `htmlAttrs`):

```typescript
export default defineNuxtConfig({
  compatibilityDate: '2026-07-05',
  modules: ['@pinia/nuxt', '@nuxt/test-utils/module'],
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:3002/api',
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'fa', dir: 'rtl' },
      script: [
        {
          innerHTML: `(function(){try{var m=document.cookie.match(/(?:^|; )theme=([^;]*)/);var p=m?decodeURIComponent(m[1]):'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
        },
      ],
    },
  },
})
```

(Remember to re-add `import tailwindcss from '@tailwindcss/vite'` at the top — this file already has it from Task 9; this diff only adds the `script` array under `app.head`.)

- [ ] **Step 2: Implement `useTheme`**

```typescript
export type ThemePreference = 'light' | 'dark' | 'system'

export function useTheme() {
  const preference = useCookie<ThemePreference>('theme', { default: () => 'system' })

  function apply() {
    if (import.meta.server) return
    const isDark =
      preference.value === 'dark' ||
      (preference.value === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', isDark)
  }

  function setPreference(pref: ThemePreference) {
    preference.value = pref
    apply()
  }

  return { preference, setPreference, apply }
}
```

Save as `apps/user-app/app/composables/useTheme.ts`. `apply()` is also called from `ThemeToggle.vue`'s mount hook (Step 3) to sync the class if the inline script and the cookie ever disagree (e.g. the cookie was just changed on another tab).

- [ ] **Step 3: Implement `ThemeToggle.vue`**

```vue
<script setup lang="ts">
const { preference, setPreference } = useTheme()

const options: { value: 'light' | 'dark' | 'system'; label: string }[] = [
  { value: 'light', label: '☀️' },
  { value: 'dark', label: '🌙' },
  { value: 'system', label: '💻' },
]
</script>

<template>
  <div class="flex gap-1 rounded-full bg-(--color-surface-card) p-1">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="rounded-full px-2 py-1 text-sm"
      :class="{ 'bg-(--color-accent)': preference === opt.value }"
      @click="setPreference(opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
```

Save as `apps/user-app/app/components/layout/ThemeToggle.vue`.

- [ ] **Step 4: Implement `AppHeader.vue`**

```vue
<script setup lang="ts">
const session = useSessionStore()
</script>

<template>
  <header class="flex items-center justify-between px-4 py-3 bg-(--color-surface-card)">
    <NuxtLink to="/" class="font-bold text-lg">آرایشگاه</NuxtLink>
    <nav class="flex items-center gap-3 text-sm">
      <NuxtLink v-if="session.isLoggedIn" to="/bookings">نوبت‌های من</NuxtLink>
      <NuxtLink v-if="session.isLoggedIn" to="/profile">پروفایل</NuxtLink>
      <ThemeToggle />
    </nav>
  </header>
</template>
```

Save as `apps/user-app/app/components/layout/AppHeader.vue`.

- [ ] **Step 5: Create the two layouts**

`apps/user-app/app/layouts/default.vue`:

```vue
<template>
  <div class="min-h-screen flex flex-col">
    <AppHeader />
    <main class="flex-1">
      <slot />
    </main>
  </div>
</template>
```

`apps/user-app/app/layouts/bare.vue` (no header — used by full-screen flows like login):

```vue
<template>
  <slot />
</template>
```

- [ ] **Step 6: Put the login page on the bare layout**

In `apps/user-app/app/pages/login.vue`, add as the first line of the `<script setup>` block:

```typescript
definePageMeta({ layout: 'bare' })
```

- [ ] **Step 7: Manual verification**

Run: `pnpm dev:user-app`, visit `http://localhost:3003/login` — bare layout, no header. Set OS-level dark mode on/off and reload — page should follow it under "system." Click the sun/moon/system toggle and confirm the page recolors immediately with no full reload, and persists across a reload (cookie-backed).

- [ ] **Step 8: Commit**

```bash
git add apps/user-app/app/composables/useTheme.ts apps/user-app/app/components/layout apps/user-app/app/layouts apps/user-app/app/pages/login.vue apps/user-app/nuxt.config.ts
git commit -m "feat(user-app): app shell with header, layouts, and no-flash theme toggle"
```

---

## Task 13: Home page — categories, search, `SalonCard` with the Ad badge

**Files:**
- Create: `apps/user-app/app/providers/arvancloud.ts`
- Modify: `apps/user-app/nuxt.config.ts`
- Modify: `apps/user-app/package.json`
- Create: `apps/user-app/app/utils/city-centers.ts`
- Create: `apps/user-app/app/components/salon/SalonCard.vue`
- Create: `apps/user-app/app/pages/index.vue`
- Test: `apps/user-app/test/nuxt/SalonCard.spec.ts`

- [ ] **Step 1: Install `@nuxt/image`**

Run: `pnpm --filter @arayeshgah/user-app add @nuxt/image`

- [ ] **Step 2: Write the failing component test for the Ad badge rule**

Create `apps/user-app/test/nuxt/SalonCard.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SalonCard from '../../app/components/salon/SalonCard.vue'

const baseSalon = {
  id: '1', name: 'Test Salon', slug: 'test-salon', city: 'Tehran', address: 'addr',
  ratingAvg: 4.5, ratingCount: 10, distanceKm: 1.2, minPrice: 300000, coverPhoto: null,
  isFeatured: false,
}

describe('SalonCard', () => {
  it('does not show the Ad badge for a non-featured salon', async () => {
    const wrapper = await mountSuspended(SalonCard, { props: { salon: baseSalon } })
    expect(wrapper.find('[data-testid="ad-badge"]').exists()).toBe(false)
  })

  it('shows the Ad badge for a featured salon', async () => {
    const wrapper = await mountSuspended(SalonCard, { props: { salon: { ...baseSalon, isFeatured: true } } })
    expect(wrapper.find('[data-testid="ad-badge"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('تبلیغ')
  })

  it('links to the salon profile by slug', async () => {
    const wrapper = await mountSuspended(SalonCard, { props: { salon: baseSalon } })
    expect(wrapper.find('a').attributes('href')).toBe('/salons/test-salon')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @arayeshgah/user-app test`
Expected: FAIL — `SalonCard.vue` doesn't exist.

- [ ] **Step 4: Create the ArvanCloud image provider**

ArvanCloud's CDN resize feature (Professional/Enterprise plans) accepts plain `?width=&height=` query params on the existing image URL — confirmed against ArvanCloud's own CDN acceleration docs. If that plan feature isn't enabled on whatever ArvanCloud account this deploys under, CDNs universally ignore unrecognized query params, so this degrades safely to the original full-size image rather than erroring.

```typescript
import { createOperationsGenerator, defineProvider } from '@nuxt/image/runtime'

const operationsGenerator = createOperationsGenerator({
  keyMap: { width: 'width', height: 'height' },
})

export default defineProvider({
  getImage(src, { modifiers } = {}) {
    const operations = operationsGenerator(modifiers)
    return { url: operations ? `${src}?${operations}` : src }
  },
})
```

Save as `apps/user-app/app/providers/arvancloud.ts`.

- [ ] **Step 5: Register the provider in `nuxt.config.ts`**

Add to the existing config object (alongside `runtimeConfig`, `app`, etc.):

```typescript
  modules: ['@pinia/nuxt', '@nuxt/test-utils/module', '@nuxt/image'],
  image: {
    providers: {
      arvancloud: {
        name: 'arvancloud',
        provider: '~/providers/arvancloud.ts',
      },
    },
  },
```

- [ ] **Step 6: Create the city-centers fallback list**

```typescript
export interface CityCenter {
  name: string
  lat: number
  lng: number
}

// Fallback for when the browser denies/lacks geolocation. Small starter list, not
// exhaustive -- add more cities here as the salon supply expands beyond them.
export const CITY_CENTERS: CityCenter[] = [
  { name: 'تهران', lat: 35.6892, lng: 51.389 },
  { name: 'مشهد', lat: 36.2605, lng: 59.6168 },
  { name: 'اصفهان', lat: 32.6546, lng: 51.668 },
  { name: 'شیراز', lat: 29.5918, lng: 52.5837 },
]
```

Save as `apps/user-app/app/utils/city-centers.ts`.

- [ ] **Step 7: Implement `SalonCard.vue`**

```vue
<script setup lang="ts">
defineProps<{
  salon: {
    id: string
    name: string
    slug: string
    city: string
    address: string
    ratingAvg: number
    ratingCount: number
    distanceKm: number
    minPrice: number | null
    coverPhoto: string | null
    isFeatured: boolean
  }
}>()
</script>

<template>
  <NuxtLink :to="`/salons/${salon.slug}`" class="relative flex gap-3 rounded-xl bg-(--color-surface-card) p-3">
    <span
      v-if="salon.isFeatured"
      data-testid="ad-badge"
      class="absolute top-2 start-2 rounded-md bg-(--color-ad) px-1.5 py-0.5 text-[0.65rem] font-bold text-white"
    >
      تبلیغ
    </span>
    <NuxtImg
      v-if="salon.coverPhoto"
      provider="arvancloud"
      :src="salon.coverPhoto"
      width="80"
      height="80"
      loading="lazy"
      class="h-20 w-20 flex-shrink-0 rounded-lg object-cover"
      :alt="salon.name"
    />
    <div v-else class="h-20 w-20 flex-shrink-0 rounded-lg bg-(--color-surface)" />
    <div class="flex-1 text-sm">
      <h3 class="font-bold">{{ salon.name }}</h3>
      <p>⭐ {{ salon.ratingAvg.toFixed(1) }} ({{ salon.ratingCount }}) · {{ salon.distanceKm.toFixed(1) }} کیلومتر</p>
      <p v-if="salon.minPrice">از {{ salon.minPrice.toLocaleString('fa-IR') }} تومان</p>
    </div>
  </NuxtLink>
</template>
```

Save as `apps/user-app/app/components/salon/SalonCard.vue`. `start-2` (a logical-property Tailwind utility) keeps the badge on the correct side automatically in this RTL-only app — using `left-2`/`right-2` directly would hardcode a direction assumption that happens to be wrong for RTL.

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @arayeshgah/user-app test`
Expected: PASS

- [ ] **Step 9: Implement the Home page**

```vue
<script setup lang="ts">
import { CITY_CENTERS } from '../utils/city-centers'

const session = useSessionStore()
const { apiFetch } = useApi()

const categories = ref<{ id: number; name: string; icon: string }[]>([])
const salons = ref<
  { id: string; name: string; slug: string; city: string; address: string; ratingAvg: number; ratingCount: number; distanceKm: number; minPrice: number | null; coverPhoto: string | null; isFeatured: boolean }[]
>([])
const selectedCategoryId = ref<number | null>(null)
const sort = ref<'distance' | 'rating'>('distance')
const coords = ref<{ lat: number; lng: number }>({ lat: CITY_CENTERS[0].lat, lng: CITY_CENTERS[0].lng })
const selectedCity = ref(CITY_CENTERS[0].name)
const loading = ref(true)

function selectCity(city: (typeof CITY_CENTERS)[number]) {
  selectedCity.value = city.name
  coords.value = { lat: city.lat, lng: city.lng }
}

async function loadSalons() {
  loading.value = true
  const { data } = await apiFetch<typeof salons.value>('/search', {
    query: {
      lat: coords.value.lat,
      lng: coords.value.lng,
      gender: session.user?.gender,
      categoryId: selectedCategoryId.value ?? undefined,
      sort: sort.value,
    },
    silent: true,
  })
  salons.value = data ?? []
  loading.value = false
}

onMounted(async () => {
  const { data } = await apiFetch<typeof categories.value>('/categories')
  categories.value = data ?? []

  if (import.meta.client && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        coords.value = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        loadSalons()
      },
      () => loadSalons(), // permission denied / unavailable -- fall back to the default city already in coords
      { timeout: 5000 },
    )
  } else {
    await loadSalons()
  }
})

watch([selectedCategoryId, sort], loadSalons)
</script>

<template>
  <div class="p-4 space-y-4">
    <select :value="selectedCity" class="rounded-lg border p-2 text-sm" @change="(e) => selectCity(CITY_CENTERS.find((c) => c.name === (e.target as HTMLSelectElement).value)!)">
      <option v-for="city in CITY_CENTERS" :key="city.name" :value="city.name">{{ city.name }}</option>
    </select>

    <div class="flex gap-2 overflow-x-auto">
      <button
        type="button"
        class="whitespace-nowrap rounded-full px-3 py-1 text-sm"
        :class="selectedCategoryId === null ? 'bg-(--color-accent) text-white' : 'bg-(--color-surface-card)'"
        @click="selectedCategoryId = null"
      >
        همه
      </button>
      <button
        v-for="cat in categories"
        :key="cat.id"
        type="button"
        class="whitespace-nowrap rounded-full px-3 py-1 text-sm"
        :class="selectedCategoryId === cat.id ? 'bg-(--color-accent) text-white' : 'bg-(--color-surface-card)'"
        @click="selectedCategoryId = cat.id"
      >
        {{ cat.name }}
      </button>
    </div>

    <p v-if="loading" class="text-sm text-center">در حال بارگذاری...</p>
    <p v-else-if="!salons.length" class="text-sm text-center">سالنی در این منطقه پیدا نشد</p>
    <div v-else class="space-y-3">
      <SalonCard v-for="salon in salons" :key="salon.id" :salon="salon" />
    </div>
  </div>
</template>
```

Save as `apps/user-app/app/pages/index.vue`.

- [ ] **Step 10: Manual verification**

Run `pnpm dev:api` and `pnpm dev:user-app`. Seed at least one `approved` salon with a service and a location near Tehran directly via SQL (there is no admin approval flow yet — see the Reference section at the top of this plan). Log in, land on `/`, confirm the salon appears as a card, category chips filter it correctly, and geolocation permission prompt appears (allow or deny — both paths should still show results).

- [ ] **Step 11: Commit**

```bash
git add apps/user-app/app/providers apps/user-app/app/utils/city-centers.ts apps/user-app/app/components/salon/SalonCard.vue apps/user-app/app/pages/index.vue apps/user-app/nuxt.config.ts apps/user-app/package.json apps/user-app/test/nuxt/SalonCard.spec.ts
git commit -m "feat(user-app): home page with category filters and the sponsored-card ad slot"
```

---

## Task 14: Map toggle (Leaflet + Neshan)

**Integration approach and a flagged uncertainty:** Neshan's officially documented Leaflet integration (`platform.neshan.org/docs/sdk/web/leaflet/...`) constructs a map via `new L.Map(elementId, { key, maptype, center, zoom })`, where `L` comes from Neshan's own SDK bundle loaded via `<script>`/`<link>` tags at `https://static.neshan.org/sdk/leaflet/v1.9.4/neshan-sdk/v1.0.8/index.js` / `.../index.css` (confirmed directly from Neshan's docs during plan research). There is also an `@neshan-maps-platform/leaflet` npm package, but repeated attempts to fetch its README/npm page during plan research failed (network errors / 403), so its exact ESM import shape could not be confirmed — guessing at that would risk exactly the kind of mistake this plan is trying to avoid. This task therefore uses the **confirmed CDN script approach**, loaded dynamically and only client-side, which also happens to fit the "lazy-load only when the map is opened" requirement better than a bundled npm import would. **Before executing this task, re-check `platform.neshan.org`'s current docs** in case the SDK version or API has moved on since this plan was written.

**Files:**
- Create: `apps/user-app/app/components/salon/SalonMap.client.vue`
- Modify: `apps/user-app/app/pages/index.vue`
- Modify: `apps/user-app/nuxt.config.ts`
- Modify: `.env.example` (repo root) and `apps/user-app/.env.example`

No TDD — this wraps a third-party map SDK's imperative DOM API; there's no meaningful assertion to make on it in a headless test environment (no real tile rendering, no real `L` global). Verification is manual, in a browser, with a real API key.

- [ ] **Step 1: Add the Neshan API key to runtime config**

In `apps/user-app/nuxt.config.ts`, add to `runtimeConfig.public`:

```typescript
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:3002/api',
      neshanApiKey: process.env.NUXT_PUBLIC_NESHAN_API_KEY ?? '',
    },
  },
```

Add to both `.env.example` files:

```
NUXT_PUBLIC_NESHAN_API_KEY=
```

- [ ] **Step 2: Implement `SalonMap.client.vue`**

The `.client.vue` suffix makes Nuxt skip this component entirely during SSR (no `document`/`window` access needed server-side, and no risk of it executing before hydration).

```vue
<script setup lang="ts">
const props = defineProps<{
  salons: { id: string; name: string; slug: string; distanceKm: number }[]
  center: { lat: number; lng: number }
  salonCoords: Record<string, { lat: number; lng: number }>
}>()

const config = useRuntimeConfig()
const mapEl = useTemplateRef<HTMLDivElement>('mapEl')

let mapInstance: any = null

function loadNeshanSdk(): Promise<void> {
  const w = window as unknown as { L?: unknown }
  if (w.L) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://static.neshan.org/sdk/leaflet/v1.9.4/neshan-sdk/v1.0.8/index.css'
    document.head.appendChild(link)

    const script = document.createElement('script')
    script.src = 'https://static.neshan.org/sdk/leaflet/v1.9.4/neshan-sdk/v1.0.8/index.js'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Neshan SDK'))
    document.head.appendChild(script)
  })
}

onMounted(async () => {
  try {
    await loadNeshanSdk()
  } catch {
    return // map silently unavailable; the list view (already rendered) remains usable
  }
  const L = (window as unknown as { L: any }).L

  mapInstance = new L.Map(mapEl.value, {
    key: config.public.neshanApiKey,
    maptype: 'standard-day',
    center: [props.center.lat, props.center.lng],
    zoom: 13,
    poi: false,
    traffic: false,
  })

  for (const salon of props.salons) {
    const coords = props.salonCoords[salon.id]
    if (!coords) continue
    L.marker([coords.lat, coords.lng]).addTo(mapInstance).bindPopup(salon.name)
  }
})

onBeforeUnmount(() => {
  mapInstance?.remove?.()
})
</script>

<template>
  <div ref="mapEl" class="h-96 w-full rounded-xl" />
</template>
```

Note this component needs each salon's raw coordinates (`salonCoords`), which `SearchResult` doesn't currently expose (it only returns `distanceKm`, not `lat`/`lng`) — Home page (Step 3) works around this by only plotting salons it already has coordinates for via a lightweight follow-up, see below.

- [ ] **Step 3: Decide how the map gets coordinates, and wire up the toggle in `index.vue`**

`SearchResult` intentionally never leaked raw lat/lng (Task 2's `search.service.ts` — unchanged here) since the list view never needed it. Rather than widen that public API's response shape for a feature that only 1 of 2 view modes needs, add coordinates **only when the map view is active**, via the existing public `GET /salons/:slug` endpoint (already returns the full `Salon` row including `location`) — call it once per visible salon, in parallel, only when the user switches to map view.

In `apps/user-app/app/pages/index.vue`, add:

```typescript
const view = ref<'list' | 'map'>('list')
const salonCoords = ref<Record<string, { lat: number; lng: number }>>({})

async function loadCoordsForMap() {
  const missing = salons.value.filter((s) => !salonCoords.value[s.id])
  const results = await Promise.all(
    missing.map((s) => apiFetch<{ location: { coordinates: [number, number] } }>(`/salons/${s.slug}`, { silent: true })),
  )
  for (let i = 0; i < missing.length; i++) {
    const data = results[i].data
    if (data) salonCoords.value[missing[i].id] = { lat: data.location.coordinates[1], lng: data.location.coordinates[0] }
  }
}

watch(view, (v) => {
  if (v === 'map') loadCoordsForMap()
})
```

And in the template, add the toggle above the results and the conditional map render:

```html
    <div class="flex gap-2">
      <button type="button" class="rounded-full px-3 py-1 text-sm" :class="view === 'list' ? 'bg-(--color-accent) text-white' : 'bg-(--color-surface-card)'" @click="view = 'list'">لیست</button>
      <button type="button" class="rounded-full px-3 py-1 text-sm" :class="view === 'map' ? 'bg-(--color-accent) text-white' : 'bg-(--color-surface-card)'" @click="view = 'map'">نقشه</button>
    </div>

    <SalonMap v-if="view === 'map'" :salons="salons" :center="coords" :salon-coords="salonCoords" />
    <template v-else>
      <p v-if="loading" class="text-sm text-center">در حال بارگذاری...</p>
      <p v-else-if="!salons.length" class="text-sm text-center">سالنی در این منطقه پیدا نشد</p>
      <div v-else class="space-y-3">
        <SalonCard v-for="salon in salons" :key="salon.id" :salon="salon" />
      </div>
    </template>
```

(This replaces the plain list block that Task 13 put directly in the template — the list is now the `v-else` branch of the view toggle.)

- [ ] **Step 4: Manual verification**

Get a real (or trial) Neshan API key, set `NUXT_PUBLIC_NESHAN_API_KEY` in `apps/user-app/.env`. Run both dev servers, log in, land on `/`, switch to map view — confirm the map renders centered on the selected city with a marker per visible salon, and switching back to list view still works. Confirm switching to map view with no API key set fails silently (list view stays usable, per the `catch` in `loadNeshanSdk`'s caller) rather than crashing the page.

- [ ] **Step 5: Commit**

```bash
git add apps/user-app/app/components/salon/SalonMap.client.vue apps/user-app/app/pages/index.vue apps/user-app/nuxt.config.ts .env.example apps/user-app/.env.example
git commit -m "feat(user-app): map view toggle using Neshan tiles via Leaflet"
```

---

## Task 15: Salon profile page (SSR, SEO, gallery, reviews, favorite toggle)

**A cross-endpoint inconsistency to route around, not fix here:** Task 3's public content endpoints (`/salons/:slug/services`, `/hours`, `/photos`) all key off the **slug**. Plan 3's existing reviews endpoint (`GET /salons/:salonId/reviews`, built in an earlier plan) keys off the salon's **UUID** and enforces it with `ParseUUIDPipe` — passing a slug there 400s. Rewriting that endpoint isn't this plan's job (it already has its own e2e coverage from Plan 3); this task just fetches the salon by slug first, then uses its resolved `id` for the reviews call.

**Files:**
- Create: `apps/user-app/app/components/salon/SalonGallery.vue`
- Create: `apps/user-app/app/pages/salons/[slug].vue`

- [ ] **Step 1: Implement `SalonGallery.vue`**

```vue
<script setup lang="ts">
defineProps<{ photos: { id: string; url: string }[] }>()
</script>

<template>
  <div v-if="photos.length" class="flex gap-2 overflow-x-auto">
    <NuxtImg
      v-for="photo in photos"
      :key="photo.id"
      provider="arvancloud"
      :src="photo.url"
      width="280"
      height="200"
      loading="lazy"
      class="h-48 w-70 flex-shrink-0 rounded-xl object-cover"
      alt=""
    />
  </div>
  <div v-else class="h-48 rounded-xl bg-(--color-surface-card) flex items-center justify-center text-sm">
    تصویری موجود نیست
  </div>
</template>
```

Save as `apps/user-app/app/components/salon/SalonGallery.vue`. The empty state matters here more than on `SalonCard`'s single thumbnail — see this plan's Reference section: `salon_photos` has no upload path anywhere in the system yet, so most salons will hit this branch until provider-panel ships.

- [ ] **Step 2: Implement the salon profile page**

```vue
<script setup lang="ts">
interface Salon {
  id: string
  name: string
  description: string | null
  address: string
  city: string
  ratingAvg: string
  ratingCount: number
}
interface SalonServiceItem { id: string; name: string; description: string | null; price: number; durationMin: number }
interface WorkingHourItem { weekday: number; openTime: string; closeTime: string }
interface PhotoItem { id: string; url: string }
interface ReviewItem { id: string; rating: number; comment: string | null; salonReply: string | null; createdAt: string }

const route = useRoute()
const slug = route.params.slug as string
const { apiFetch } = useApi()
const session = useSessionStore()

const { data: page } = await useAsyncData(`salon-${slug}`, async () => {
  const salonRes = await apiFetch<Salon>(`/salons/${slug}`, { silent: true })
  if (!salonRes.data) return null

  const [servicesRes, hoursRes, photosRes, reviewsRes] = await Promise.all([
    apiFetch<SalonServiceItem[]>(`/salons/${slug}/services`, { silent: true }),
    apiFetch<WorkingHourItem[]>(`/salons/${slug}/hours`, { silent: true }),
    apiFetch<PhotoItem[]>(`/salons/${slug}/photos`, { silent: true }),
    apiFetch<ReviewItem[]>(`/salons/${salonRes.data.id}/reviews`, { silent: true }),
  ])

  return {
    salon: salonRes.data,
    services: servicesRes.data ?? [],
    hours: hoursRes.data ?? [],
    photos: photosRes.data ?? [],
    reviews: reviewsRes.data ?? [],
  }
})

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Salon not found' })
}

useSeoMeta({
  title: page.value.salon.name,
  description: page.value.salon.description ?? `${page.value.salon.name} — ${page.value.salon.address}`,
  ogTitle: page.value.salon.name,
  ogImage: page.value.photos[0]?.url,
})

useHead({
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BeautySalon',
        name: page.value.salon.name,
        address: { '@type': 'PostalAddress', streetAddress: page.value.salon.address, addressLocality: page.value.salon.city },
        aggregateRating: page.value.salon.ratingCount > 0
          ? { '@type': 'AggregateRating', ratingValue: page.value.salon.ratingAvg, reviewCount: page.value.salon.ratingCount }
          : undefined,
      }),
    },
  ],
})

const isFavorited = ref(false)
const favoriteBusy = ref(false)

onMounted(async () => {
  if (!session.isLoggedIn) return
  const { data } = await apiFetch<Salon[]>('/favorites', { silent: true })
  isFavorited.value = !!data?.some((s) => s.id === page.value!.salon.id)
})

async function toggleFavorite() {
  favoriteBusy.value = true
  const method = isFavorited.value ? 'DELETE' : 'POST'
  const { error } = await apiFetch(`/salons/${page.value!.salon.id}/favorite`, { method })
  favoriteBusy.value = false
  if (!error) isFavorited.value = !isFavorited.value
}

const WEEKDAY_NAMES = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']
</script>

<template>
  <div class="p-4 space-y-6">
    <SalonGallery :photos="page!.photos" />

    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-xl font-bold">{{ page!.salon.name }}</h1>
        <p class="text-sm">⭐ {{ Number(page!.salon.ratingAvg).toFixed(1) }} ({{ page!.salon.ratingCount }})</p>
        <p class="text-sm">{{ page!.salon.address }}</p>
      </div>
      <button
        type="button"
        :disabled="favoriteBusy"
        class="rounded-full bg-(--color-surface-card) px-3 py-2 text-sm"
        @click="toggleFavorite"
      >
        {{ isFavorited ? '♥ ذخیره شده' : '♡ ذخیره' }}
      </button>
    </div>

    <section>
      <h2 class="font-bold mb-2">خدمات</h2>
      <ul class="space-y-2">
        <li v-for="service in page!.services" :key="service.id" class="flex justify-between rounded-lg bg-(--color-surface-card) p-3 text-sm">
          <span>{{ service.name }} ({{ service.durationMin }} دقیقه)</span>
          <NuxtLink :to="`/booking/${slug}/${service.id}`" class="font-bold text-(--color-accent)">
            {{ service.price.toLocaleString('fa-IR') }} تومان
          </NuxtLink>
        </li>
      </ul>
    </section>

    <section>
      <h2 class="font-bold mb-2">ساعات کاری</h2>
      <ul class="text-sm space-y-1">
        <li v-for="hour in page!.hours" :key="hour.weekday">
          {{ WEEKDAY_NAMES[hour.weekday] }}: {{ hour.openTime.slice(0, 5) }} - {{ hour.closeTime.slice(0, 5) }}
        </li>
      </ul>
    </section>

    <section>
      <h2 class="font-bold mb-2">نظرات</h2>
      <p v-if="!page!.reviews.length" class="text-sm">هنوز نظری ثبت نشده است</p>
      <ul v-else class="space-y-3">
        <li v-for="review in page!.reviews" :key="review.id" class="rounded-lg bg-(--color-surface-card) p-3 text-sm">
          <p>⭐ {{ review.rating }} — {{ review.comment }}</p>
          <p v-if="review.salonReply" class="mt-1 ps-3 border-s-2 text-(--color-text)">
            پاسخ سالن: {{ review.salonReply }}
          </p>
        </li>
      </ul>
    </section>
  </div>
</template>
```

Save as `apps/user-app/app/pages/salons/[slug].vue`. The booking entry point (`/booking/:slug/:serviceId` link on each service — using the salon's slug, not its UUID, so the booking page can reuse the same slug-keyed public endpoints from Task 3) is built in Task 17 — the link is correct now, the destination page doesn't exist until then.

- [ ] **Step 3: Manual verification**

Seed an approved salon with a service, working hours, a couple of `salon_photos` rows, and (optionally) a published review directly via SQL. Visit `/salons/<slug>` **without** logging in first — confirm the page renders fully (this is the whole point of Task 11's public-route carve-out). View page source (not just devtools, which shows the post-hydration DOM) and confirm the salon name/description appear in the raw HTML — that's the actual SEO-relevant check, not just "does it look right in the browser." Confirm the JSON-LD `<script type="application/ld+json">` tag is present in the source too.

- [ ] **Step 4: Commit**

```bash
git add apps/user-app/app/components/salon/SalonGallery.vue apps/user-app/app/pages/salons
git commit -m "feat(user-app): SSR salon profile page with SEO metadata and favorite toggle"
```

---

## Task 16: `SlotPicker` component

This is exactly the kind of component the original design spec calls out by name for testing (§9: "component tests only where logic is nontrivial (slot picker, booking status states)") — real TDD here.

**Files:**
- Create: `apps/user-app/app/utils/slot-format.ts`
- Create: `apps/user-app/app/components/booking/SlotPicker.vue`
- Test: `apps/user-app/test/unit/slot-format.spec.ts`
- Test: `apps/user-app/test/nuxt/SlotPicker.spec.ts`

- [ ] **Step 1: Write the failing unit tests for the pure formatting/selection logic**

Create `apps/user-app/test/unit/slot-format.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { pickDefaultDate, formatSlotTime } from '../../app/utils/slot-format'

describe('pickDefaultDate', () => {
  it('picks the first date that has at least one slot', () => {
    const days = [
      { date: '2026-07-10', slots: [] },
      { date: '2026-07-11', slots: ['2026-07-11T09:00:00.000Z'] },
    ]
    expect(pickDefaultDate(days)).toBe('2026-07-11')
  })

  it('returns null when every day is empty', () => {
    expect(pickDefaultDate([{ date: '2026-07-10', slots: [] }])).toBeNull()
  })

  it('returns null for an empty list', () => {
    expect(pickDefaultDate([])).toBeNull()
  })
})

describe('formatSlotTime', () => {
  it('formats an ISO instant as Tehran local HH:MM', () => {
    // 09:00 UTC is 12:30 in Asia/Tehran (UTC+3:30)
    expect(formatSlotTime('2026-07-11T09:00:00.000Z')).toBe('12:30')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @arayeshgah/user-app test`
Expected: FAIL — `slot-format.ts` doesn't exist.

- [ ] **Step 3: Implement the pure functions**

```typescript
export interface DayAvailability {
  date: string
  slots: string[]
}

export function pickDefaultDate(days: DayAvailability[]): string | null {
  const firstWithSlots = days.find((d) => d.slots.length > 0)
  return firstWithSlots?.date ?? null
}

export function formatSlotTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' }).format(
    new Date(iso),
  )
}

export function formatDateLabel(dateStr: string): string {
  return new Intl.DateTimeFormat('fa-IR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Tehran' }).format(
    new Date(`${dateStr}T12:00:00Z`), // noon UTC keeps this on the intended calendar day in Asia/Tehran regardless of DST edge cases
  )
}
```

Save as `apps/user-app/app/utils/slot-format.ts`. (`formatSlotTime` uses `en-GB` deliberately — Persian (`fa-IR`) digit glyphs read confusingly for a 24-hour clock at a glance; the date label above uses `fa-IR` since weekday/month names should be Persian.)

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `pnpm --filter @arayeshgah/user-app test`
Expected: PASS for `slot-format.spec.ts`

- [ ] **Step 5: Write the failing component test**

Create `apps/user-app/test/nuxt/SlotPicker.spec.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import SlotPicker from '../../app/components/booking/SlotPicker.vue'

const apiFetchMock = vi.fn()
mockNuxtImport('useApi', () => () => ({ apiFetch: apiFetchMock }))

describe('SlotPicker', () => {
  it('defaults to the first date with slots and emits the chosen ISO instant on click', async () => {
    apiFetchMock.mockResolvedValue({
      data: [
        { date: '2026-07-10', slots: [] },
        { date: '2026-07-11', slots: ['2026-07-11T09:00:00.000Z', '2026-07-11T09:30:00.000Z'] },
      ],
      error: null,
    })

    const wrapper = await mountSuspended(SlotPicker, { props: { salonId: 's1', serviceId: 'sv1' } })
    const buttons = wrapper.findAll('[data-testid="slot-button"]')
    expect(buttons).toHaveLength(2)

    await buttons[0].trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual(['2026-07-11T09:00:00.000Z'])
  })

  it('shows an empty state when no day has any slots', async () => {
    apiFetchMock.mockResolvedValue({ data: [{ date: '2026-07-10', slots: [] }], error: null })
    const wrapper = await mountSuspended(SlotPicker, { props: { salonId: 's1', serviceId: 'sv1' } })
    expect(wrapper.text()).toContain('نوبت خالی')
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @arayeshgah/user-app test`
Expected: FAIL — `SlotPicker.vue` doesn't exist.

- [ ] **Step 7: Implement `SlotPicker.vue`**

```vue
<script setup lang="ts">
import { pickDefaultDate, formatSlotTime, formatDateLabel, type DayAvailability } from '../../utils/slot-format'

const props = defineProps<{ salonId: string; serviceId: string }>()
const emit = defineEmits<{ select: [iso: string] }>()

const { apiFetch } = useApi()
const days = ref<DayAvailability[]>([])
const selectedDate = ref<string | null>(null)

onMounted(async () => {
  const { data } = await apiFetch<DayAvailability[]>(`/salons/${props.salonId}/availability`, {
    query: { serviceId: props.serviceId },
    silent: true,
  })
  days.value = data ?? []
  selectedDate.value = pickDefaultDate(days.value)
})

const slotsForSelectedDate = computed(() => days.value.find((d) => d.date === selectedDate.value)?.slots ?? [])
const hasAnySlots = computed(() => days.value.some((d) => d.slots.length > 0))
</script>

<template>
  <div v-if="!hasAnySlots" class="text-sm text-center py-6">نوبت خالی — این سالن در ۱۴ روز آینده نوبت آزاد ندارد</div>
  <div v-else class="space-y-3">
    <div class="flex gap-2 overflow-x-auto">
      <button
        v-for="day in days.filter((d) => d.slots.length > 0)"
        :key="day.date"
        type="button"
        class="whitespace-nowrap rounded-full px-3 py-1 text-sm"
        :class="selectedDate === day.date ? 'bg-(--color-accent) text-white' : 'bg-(--color-surface-card)'"
        @click="selectedDate = day.date"
      >
        {{ formatDateLabel(day.date) }}
      </button>
    </div>
    <div class="grid grid-cols-4 gap-2">
      <button
        v-for="slot in slotsForSelectedDate"
        :key="slot"
        type="button"
        data-testid="slot-button"
        class="rounded-lg bg-(--color-surface-card) p-2 text-sm"
        @click="emit('select', slot)"
      >
        {{ formatSlotTime(slot) }}
      </button>
    </div>
  </div>
</template>
```

Save as `apps/user-app/app/components/booking/SlotPicker.vue`.

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @arayeshgah/user-app test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/user-app/app/utils/slot-format.ts apps/user-app/app/components/booking/SlotPicker.vue apps/user-app/test/unit/slot-format.spec.ts apps/user-app/test/nuxt/SlotPicker.spec.ts
git commit -m "feat(user-app): SlotPicker component for the booking flow"
```

---

## Task 17: Booking confirm sheet, create booking, redirect to payment

**A gap found while writing this task:** the confirm sheet is supposed to show the deposit amount and cancellation policy before the user commits (per the original design spec §5), but `platform_config` (where `deposit_percent`, `deposit_min_toman`, `cancellation_window_hours` actually live) has never had a public read endpoint — only `PlatformConfigService`, consumed internally by the booking module. Hardcoding "20%" in the frontend would silently drift from the real admin-configured value the moment an admin changes it via direct DB update. This task adds one small public endpoint for exactly the three values the confirm sheet needs, before building the page that needs them.

**⚠️ File collision, confirmed against the actual repo:** `apps/api/test/platform-config.e2e-spec.ts` **already exists** (from an earlier plan) with a passing `describe('PlatformConfigService (e2e)', ...)` block testing the service directly. Read it before touching it — this task **appends** a second `describe` block to that file, it does not replace it. Overwriting it would silently delete existing, currently-passing test coverage.

**Files:**
- Create: `apps/api/src/platform-config/platform-config.controller.ts`
- Modify: `apps/api/src/platform-config/platform-config.module.ts`
- Modify: `apps/api/test/platform-config.e2e-spec.ts` (existing file — append a new `describe` block, do not replace its contents)
- Create: `apps/user-app/app/pages/booking/[slug]/[serviceId].vue`

- [ ] **Step 1: Write the failing backend e2e test**

Read `apps/api/test/platform-config.e2e-spec.ts` first. Append this new `describe` block after the existing one (same file, same imports already present — `request` from `supertest` isn't currently imported there, so add it):

```typescript
describe('Platform config — public booking terms (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes the deposit and cancellation terms without auth', async () => {
    const res = await request(app.getHttpServer()).get('/api/platform-config/booking-terms').expect(200);
    expect(res.body).toEqual({
      depositPercent: 20,
      depositMinToman: 200000,
      cancellationWindowHours: 24,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test:e2e -- platform-config.e2e-spec.ts`
Expected: FAIL — 404, route doesn't exist.

- [ ] **Step 3: Implement the controller**

```typescript
import { Controller, Get } from '@nestjs/common';
import { PlatformConfigService } from './platform-config.service';

@Controller('platform-config')
export class PlatformConfigController {
  constructor(private readonly config: PlatformConfigService) {}

  @Get('booking-terms')
  async bookingTerms() {
    const [depositPercent, depositMinToman, cancellationWindowHours] = await Promise.all([
      this.config.getDepositPercent(),
      this.config.getDepositMinToman(),
      this.config.getCancellationWindowHours(),
    ]);
    return { depositPercent, depositMinToman, cancellationWindowHours };
  }
}
```

- [ ] **Step 4: Register the controller**

In `apps/api/src/platform-config/platform-config.module.ts`, add `PlatformConfigController` to a `controllers: [...]` array (this module currently has none — add the array).

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test:e2e -- platform-config.e2e-spec.ts`
Expected: PASS

- [ ] **Step 6: Run the full backend suite**

Run: `pnpm --filter @arayeshgah/api test && pnpm --filter @arayeshgah/api test:e2e`
Expected: all PASS

- [ ] **Step 7: Commit the backend addition**

```bash
git add apps/api/src/platform-config/platform-config.controller.ts apps/api/src/platform-config/platform-config.module.ts apps/api/test/platform-config.e2e-spec.ts
git commit -m "feat(api): public read-only endpoint for booking deposit/cancellation terms"
```

- [ ] **Step 8: Implement the booking confirm page**

No TDD for this page itself — it's a thin orchestration of already-tested pieces (`SlotPicker`, `useApi`), with no nontrivial branching logic of its own beyond what those already cover.

```vue
<script setup lang="ts">
interface Salon { id: string; name: string; address: string }
interface SalonServiceItem { id: string; name: string; price: number; durationMin: number }
interface BookingTerms { depositPercent: number; depositMinToman: number; cancellationWindowHours: number }

const route = useRoute()
const slug = route.params.slug as string
const serviceId = route.params.serviceId as string
const { apiFetch } = useApi()

const { data: page } = await useAsyncData(`booking-${slug}-${serviceId}`, async () => {
  const [salonRes, servicesRes, termsRes] = await Promise.all([
    apiFetch<Salon>(`/salons/${slug}`, { silent: true }),
    apiFetch<SalonServiceItem[]>(`/salons/${slug}/services`, { silent: true }),
    apiFetch<BookingTerms>('/platform-config/booking-terms', { silent: true }),
  ])
  const service = servicesRes.data?.find((s) => s.id === serviceId)
  if (!salonRes.data || !service) return null
  return { salon: salonRes.data, service, terms: termsRes.data }
})

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Service not found' })
}

const selectedSlot = ref<string | null>(null)
const submitting = ref(false)
const submitError = ref('')

const estimatedDeposit = computed(() => {
  if (!page.value?.terms) return null
  const pct = Math.round((page.value.service.price * page.value.terms.depositPercent) / 100)
  return Math.max(pct, page.value.terms.depositMinToman)
})

async function confirmBooking() {
  if (!selectedSlot.value) return
  submitting.value = true
  submitError.value = ''
  const { data, error } = await apiFetch<{ booking: { id: string }; paymentUrl: string }>('/bookings', {
    method: 'POST',
    body: { salonId: page.value!.salon.id, serviceId, startsAt: selectedSlot.value },
    silent: true,
  })
  submitting.value = false
  if (error || !data) {
    submitError.value = error?.status === 409 ? 'این نوبت همین الان رزرو شد، لطفا زمان دیگری را انتخاب کنید' : 'خطایی رخ داد'
    selectedSlot.value = null
    return
  }
  await navigateTo(data.paymentUrl, { external: true })
}
</script>

<template>
  <div class="p-4 space-y-4">
    <div>
      <h1 class="text-lg font-bold">{{ page!.service.name }}</h1>
      <p class="text-sm">{{ page!.salon.name }} — {{ page!.salon.address }}</p>
    </div>

    <SlotPicker :salon-id="page!.salon.id" :service-id="serviceId" @select="selectedSlot = $event" />

    <div v-if="selectedSlot" class="rounded-xl bg-(--color-surface-card) p-4 space-y-2 text-sm">
      <p>قیمت کامل: {{ page!.service.price.toLocaleString('fa-IR') }} تومان</p>
      <p v-if="estimatedDeposit">پیش‌پرداخت آنلاین: {{ estimatedDeposit.toLocaleString('fa-IR') }} تومان</p>
      <p v-if="page!.terms">لغو رایگان تا {{ page!.terms.cancellationWindowHours }} ساعت قبل از نوبت</p>
      <button
        type="button"
        :disabled="submitting"
        class="w-full rounded-lg bg-(--color-accent) p-3 font-semibold text-white"
        @click="confirmBooking"
      >
        {{ submitting ? 'در حال پردازش...' : 'پرداخت و رزرو' }}
      </button>
      <p v-if="submitError" class="text-(--color-ad)">{{ submitError }}</p>
    </div>
  </div>
</template>
```

Save as `apps/user-app/app/pages/booking/[slug]/[serviceId].vue`. `navigateTo(url, { external: true })` is required here specifically because `paymentUrl` points at Zarinpal (or the mock gateway's own callback URL in dev), an entirely different origin — Nuxt's router would otherwise try to resolve it as an internal route.

- [ ] **Step 9: Manual verification**

With `PAYMENT_GATEWAY=mock` (the dev default), walk through: salon profile → pick a service → pick a slot → confirm → redirected to the mock gateway's payment URL, which immediately redirects to `/booking/callback?status=success&bookingId=...` (Task 1's redirect, Task 18 builds the page that receives it). Also try double-clicking confirm quickly / opening the same slot in two tabs to see the 409 "slot taken" message render instead of a crash.

- [ ] **Step 10: Commit**

```bash
git add apps/user-app/app/pages/booking
git commit -m "feat(user-app): booking confirm sheet with accurate deposit terms"
```

---

## Task 18: Payment callback page + a real "retry payment" backend endpoint

**Another gap found while writing this task:** the original design spec says "pending payments surface as a retry banner" (§5), but there was never a backend way to resume one — the Zarinpal `paymentUrl` is only ever returned once, from the initial `POST /bookings` response, and `payments.booking_id` is unique (one payment row per booking), so a retry can't just insert a second payment row either. This task adds a `POST /bookings/:id/retry-payment` endpoint that updates the *existing* payment row with a fresh gateway authority, mirroring the tail end of `BookingsService.createHold()`.

**Files:**
- Modify: `apps/api/src/booking/bookings.service.ts`
- Modify: `apps/api/src/booking/bookings.controller.ts`
- Test: `apps/api/test/bookings.e2e-spec.ts` (existing file — add tests)
- Create: `apps/user-app/app/pages/booking/callback.vue`

- [ ] **Step 1: Write the failing backend e2e test**

Add to `apps/api/test/bookings.e2e-spec.ts` (read the file first to reuse its existing setup helpers for getting a customer into a `pending_payment` booking, matching its established style):

```typescript
describe('retry-payment', () => {
  it('issues a fresh payment URL for a still-pending booking', async () => {
    const { bookingId } = await createPendingBooking(app, cookie); // reuse this file's existing helper name
    const res = await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/retry-payment`)
      .set('Cookie', cookie)
      .expect(201);
    expect(res.body.paymentUrl).toContain('Authority=');
  });

  it('404s for a booking that is not pending_payment (e.g. already confirmed)', async () => {
    const { bookingId, authority } = await createPendingBooking(app, cookie);
    await request(app.getHttpServer()).get(`/api/payments/callback?Authority=${authority}&Status=OK`).expect(302);

    await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/retry-payment`)
      .set('Cookie', cookie)
      .expect(404);
  });

  it("404s for another user's booking", async () => {
    const otherCookie = await loginAs(app, '09160000099');
    const { bookingId } = await createPendingBooking(app, cookie);
    await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/retry-payment`)
      .set('Cookie', otherCookie)
      .expect(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test:e2e -- bookings.e2e-spec.ts`
Expected: FAIL — route doesn't exist (404 on the happy-path test too, but for the wrong reason).

- [ ] **Step 3: Implement `retryPayment` in `BookingsService`**

Add this method (it needs the same `salons` and `payments` repositories and `gateway`/`nestConfig` already injected into this service — no new constructor params):

```typescript
  async retryPayment(userId: string, bookingId: string): Promise<{ paymentUrl: string }> {
    const booking = await this.bookings.findOneBy({ id: bookingId, userId, status: 'pending_payment' });
    if (!booking) throw new NotFoundException('No retryable booking found');

    const payment = await this.payments.findOneBy({ bookingId, status: 'initiated' });
    if (!payment) throw new NotFoundException('No retryable payment found');

    const salon = await this.salons.findOneBy({ id: booking.salonId });
    if (!salon) throw new NotFoundException('Salon not found');

    const callbackUrl = `${this.nestConfig.getOrThrow('APP_BASE_URL')}/api/payments/callback`;
    const { authority, paymentUrl } = await this.gateway.requestPayment(
      payment.amount,
      `Booking deposit for ${salon.name}`,
      callbackUrl,
    );
    await this.payments.update({ id: payment.id }, { authority });

    return { paymentUrl };
  }
```

- [ ] **Step 4: Add the controller route**

In `apps/api/src/booking/bookings.controller.ts`, add:

```typescript
  @Post(':id/retry-payment')
  retryPayment(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.retryPayment((req.user as User).id, id);
  }
```

(Add `ParseUUIDPipe` to the existing `@nestjs/common` import line if it isn't already imported in this file — it is, for the existing `findMine`/`cancel` routes.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test:e2e -- bookings.e2e-spec.ts`
Expected: PASS

- [ ] **Step 6: Run the full backend suite**

Run: `pnpm --filter @arayeshgah/api test && pnpm --filter @arayeshgah/api test:e2e`
Expected: all PASS

- [ ] **Step 7: Commit the backend addition**

```bash
git add apps/api/src/booking/bookings.service.ts apps/api/src/booking/bookings.controller.ts apps/api/test/bookings.e2e-spec.ts
git commit -m "feat(api): retry-payment endpoint for an abandoned pending booking"
```

- [ ] **Step 8: Implement the payment callback landing page**

```vue
<script setup lang="ts">
definePageMeta({ layout: 'bare' })

const route = useRoute()
const status = route.query.status as string
const bookingId = route.query.bookingId as string
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-6 text-center">
    <div class="max-w-sm space-y-3">
      <p v-if="status === 'success'" class="text-lg font-bold">پرداخت با موفقیت انجام شد ✅</p>
      <p v-else class="text-lg font-bold">پرداخت ناموفق بود ❌</p>
      <NuxtLink v-if="bookingId" :to="`/bookings/${bookingId}`" class="block rounded-lg bg-(--color-accent) text-white p-3 font-semibold">
        مشاهده جزئیات نوبت
      </NuxtLink>
      <NuxtLink to="/bookings" class="block text-sm">نوبت‌های من</NuxtLink>
    </div>
  </div>
</template>
```

Save as `apps/user-app/app/pages/booking/callback.vue`. It deliberately does not re-fetch or re-verify anything against the API — `PaymentsService.handleCallback` (Task 1) already did the one authoritative server-side verification before issuing this redirect; this page just reflects that outcome and links onward. The actual "retry banner" UI that calls `POST /bookings/:id/retry-payment` lives on the My Bookings page (Task 19), where a `pending_payment` booking is something the user browses to intentionally, not something reachable mid-flow here.

- [ ] **Step 9: Manual verification**

Repeat Task 17's manual booking flow through to completion — confirm landing on `/booking/callback?status=success&bookingId=...` shows the success message and both links resolve (the `/bookings/:id` link will 404 until Task 19 exists; that's expected at this point).

- [ ] **Step 10: Commit**

```bash
git add apps/user-app/app/pages/booking/callback.vue
git commit -m "feat(user-app): payment callback landing page"
```

---

## Task 19: My bookings, cancel, retry banner, review prompt

**One more gap found while writing this task:** `GET /bookings/mine` and `GET /bookings/:id` return the bare `Booking` row — `salonId`/`serviceId` only, no names. A bookings list showing nothing but UUIDs isn't usable. `BookingsService` already injects both the `Salon` and `SalonService` repositories (used elsewhere in the same file), so this is a same-file, additive enrichment — no new dependencies, and the existing e2e assertions on these two routes only check array length / individual field presence, never exact deep equality, so adding fields is safe.

**Files:**
- Modify: `apps/api/src/booking/bookings.service.ts`
- Test: `apps/api/test/bookings.e2e-spec.ts` (existing file — add assertions)
- Create: `apps/user-app/app/components/booking/ReviewPromptModal.vue`
- Create: `apps/user-app/app/pages/bookings/index.vue`
- Create: `apps/user-app/app/pages/bookings/[id].vue`

- [ ] **Step 1: Write the failing backend test**

Add to `apps/api/test/bookings.e2e-spec.ts`, right after the existing `'lists the caller\'s own bookings via GET /bookings/mine'` test:

```typescript
it('includes the salon and service names in the list response', async () => {
  const res = await request(app.getHttpServer())
    .get('/api/bookings/mine')
    .set('Cookie', customerCookie)
    .expect(200);
  expect(res.body[0]).toHaveProperty('salonName');
  expect(res.body[0]).toHaveProperty('serviceName');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test:e2e -- bookings.e2e-spec.ts`
Expected: FAIL — `salonName`/`serviceName` are `undefined`.

- [ ] **Step 3: Implement the enrichment in `BookingsService`**

Replace `listMine` and `findMine`, and add the private helper (place it near the bottom of the class, e.g. right after `cancel`):

```typescript
  async findMine(userId: string, id: string): Promise<Booking & { salonName: string; serviceName: string }> {
    const booking = await this.bookings.findOneBy({ id, userId });
    if (!booking) throw new NotFoundException('Booking not found');
    const [withNames] = await this.attachNames([booking]);
    return withNames;
  }

  async listMine(userId: string): Promise<Array<Booking & { salonName: string; serviceName: string }>> {
    const bookings = await this.bookings.find({ where: { userId }, order: { startsAt: 'DESC' } });
    return this.attachNames(bookings);
  }
```

```typescript
  private async attachNames(bookings: Booking[]): Promise<Array<Booking & { salonName: string; serviceName: string }>> {
    if (bookings.length === 0) return [];
    const salonIds = [...new Set(bookings.map((b) => b.salonId))];
    const serviceIds = [...new Set(bookings.map((b) => b.serviceId))];
    const [salonRows, serviceRows] = await Promise.all([
      this.salons.find({ where: { id: In(salonIds) } }),
      this.services.find({ where: { id: In(serviceIds) } }),
    ]);
    const salonNameById = new Map(salonRows.map((s) => [s.id, s.name]));
    const serviceNameById = new Map(serviceRows.map((s) => [s.id, s.name]));
    return bookings.map((b) => ({
      ...b,
      salonName: salonNameById.get(b.salonId) ?? 'Unknown salon',
      serviceName: serviceNameById.get(b.serviceId) ?? 'Unknown service',
    }));
  }
```

`In` is already imported at the top of this file (used elsewhere for the overlap check in `createHold`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test:e2e -- bookings.e2e-spec.ts`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `pnpm --filter @arayeshgah/api test && pnpm --filter @arayeshgah/api test:e2e`
Expected: all PASS

- [ ] **Step 6: Commit the backend addition**

```bash
git add apps/api/src/booking/bookings.service.ts apps/api/test/bookings.e2e-spec.ts
git commit -m "feat(api): include salon/service names on the bookings-mine endpoints"
```

- [ ] **Step 7: Implement `ReviewPromptModal.vue`**

```vue
<script setup lang="ts">
const props = defineProps<{ bookingId: string }>()
const emit = defineEmits<{ close: []; submitted: [] }>()

const { apiFetch } = useApi()
const rating = ref(5)
const comment = ref('')
const submitting = ref(false)
const alreadyReviewed = ref(false)

async function submit() {
  submitting.value = true
  const { error } = await apiFetch('/reviews', {
    method: 'POST',
    body: { bookingId: props.bookingId, rating: rating.value, comment: comment.value || undefined },
    silent: true,
  })
  submitting.value = false
  if (error?.status === 409) {
    alreadyReviewed.value = true
    return
  }
  if (!error) emit('submitted')
}
</script>

<template>
  <div class="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
    <div class="bg-(--color-surface-card) rounded-xl p-4 w-full max-w-sm space-y-3">
      <p v-if="alreadyReviewed" class="text-sm">شما قبلا برای این نوبت نظر ثبت کرده‌اید</p>
      <template v-else>
        <h2 class="font-bold">این نوبت چطور بود؟</h2>
        <div class="flex gap-1 text-2xl">
          <button v-for="n in 5" :key="n" type="button" @click="rating = n">
            {{ n <= rating ? '⭐' : '☆' }}
          </button>
        </div>
        <textarea v-model="comment" placeholder="نظر شما (اختیاری)" class="w-full rounded-lg border p-2 text-sm" rows="3" />
        <button type="button" :disabled="submitting" class="w-full rounded-lg bg-(--color-accent) text-white p-2 font-semibold" @click="submit">
          ثبت نظر
        </button>
      </template>
      <button type="button" class="w-full text-sm" @click="emit('close')">بستن</button>
    </div>
  </div>
</template>
```

Save as `apps/user-app/app/components/booking/ReviewPromptModal.vue`.

- [ ] **Step 8: Implement the My Bookings list page**

```vue
<script setup lang="ts">
interface BookingItem {
  id: string
  salonName: string
  serviceName: string
  startsAt: string
  priceSnapshot: number
  status: 'pending_payment' | 'confirmed' | 'completed' | 'cancelled_by_user' | 'cancelled_by_salon' | 'expired' | 'no_show'
}

const { apiFetch } = useApi()
const bookings = ref<BookingItem[]>([])
const loading = ref(true)
const reviewingBookingId = ref<string | null>(null)

const STATUS_LABELS: Record<BookingItem['status'], string> = {
  pending_payment: 'در انتظار پرداخت',
  confirmed: 'تایید شده',
  completed: 'انجام شده',
  cancelled_by_user: 'لغو شده توسط شما',
  cancelled_by_salon: 'لغو شده توسط سالن',
  expired: 'منقضی شده',
  no_show: 'عدم مراجعه',
}

async function load() {
  loading.value = true
  const { data } = await apiFetch<BookingItem[]>('/bookings/mine', { silent: true })
  bookings.value = data ?? []
  loading.value = false
}

onMounted(load)

async function retryPayment(id: string) {
  const { data } = await apiFetch<{ paymentUrl: string }>(`/bookings/${id}/retry-payment`, { method: 'POST' })
  if (data) await navigateTo(data.paymentUrl, { external: true })
}

async function cancelBooking(id: string) {
  if (!confirm('این نوبت لغو شود؟')) return
  const { error } = await apiFetch(`/bookings/${id}/cancel`, { method: 'POST' })
  if (!error) load()
}
</script>

<template>
  <div class="p-4 space-y-3">
    <h1 class="text-lg font-bold">نوبت‌های من</h1>
    <p v-if="loading" class="text-sm text-center">در حال بارگذاری...</p>
    <p v-else-if="!bookings.length" class="text-sm text-center">نوبتی ثبت نشده است</p>

    <div v-for="booking in bookings" :key="booking.id" class="rounded-xl bg-(--color-surface-card) p-3 text-sm space-y-1">
      <p class="font-bold">{{ booking.salonName }} — {{ booking.serviceName }}</p>
      <p>{{ new Date(booking.startsAt).toLocaleString('fa-IR') }}</p>
      <p>{{ STATUS_LABELS[booking.status] }}</p>

      <div v-if="booking.status === 'pending_payment'" class="rounded-lg bg-(--color-ad)/10 p-2 flex items-center justify-between">
        <span>پرداخت این نوبت کامل نشده است</span>
        <button type="button" class="rounded-lg bg-(--color-accent) text-white px-3 py-1" @click="retryPayment(booking.id)">تکمیل پرداخت</button>
      </div>

      <button
        v-if="['pending_payment', 'confirmed'].includes(booking.status)"
        type="button"
        class="text-(--color-ad)"
        @click="cancelBooking(booking.id)"
      >
        لغو نوبت
      </button>

      <button
        v-if="booking.status === 'completed'"
        type="button"
        class="text-(--color-accent)"
        @click="reviewingBookingId = booking.id"
      >
        ثبت نظر
      </button>
    </div>

    <ReviewPromptModal
      v-if="reviewingBookingId"
      :booking-id="reviewingBookingId"
      @close="reviewingBookingId = null"
      @submitted="reviewingBookingId = null"
    />
  </div>
</template>
```

Save as `apps/user-app/app/pages/bookings/index.vue`.

- [ ] **Step 9: Implement the booking detail page**

```vue
<script setup lang="ts">
interface BookingDetail {
  id: string
  salonName: string
  serviceName: string
  startsAt: string
  priceSnapshot: number
  depositAmount: number
  status: string
}

const route = useRoute()
const { apiFetch } = useApi()

const { data: booking } = await useAsyncData(`booking-detail-${route.params.id}`, async () => {
  const { data } = await apiFetch<BookingDetail>(`/bookings/${route.params.id}`, { silent: true })
  return data
})

if (!booking.value) {
  throw createError({ statusCode: 404, statusMessage: 'Booking not found' })
}
</script>

<template>
  <div class="p-4 space-y-2 text-sm">
    <h1 class="text-lg font-bold">{{ booking!.salonName }}</h1>
    <p>{{ booking!.serviceName }}</p>
    <p>{{ new Date(booking!.startsAt).toLocaleString('fa-IR') }}</p>
    <p>مبلغ کل: {{ booking!.priceSnapshot.toLocaleString('fa-IR') }} تومان</p>
    <p>پیش‌پرداخت: {{ booking!.depositAmount.toLocaleString('fa-IR') }} تومان</p>
    <NuxtLink to="/bookings" class="block text-(--color-accent)">بازگشت به نوبت‌های من</NuxtLink>
  </div>
</template>
```

Save as `apps/user-app/app/pages/bookings/[id].vue`.

- [ ] **Step 10: Manual verification**

With bookings in a mix of states (seed a couple more directly via SQL, or walk through the flow again), confirm: pending-payment bookings show the retry banner and it lands back at a fresh Zarinpal (mock) URL; cancel works and disappears the button afterward (status label changes); a `completed` booking (flip one to `completed` via SQL — there's no salon owner UI yet either) shows the review button, opens the modal, and submitting it works; submitting a second review for the same booking shows "already reviewed" instead of crashing.

- [ ] **Step 11: Commit**

```bash
git add apps/user-app/app/components/booking/ReviewPromptModal.vue apps/user-app/app/pages/bookings
git commit -m "feat(user-app): my bookings list with cancel, payment retry, and review prompt"
```

---

## Task 20: PWA — manifest, installability, service worker with push handling

Uses the `injectManifest` strategy (not the default `generateSW`) specifically because the service worker needs a custom `push` event listener to show system notifications — `generateSW` only generates a precaching worker with no room for custom event handlers, confirmed against `vite-pwa-org.netlify.app`'s own injectManifest guide.

**⚠️ Real icon assets required:** this task references `/pwa-192.png` and `/pwa-512.png` in the manifest. These are binary design assets this plan cannot produce — before this task is considered done, real PNG icons derived from the final brand mark (the light-mode "Teal Trust" identity, per the design spec) must be placed at `apps/user-app/public/pwa-192.png` and `pwa-512.png`. Until then, installability will work with a broken/placeholder icon, which is a known, visible gap — not a silent one.

**Files:**
- Modify: `apps/user-app/package.json`
- Modify: `apps/user-app/nuxt.config.ts`
- Create: `apps/user-app/app/sw.ts`
- Create: `apps/user-app/public/pwa-192.png` (design asset — see warning above)
- Create: `apps/user-app/public/pwa-512.png` (design asset — see warning above)

No TDD — this is build/infrastructure configuration and a third-party service-worker lifecycle, not application logic. Verification is manual, via a production build (service workers are disabled in Nuxt's dev server by default).

- [ ] **Step 1: Install `@vite-pwa/nuxt` and workbox**

Run: `pnpm --filter @arayeshgah/user-app add -D @vite-pwa/nuxt workbox-precaching`

- [ ] **Step 2: Register the module and configure `injectManifest`**

Add to `apps/user-app/nuxt.config.ts`:

```typescript
  modules: ['@pinia/nuxt', '@nuxt/test-utils/module', '@nuxt/image', '@vite-pwa/nuxt'],
  pwa: {
    strategies: 'injectManifest',
    srcDir: 'app',
    filename: 'sw.ts',
    registerType: 'autoUpdate',
    manifest: {
      name: 'آرایشگاه',
      short_name: 'آرایشگاه',
      description: 'رزرو آنلاین نوبت سالن‌های زیبایی',
      lang: 'fa',
      dir: 'rtl',
      theme_color: '#0EA89B',
      background_color: '#F4FBFA',
      display: 'standalone',
      icons: [
        { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
  },
```

- [ ] **Step 3: Write the custom service worker**

```typescript
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', (event) => {
  if (!event.data) return
  const payload = event.data.json() as { title: string; body: string }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/pwa-192.png',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow('/bookings'))
})
```

Save as `apps/user-app/app/sw.ts`. This is the exact shape the payload arrives in — it matches `PushPayload` (`{ title, body }`) from the backend's `push.provider.ts` (Task 5), sent as `JSON.stringify(payload)` in `WebPushProvider.send`.

- [ ] **Step 4: Add the placeholder-but-flagged icon files**

Until real brand icons exist, add minimal valid 192×192 and 512×512 PNGs (any solid-color placeholder generated locally, e.g. via an image editor or `ImageMagick`'s `convert -size 192x192 xc:'#0EA89B' pwa-192.png`) so the build doesn't reference missing files — but track replacing them with real brand icons as a follow-up, not this plan's problem to solve (no brand icon has been designed yet; that's a design deliverable, not a code task).

- [ ] **Step 5: Verify with a production build**

Run: `pnpm --filter @arayeshgah/user-app build && pnpm --filter @arayeshgah/user-app preview`
Open the preview URL in Chrome DevTools → Application → Manifest: confirm the manifest loads with the right name/colors/icons, and Application → Service Workers shows the worker registered and activated.

- [ ] **Step 6: Commit**

```bash
git add apps/user-app/package.json apps/user-app/nuxt.config.ts apps/user-app/app/sw.ts apps/user-app/public/pwa-192.png apps/user-app/public/pwa-512.png
git commit -m "feat(user-app): installable PWA with a custom push-handling service worker"
```

---

## Task 21: Profile page — account info, saved salons, push opt-in

Depends on Task 20's service worker already being registered (`navigator.serviceWorker.ready` never resolves without one) — that ordering is why PWA setup came first.

**Files:**
- Create: `apps/user-app/app/composables/usePushSubscription.ts`
- Create: `apps/user-app/app/pages/profile.vue`
- Modify: `apps/user-app/nuxt.config.ts`
- Modify: `.env.example` (repo root) and `apps/user-app/.env.example`

- [ ] **Step 1: Add the VAPID public key to runtime config**

The public half of the same VAPID keypair configured on the backend (Task 5's `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`) — the public key is safe to ship to the browser, the private key never leaves the API.

In `apps/user-app/nuxt.config.ts`:

```typescript
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:3002/api',
      neshanApiKey: process.env.NUXT_PUBLIC_NESHAN_API_KEY ?? '',
      vapidPublicKey: process.env.NUXT_PUBLIC_VAPID_PUBLIC_KEY ?? '',
    },
  },
```

Add `NUXT_PUBLIC_VAPID_PUBLIC_KEY=` to both `.env.example` files.

- [ ] **Step 2: Implement `usePushSubscription`**

```typescript
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function usePushSubscription() {
  const { apiFetch } = useApi()
  const config = useRuntimeConfig()
  const isSubscribed = ref(false)
  const supported = import.meta.client && 'serviceWorker' in navigator && 'PushManager' in window

  async function refreshStatus() {
    if (!supported) return
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    isSubscribed.value = !!sub
  }

  async function subscribe() {
    if (!supported) return
    const reg = await navigator.serviceWorker.ready
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.public.vapidPublicKey),
    })
    const json = sub.toJSON()
    await apiFetch('/push/subscribe', {
      method: 'POST',
      body: { endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    })
    isSubscribed.value = true
  }

  async function unsubscribe() {
    if (!supported) return
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await apiFetch('/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } })
      await sub.unsubscribe()
    }
    isSubscribed.value = false
  }

  return { supported, isSubscribed, refreshStatus, subscribe, unsubscribe }
}
```

Save as `apps/user-app/app/composables/usePushSubscription.ts`. Permission is requested from `subscribe()`, triggered by an explicit toggle click on the profile page (Step 3) — never on page load — per this plan's design spec §4 ("after a meaningful action, not on page load — avoids the dismiss-and-never-ask-again trap").

- [ ] **Step 3: Implement the profile page**

```vue
<script setup lang="ts">
interface FavoriteSalon { id: string; name: string; slug: string; city: string }

const session = useSessionStore()
const { apiFetch } = useApi()
const { supported: pushSupported, isSubscribed, refreshStatus, subscribe, unsubscribe } = usePushSubscription()

const favorites = ref<FavoriteSalon[]>([])
const name = ref(session.user?.name ?? '')
const gender = ref(session.user?.gender ?? 'female')
const savingProfile = ref(false)

onMounted(async () => {
  await refreshStatus()
  const { data } = await apiFetch<FavoriteSalon[]>('/favorites', { silent: true })
  favorites.value = data ?? []
})

async function saveProfile() {
  savingProfile.value = true
  const { data } = await apiFetch('/auth/profile', { method: 'PATCH', body: { name: name.value, gender: gender.value } })
  savingProfile.value = false
  if (data) session.setUser(data as typeof session.user)
}

async function togglePush() {
  if (isSubscribed.value) await unsubscribe()
  else await subscribe()
}

async function logout() {
  await apiFetch('/auth/logout', { method: 'POST' })
  session.setUser(null)
  await navigateTo('/login')
}
</script>

<template>
  <div class="p-4 space-y-6">
    <section class="space-y-2">
      <h1 class="text-lg font-bold">پروفایل</h1>
      <p class="text-sm">{{ session.user?.phone }}</p>
      <input v-model="name" type="text" placeholder="نام" class="w-full rounded-lg border p-2 text-sm" />
      <select v-model="gender" class="w-full rounded-lg border p-2 text-sm">
        <option value="female">زن</option>
        <option value="male">مرد</option>
      </select>
      <button type="button" :disabled="savingProfile" class="rounded-lg bg-(--color-accent) text-white px-4 py-2 text-sm" @click="saveProfile">
        ذخیره
      </button>
    </section>

    <section v-if="pushSupported" class="flex items-center justify-between">
      <span class="text-sm">اعلان‌های نوبت</span>
      <button type="button" class="rounded-full px-3 py-1 text-sm" :class="isSubscribed ? 'bg-(--color-accent) text-white' : 'bg-(--color-surface-card)'" @click="togglePush">
        {{ isSubscribed ? 'فعال' : 'غیرفعال' }}
      </button>
    </section>

    <section class="space-y-2">
      <h2 class="font-bold">سالن‌های ذخیره شده</h2>
      <p v-if="!favorites.length" class="text-sm">سالنی ذخیره نکرده‌اید</p>
      <NuxtLink v-for="salon in favorites" :key="salon.id" :to="`/salons/${salon.slug}`" class="block rounded-lg bg-(--color-surface-card) p-3 text-sm">
        {{ salon.name }} — {{ salon.city }}
      </NuxtLink>
    </section>

    <button type="button" class="text-sm text-(--color-ad)" @click="logout">خروج از حساب</button>
  </div>
</template>
```

Save as `apps/user-app/app/pages/profile.vue`.

- [ ] **Step 4: Manual verification**

Run a production build+preview (Task 20's dev-server caveat still applies — push subscription needs the real service worker). Visit `/profile`, toggle notifications on — confirm the browser's native permission prompt appears, and after granting, a row appears in the `push_subscriptions` table (check via `psql` or the API logs if `PUSH_PROVIDER=console`). Trigger a real booking confirmation and confirm a system notification appears (or, with `PUSH_PROVIDER=console`, confirm the API logs the console-provider line instead of erroring). Toggle a favorite salon from Task 15's page and confirm it shows up here.

- [ ] **Step 5: Commit**

```bash
git add apps/user-app/app/composables/usePushSubscription.ts apps/user-app/app/pages/profile.vue apps/user-app/nuxt.config.ts .env.example apps/user-app/.env.example
git commit -m "feat(user-app): profile page with saved salons and push notification opt-in"
```

---

## Task 22: SEO — sitemap, robots.txt, default meta

No existing endpoint lists every approved salon slug (search requires a location; `/admin/salons` requires admin auth) — the sitemap needs exactly that, unfiltered by location, so this task adds one small public endpoint for it first.

**Files:**
- Create: `apps/api/src/salons/sitemap-salons.controller.ts`
- Modify: `apps/api/src/salons/salons.module.ts`
- Test: `apps/api/test/public-salon-content.e2e-spec.ts` (existing file — add a test)
- Modify: `apps/user-app/package.json`
- Modify: `apps/user-app/nuxt.config.ts`
- Create: `apps/user-app/server/api/__sitemap__/urls.ts`
- Create: `apps/user-app/public/robots.txt`

- [ ] **Step 1: Write the failing backend test**

Add to `apps/api/test/public-salon-content.e2e-spec.ts` (reuses the `slug` seeded at the top of that file):

```typescript
it('lists all approved salon slugs for the sitemap, unfiltered by location', async () => {
  const res = await request(app.getHttpServer()).get('/api/sitemap/salon-slugs').expect(200);
  expect(res.body).toContain(slug);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test:e2e -- public-salon-content.e2e-spec.ts`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement the controller**

```typescript
import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Salon } from './salon.entity';

@Controller('sitemap')
export class SitemapSalonsController {
  constructor(@InjectRepository(Salon) private readonly salons: Repository<Salon>) {}

  @Get('salon-slugs')
  async list(): Promise<string[]> {
    const rows = await this.salons.find({ where: { status: 'approved' }, select: ['slug'] });
    return rows.map((r) => r.slug);
  }
}
```

Register `SitemapSalonsController` in `apps/api/src/salons/salons.module.ts`'s `controllers` array.

- [ ] **Step 4: Run the test to verify it passes, then the full backend suite**

Run: `pnpm --filter @arayeshgah/api test:e2e -- public-salon-content.e2e-spec.ts`
Expected: PASS

Run: `pnpm --filter @arayeshgah/api test && pnpm --filter @arayeshgah/api test:e2e`
Expected: all PASS

- [ ] **Step 5: Commit the backend addition**

```bash
git add apps/api/src/salons/sitemap-salons.controller.ts apps/api/src/salons/salons.module.ts apps/api/test/public-salon-content.e2e-spec.ts
git commit -m "feat(api): public endpoint listing all approved salon slugs, for the sitemap"
```

- [ ] **Step 6: Install `@nuxtjs/sitemap`**

Run: `pnpm --filter @arayeshgah/user-app add @nuxtjs/sitemap`

- [ ] **Step 7: Register the module and point it at the dynamic source**

Add to `apps/user-app/nuxt.config.ts`:

```typescript
  modules: ['@pinia/nuxt', '@nuxt/test-utils/module', '@nuxt/image', '@vite-pwa/nuxt', '@nuxtjs/sitemap'],
  site: {
    url: process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3003',
  },
  sitemap: {
    sources: ['/api/__sitemap__/urls'],
  },
```

- [ ] **Step 8: Implement the dynamic URL source**

```typescript
import type { SitemapUrlInput } from '#sitemap/types'
import { defineSitemapEventHandler } from '#imports'

export default defineSitemapEventHandler(async () => {
  const config = useRuntimeConfig()
  const slugs = await $fetch<string[]>(`${config.public.apiBase}/sitemap/salon-slugs`)

  return slugs.map((slug) => ({
    loc: `/salons/${slug}`,
    changefreq: 'weekly',
    priority: 0.8,
  })) satisfies SitemapUrlInput[]
})
```

Save as `apps/user-app/server/api/__sitemap__/urls.ts` — note this lives under `server/` at the package root, **not** under `app/`; Nuxt 4's `app/`-rooted default layout only applies to the Vue-side directories (see the File Structure note at the top of this plan).

- [ ] **Step 9: Add `robots.txt`**

```
User-agent: *
Allow: /
Allow: /salons/
Disallow: /admin/
Disallow: /bookings
Disallow: /profile
Disallow: /booking/

Sitemap: /sitemap.xml
```

Save as `apps/user-app/public/robots.txt`.

- [ ] **Step 10: Set default SEO meta for the whole app**

In `apps/user-app/app/app.vue`, add a `useSeoMeta` call (page-level calls in `salons/[slug].vue` already override `title`/`description`/`ogImage` per-page — this just sets sane defaults for every other route):

```vue
<script setup lang="ts">
useSeoMeta({
  titleTemplate: (title) => (title ? `${title} | آرایشگاه` : 'آرایشگاه — رزرو آنلاین نوبت سالن زیبایی'),
  ogSiteName: 'آرایشگاه',
})
</script>

<template>
  <NuxtRouteAnnouncer />
  <NuxtPage />
  <ToastStack />
</template>
```

- [ ] **Step 11: Manual verification**

Run a production build+preview. Visit `/sitemap.xml` and confirm it lists every approved salon's `/salons/:slug` URL. Visit `/robots.txt` and confirm it renders as written. Check a salon profile page's `<title>` in view-source and confirm it reads `"<Salon Name> | آرایشگاه"`.

- [ ] **Step 12: Commit**

```bash
git add apps/user-app/package.json apps/user-app/nuxt.config.ts apps/user-app/server apps/user-app/public/robots.txt apps/user-app/app/app.vue
git commit -m "feat(user-app): dynamic sitemap, robots.txt, and default SEO meta"
```

---

## Task 23: Admin featured-toggle page

Deliberately unstyled/functional-only, per this plan's design spec — it exists to make the ad-placement feature usable before the real admin-panel (a separate future plan) exists, not to preview that project's design.

**Files:**
- Create: `apps/user-app/app/middleware/admin.ts`
- Create: `apps/user-app/app/pages/admin/featured.vue`

- [ ] **Step 1: Implement the admin-only page middleware**

```typescript
export default defineNuxtRouteMiddleware(() => {
  const session = useSessionStore()
  if (session.user?.role !== 'admin') {
    return navigateTo('/')
  }
})
```

Save as `apps/user-app/app/middleware/admin.ts`. This is a **named** middleware (no `.global.ts` suffix), so it only runs on pages that opt in via `definePageMeta({ middleware: 'admin' })` — it runs after `auth.global.ts`, by which point `session.user` is already populated. This is purely a UX guard (hide the page from people who can't use it); the actual authorization boundary is still the API's `RolesGuard` on every `/admin/*` endpoint, same as always.

- [ ] **Step 2: Implement the page**

```vue
<script setup lang="ts">
definePageMeta({ middleware: 'admin' })

interface AdminSalon { id: string; name: string; city: string; isFeatured: boolean; featuredUntil: string | null }

const { apiFetch } = useApi()
const salons = ref<AdminSalon[]>([])
const savingId = ref<string | null>(null)

async function load() {
  const { data } = await apiFetch<AdminSalon[]>('/admin/salons', { silent: true })
  salons.value = data ?? []
}

onMounted(load)

async function toggle(salon: AdminSalon, featuredUntilInput: string) {
  savingId.value = salon.id
  await apiFetch(`/admin/salons/${salon.id}/featured`, {
    method: 'PATCH',
    body: {
      isFeatured: !salon.isFeatured,
      featuredUntil: featuredUntilInput ? new Date(featuredUntilInput).toISOString() : undefined,
    },
  })
  savingId.value = null
  await load()
}
</script>

<template>
  <div class="p-4">
    <h1 class="text-lg font-bold mb-4">مدیریت سالن‌های ویژه (تبلیغ)</h1>
    <table class="w-full text-sm border-collapse">
      <thead>
        <tr class="border-b">
          <th class="text-start p-2">نام</th>
          <th class="text-start p-2">شهر</th>
          <th class="text-start p-2">ویژه</th>
          <th class="text-start p-2">تا تاریخ</th>
          <th class="text-start p-2"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="salon in salons" :key="salon.id" class="border-b">
          <td class="p-2">{{ salon.name }}</td>
          <td class="p-2">{{ salon.city }}</td>
          <td class="p-2">{{ salon.isFeatured ? 'بله' : 'خیر' }}</td>
          <td class="p-2">
            <input :id="`until-${salon.id}`" type="date" class="border rounded p-1" />
          </td>
          <td class="p-2">
            <button
              type="button"
              :disabled="savingId === salon.id"
              class="rounded bg-(--color-accent) text-white px-2 py-1"
              @click="toggle(salon, (document.getElementById(`until-${salon.id}`) as HTMLInputElement).value)"
            >
              {{ salon.isFeatured ? 'حذف از ویژه' : 'افزودن به ویژه' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

Save as `apps/user-app/app/pages/admin/featured.vue`. Reaching into the DOM via `document.getElementById` for the date input (rather than a `ref` per row) is a deliberate shortcut consistent with "bare-bones, functional only" — a real admin-panel project would do this properly with a `v-model` per row in a reactive list.

- [ ] **Step 3: Manual verification**

Promote a test user to `role = 'admin'` via direct SQL (same pattern used in the Plan 3 admin-review e2e tests). Log in as that user, visit `/admin/featured`, toggle a salon featured with a future date, then confirm it shows the "تبلیغ" badge on the Home page (Task 13) for that salon. Log in as a non-admin and confirm visiting `/admin/featured` redirects to `/`.

- [ ] **Step 4: Commit**

```bash
git add apps/user-app/app/middleware/admin.ts apps/user-app/app/pages/admin/featured.vue
git commit -m "feat(user-app): bare-bones admin page for toggling featured salons"
```

---

## Task 24: Whole-system Playwright e2e + final verification

The original marketplace design spec (§9) called for "Playwright happy path (search → book → pay → review) against a seeded dev environment" from the very start — this is the first plan with a frontend to actually run that path against, so this task builds it, then runs everything.

**Files:**
- Create: `apps/user-app/playwright.config.ts`
- Create: `apps/user-app/e2e/global-setup.ts`
- Create: `apps/user-app/e2e/happy-path.spec.ts`
- Create: `apps/user-app/e2e/admin-featured-badge.spec.ts`
- Modify: `apps/user-app/package.json`

- [ ] **Step 1: Install Playwright**

Run: `pnpm --filter @arayeshgah/user-app add -D @playwright/test pg ioredis` (`pg`/`ioredis` are needed for `global-setup.ts`'s direct DB seeding and the happy-path spec's OTP lookup — same drivers `apps/api` already uses)

Run: `pnpm --filter @arayeshgah/user-app exec playwright install chromium`

- [ ] **Step 2: Write the global setup — reset schema, run migrations, seed one bookable salon**

```typescript
import { Client } from 'pg'
import { execSync } from 'node:child_process'
import path from 'node:path'

export default async function globalSetup() {
  const client = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5544),
    user: process.env.DB_USER ?? 'arayeshgah',
    password: process.env.DB_PASS ?? 'arayeshgah',
    database: process.env.DB_NAME ?? 'arayeshgah',
  })
  await client.connect()
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await client.end()

  execSync('pnpm --filter @arayeshgah/api migration:run', {
    cwd: path.resolve(__dirname, '../../..'),
    stdio: 'inherit',
  })

  const seedClient = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5544),
    user: process.env.DB_USER ?? 'arayeshgah',
    password: process.env.DB_PASS ?? 'arayeshgah',
    database: process.env.DB_NAME ?? 'arayeshgah',
  })
  await seedClient.connect()
  const { rows: [{ id: ownerId }] } = await seedClient.query(
    `INSERT INTO users (phone, role) VALUES ('09120000100', 'provider') RETURNING id`,
  )
  const { rows: [{ id: salonId }] } = await seedClient.query(
    `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
     VALUES ($1, 'سالن تست', 'e2e-test-salon', 'women', 'approved', 'آدرس تست', 'تهران',
       ST_SetSRID(ST_MakePoint(51.389, 35.6892), 4326)::geography)
     RETURNING id`,
    [ownerId],
  )
  const { rows: [{ id: categoryId }] } = await seedClient.query(`SELECT id FROM service_categories LIMIT 1`)
  await seedClient.query(
    `INSERT INTO salon_services (salon_id, category_id, name, price, duration_min, is_active)
     VALUES ($1, $2, 'کوتاهی مو', 300000, 30, true)`,
    [salonId, categoryId],
  )
  for (let weekday = 0; weekday <= 6; weekday++) {
    await seedClient.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time) VALUES ($1, $2, '09:00', '21:00')`,
      [salonId, weekday],
    )
  }
  await seedClient.end()
}
```

Save as `apps/user-app/e2e/global-setup.ts`. Working hours are seeded for every weekday specifically so this test never flakes depending on what day it happens to run.

- [ ] **Step 3: Write the Playwright config**

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:3003' },
  webServer: [
    {
      command: 'pnpm --filter @arayeshgah/api dev',
      url: 'http://localhost:3002/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'pnpm --filter @arayeshgah/user-app dev',
      url: 'http://localhost:3003',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
})
```

Save as `apps/user-app/playwright.config.ts`. Both dev servers (not production builds) — this suite is about the integration path working end to end, not a production-parity check (Task 25's build step already covers that separately).

- [ ] **Step 4: Write the happy-path spec**

`OtpService.issue()` (`apps/api/src/auth/otp.service.ts`) generates a genuinely random code with no test override — there is no fixed/predictable OTP to type in. But it stores that code in Redis at key `otp:<phone>`, the exact same place Jest's `loginAs()` test helper reads it from (`apps/api/test/utils/auth-helper.ts`). Playwright test files run in plain Node too, so this spec connects to the same Redis instance directly and reads the real code, instead of inventing a dev-only backdoor in `OtpService` that the rest of the system doesn't need.

```typescript
import { test, expect } from '@playwright/test'
import Redis from 'ioredis'

test('search, view salon, book, pay, land on confirmation', async ({ page }) => {
  const phone = '09120000200'
  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })

  await page.goto('/login')
  await page.getByPlaceholder('09xxxxxxxxx').fill(phone)
  await page.getByRole('button', { name: 'دریافت کد' }).click()

  const code = await redis.get(`otp:${phone}`)
  await redis.quit()
  if (!code) throw new Error('OTP was not found in Redis -- did SMS_PROVIDER/OtpService change?')

  await page.getByPlaceholder('کد ۶ رقمی').fill(code)
  await page.getByRole('button', { name: 'تایید' }).click()

  await page.getByPlaceholder('نام').fill('کاربر تست')
  await page.getByRole('combobox').selectOption('female')
  await page.getByRole('button', { name: 'تکمیل ثبت‌نام' }).click()

  await expect(page).toHaveURL('/')
  await page.getByText('سالن تست').click()

  await expect(page).toHaveURL(/\/salons\/e2e-test-salon/)
  await page.getByText('کوتاهی مو').click()

  await expect(page).toHaveURL(/\/booking\/e2e-test-salon\//)
  await page.getByTestId('slot-button').first().click()
  await page.getByRole('button', { name: 'پرداخت و رزرو' }).click()

  // MockPaymentGateway immediately redirects back with Status=OK -- see mock-payment.gateway.ts
  await expect(page).toHaveURL(/\/booking\/callback\?status=success/)
  await expect(page.getByText('پرداخت با موفقیت انجام شد')).toBeVisible()
})
```

Save as `apps/user-app/e2e/happy-path.spec.ts`. Add `ioredis` to `apps/user-app`'s devDependencies alongside `pg` (Step 1) — same driver `apps/api` already uses, so no new library to vet.

- [ ] **Step 5: Write the admin-featured-badge spec**

```typescript
import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import Redis from 'ioredis'

test('a salon flagged featured by an admin shows the Ad badge on Home', async ({ page }) => {
  const phone = '09120000200' // the customer from the happy-path test, already onboarded

  const client = new Client({
    host: process.env.DB_HOST ?? 'localhost', port: Number(process.env.DB_PORT ?? 5544),
    user: process.env.DB_USER ?? 'arayeshgah', password: process.env.DB_PASS ?? 'arayeshgah',
    database: process.env.DB_NAME ?? 'arayeshgah',
  })
  await client.connect()
  await client.query(`INSERT INTO users (phone, role) VALUES ('09120000201', 'admin') ON CONFLICT DO NOTHING`)
  await client.query(`UPDATE salons SET is_featured = true WHERE slug = 'e2e-test-salon'`)
  await client.end()

  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })

  await page.goto('/login')
  await page.getByPlaceholder('09xxxxxxxxx').fill(phone)
  await page.getByRole('button', { name: 'دریافت کد' }).click()

  const code = await redis.get(`otp:${phone}`)
  await redis.quit()
  if (!code) throw new Error('OTP was not found in Redis -- did SMS_PROVIDER/OtpService change?')

  await page.getByPlaceholder('کد ۶ رقمی').fill(code)
  await page.getByRole('button', { name: 'تایید' }).click()

  await expect(page.getByTestId('ad-badge')).toBeVisible()
})
```

Save as `apps/user-app/e2e/admin-featured-badge.spec.ts`. This test depends on `happy-path.spec.ts` having already run in the same session (reuses that seeded customer account) — Playwright runs spec files within a project serially by default, but confirm `fullyParallel` is not enabled in `playwright.config.ts` (it isn't, in the Step 3 config above) before relying on this ordering.

- [ ] **Step 6: Add the Playwright script and run everything**

Add to `apps/user-app/package.json` scripts: `"test:e2e": "playwright test"`.

Run, in order, fixing anything that fails before moving to the next:

```bash
docker compose up -d
pnpm --filter @arayeshgah/api test
pnpm --filter @arayeshgah/api test:e2e
pnpm --filter @arayeshgah/user-app test
pnpm --filter @arayeshgah/user-app test:e2e
pnpm build
```

Expected: every command exits 0. `pnpm build` (the root Turbo task, building both `apps/api` and `apps/user-app`) is the final production-parity check — it must succeed with zero errors before this plan is considered complete.

- [ ] **Step 7: Commit**

```bash
git add apps/user-app/playwright.config.ts apps/user-app/e2e apps/user-app/package.json
git commit -m "test(user-app): Playwright happy-path and admin-featured-badge e2e coverage"
```

---

## Task 25: README and getting-started docs

Every prior plan (1, 2, 3) ended by documenting what it shipped in `README.md` — this plan does the same.

**Files:**
- Modify: `README.md` (repo root)

- [ ] **Step 1: Update the "Structure" section**

The README's `## Structure` section currently reads:

```
- `apps/api` — NestJS modular monolith (PostgreSQL + PostGIS, Redis)
- `apps/user-app` — Nuxt 3 PWA (Plan 3)
- `apps/provider-panel` — Vue 3 SPA (Plan 4)
- `apps/admin-panel` — Vue 3 SPA (Plan 5)
```

All three plan numbers there are stale — Plan 3 ended up being Reviews & Moderation, and this plan (the real Plan 4) is the frontend, not `provider-panel`. Replace those three lines with:

```
- `apps/user-app` — Nuxt 4, mobile-first PWA (Plan 4)
- `apps/provider-panel` — Vue 3 SPA (future plan, not yet started)
- `apps/admin-panel` — Vue 3 SPA (future plan, not yet started)
```

- [ ] **Step 2: Add a "Getting started" addendum for the frontend**

Add after the existing `pnpm dev:api` getting-started block:

````markdown
```bash
cp apps/user-app/.env.example apps/user-app/.env   # set NUXT_PUBLIC_NESHAN_API_KEY and NUXT_PUBLIC_VAPID_PUBLIC_KEY for map/push features
pnpm dev:user-app                                   # http://localhost:3003
```

`NUXT_PUBLIC_VAPID_PUBLIC_KEY` must be the public half of the same keypair as the API's `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (`.env.example` at the repo root) — generate one pair with `npx web-push generate-vapid-keys` and split the two halves between the two `.env` files. Map and push both degrade gracefully without real keys (map view fails silently back to list view; push subscribe UI just won't do anything meaningful) — neither blocks the rest of the app.
````

- [ ] **Step 3: Add a "User app (Plan 4)" section**

Add after the existing "Reviews & moderation (Plan 3)" section:

````markdown
## User app (Plan 4)

The first real UI: a Nuxt 4 SSR PWA covering login, discovery, salon profiles, booking, my bookings, and profile — plus an admin-controlled "featured salon" placement and push/SMS appointment notifications. Full design: `docs/superpowers/specs/2026-07-05-plan-4-user-app-frontend-design.md`.

**New public (unauthenticated) surface, specifically for SEO:** salon profile pages (`/salons/:slug`) are the one part of this app reachable without logging in — they're SSR-rendered with JSON-LD/OG metadata as Google landing pages, matching the original marketplace spec's intent. Every other route requires a session.

**Featured salons ("تبلیغ" / Ad badge):** `PATCH /api/admin/salons/:id/featured` (admin-only) flags a salon as featured with an optional expiry. Featured, still-approved, still-filter-matching salons are boosted to the top of `/api/search` results (capped at 2 per query) and rendered with a distinct badge — this can never bypass the gender/city/category filters every other result already goes through. There's no self-serve payment flow yet; an admin sets the flag directly (via the bare-bones `/admin/featured` page in the frontend, or the API) until a real admin-panel and pricing model exist.

**Push notifications, and closing Plan 2's reminder gap:** booking confirmations now send a push notification alongside the existing SMS, and a new scheduled job (`booking-reminder.job.ts`, same pattern as the existing hold-expiry/reconciliation jobs) sends both an SMS and a push reminder a configurable number of hours (`platform_config.reminder_lead_hours`, seeded at 3) before each confirmed appointment — Plan 2 shipped without this.

**Known gaps carried forward, not fixed by this plan:**
- `salon_photos` has a public read endpoint now, but still no upload path anywhere in the system — galleries stay empty until provider-panel (a future plan) ships photo management.
- The admin `/admin/featured` page and the two admin salon endpoints it calls are intentionally minimal — there's still no salon-approval workflow (`pending` → `approved`) anywhere in the API; that remains a future admin-panel concern, same as before this plan.
- Blog/content-marketing SEO is a separate, not-yet-started Plan 5 — this plan only covers the salon-profile side of SEO.
````

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document the user-app frontend, featured salons, and push notifications from Plan 4"
```

---

## Self-Review

**Spec coverage:** every section of `2026-07-05-plan-4-user-app-frontend-design.md` maps to at least one task — architecture/tech stack (Tasks 8-10, 20, 22), all six screens (11, 13, 15, 17-19, 21, 23), notifications (5-7), performance/SEO (9, 13-15, 22), error handling (10, 5-7, 14), and testing (13, 16, 24). The out-of-scope list (blog CMS, self-serve promotion, Capacitor, full admin-panel, full i18n) was checked against every task and nothing here quietly reaches into any of them.

**Gaps found and resolved during planning, not left implicit:** this plan surfaced six real gaps in the existing system while writing tasks (no CORS, no public services/hours/photos endpoints, no push infrastructure, no public booking-terms endpoint, no payment-retry capability, no salon/service names on booking list responses, no sitemap-source endpoint) — each got its own small, narrowly-scoped backend task rather than a frontend workaround or a silently-dropped requirement. Two more (the reviews endpoint's slug-vs-UUID mismatch, and the booking route's salonId-vs-slug choice) were caught and resolved without needing a new endpoint, just correct sequencing in the frontend.

**Placeholder scan:** searched for "TBD"/"TODO"/"implement later"/"add appropriate"/unshown code — none found. The one spot that looks like a flagged gap (Task 20's PWA icon files) is an explicit, loud callout that real binary design assets are needed, not a vague deferral — the task still specifies exactly what to do in the meantime (placeholder PNGs) and why real ones matter.

**Type consistency:** `SearchResult` (id/name/slug/city/address/ratingAvg/ratingCount/distanceKm/minPrice/coverPhoto/isFeatured) is used identically in Tasks 13 and 14. `PushPayload` (`{title, body}`) matches across Tasks 5, 6, 7, and 20's service worker. `ApiResult<T>` (`{data, error}`) is the return shape of `useApi().apiFetch` used identically in every frontend task from 11 onward. Backend DTOs (`SubscribePushDto`, `CreateReviewDto`, `SetFeaturedDto`) match their frontend call sites' request bodies field-for-field.

**Scope check:** this plan is large (25 tasks) but is one cohesive deliverable — a working customer-facing app — matching the precedent set by Plan 2 (16 tasks, booking+payments+notifications as one plan). The one piece that genuinely was a separate subsystem (the blog CMS) was already split out to Plan 5 during brainstorming, before this plan was written.

