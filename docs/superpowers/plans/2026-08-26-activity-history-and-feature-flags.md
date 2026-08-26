# Plan — Customer Activity History + Platform Feature Flags

Design: `docs/superpowers/specs/2026-08-26-activity-history-and-feature-flags-design.md`

Executed as 5 independently-shippable, sequentially-verified slices — feature flags land
and are enforceable before the activity feed is built on top of anything, and each slice
gets its own typecheck+test pass before moving on.

## Slice 1 — Feature flags: data model + read/write endpoints

- Migration `<timestamp>-feature-flags.ts`: seed 5 `platform_config` rows (`feature_reviews_enabled`,
  `feature_stories_enabled`, `feature_portfolio_enabled`, `feature_referrals_enabled`,
  `feature_coupons_enabled`), all `true`.
- `platform-config.service.ts`: add `FEATURE_FLAG_KEYS`, `getFeatureFlags()` (batched,
  Redis-cached like `getNumber`, boolean-typed), boot-time validation for the 5 keys
  alongside the existing numeric one.
- `GET /platform-config/feature-flags` (public, unauthenticated) on the existing
  `platform-config.controller.ts`.
- New `admin/feature-flags.controller.ts`: `GET /admin/feature-flags`, `PATCH
  /admin/feature-flags` (admin-only, partial body, `@AuditAction` — confirm the exact
  decorator usage against how the numeric `/admin/config` PATCH already does it, match it
  exactly).
- Tests: `platform-config.service.spec.ts` extension, e2e for both new endpoints
  (unauthenticated read works, unauthenticated/non-admin write 401/403s, admin write
  persists + is audited).

## Slice 2 — Feature flags: enforcement

- Reviews: `POST /reviews` and salon-reply rejected (403, clear Persian message) while
  `feature_reviews_enabled=false`. Public salon read that surfaces rating/review list
  gated to return empty/omit while disabled.
- Stories/portfolio: public read endpoints (`GET /salons/:slug/stories`, `/portfolio`)
  return empty while their flag is disabled. Provider-panel management endpoints
  (`salons/mine/stories|portfolio`) stay unblocked — no backend change needed there.
- Referrals: `tryGrantReward` no-ops while `feature_referrals_enabled=false` (both the
  booking-completion hook and the hourly sweep). Registration-time referral tracking-row
  creation untouched.
- Coupons: `POST /coupons/validate` (and the redemption path inside booking creation)
  rejected while `feature_coupons_enabled=false`.
- Tests: one unit/e2e case per enforcement point above (flag off → the specific
  behavior is blocked/empty; flag on → unchanged from today).

## Slice 3 — Feature flags: frontend

- `useFeatureFlags()` composable in user-app (`app/composables/`) and provider-panel
  (`src/composables/`), each fetching the public endpoint once and exposing the 5 booleans
  reactively.
- Gate render sites: user-app's review section + submission CTA, story rings/viewer,
  portfolio section, referral/coupon UI at checkout and `/account/referral`.
- Provider-panel: stories/portfolio management pages show the "hidden from customers"
  banner when their flag is off (still fully functional otherwise).
- Admin-panel: new toggle-switch section (own page or a new section on `ConfigView.vue`,
  decide based on how it reads once `ConfigView.vue` is open) calling the new admin
  endpoint, following this app's existing toast/error conventions.
- Tests: component/composable tests per app for the gating logic; extend relevant existing
  `.spec.ts` files for the pages that gained a `v-if`.

## Slice 4 — Activity feed: backend

- New `activity/` module: `activity.module.ts`, `activity.controller.ts` (`GET
  /activity/mine?cursor=&limit=`, `AuthGuard` only), `activity.service.ts` implementing the
  4-source merge-and-paginate strategy from the spec.
- Tests: `activity.service.spec.ts` covering merge ordering across all 4 sources, cursor
  continuation, the exact-timestamp-tie edge case, empty-history case. e2e smoke test.

## Slice 5 — Activity feed: frontend

- `apps/user-app/app/pages/account/activity.vue`: "تاریخچه فعالیت من", cursor "بارگذاری
  بیشتر" pagination, per-type icon/rendering, links to booking/referral detail where they
  exist.
- Nav link from the account/profile page.
- Tests: `test/nuxt/` component test for the page (empty state, mixed-type rendering,
  load-more).

## Verification (every slice)

`pnpm --filter @gheychi/api typecheck && test`, `pnpm --filter @gheychi/user-app
typecheck && test`, `pnpm --filter @gheychi/admin-panel test`, `pnpm --filter
@gheychi/provider-panel test` as each slice touches those apps. Full `pnpm test`
(Turborepo, all apps) before considering the whole plan done. Manual check against the dev
stack for slice 3 (flip each flag, confirm the right UI disappears/reappears) and slice 5
(load the activity page with a seeded account that has bookings + wallet activity +
reviews + referral rewards).
