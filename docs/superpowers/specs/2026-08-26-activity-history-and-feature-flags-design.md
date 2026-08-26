# Customer Activity History + Platform Feature Flags — Design

**Date:** 2026-08-26
**Status:** Approved — referrals and coupons ship as two separate flags (see below), not one bundled flag.

## Problem

Two independent asks from the product owner:

1. A customer currently has no single place to see everything they've done on the
   platform. Bookings, wallet transactions, reviews, and referral rewards each have their
   own page (`/bookings`, `/account/wallet`, inline in bookings, `/account/referral`) with
   no unified, detailed timeline.
2. An admin has no way to disable a whole feature platform-wide (e.g. reviews, stories) as
   an operational kill switch — every feature (reviews, stories, portfolio, referrals,
   coupons) always renders unconditionally today, with no flag anywhere in the codebase.

Both are scoped per the product owner's own choices: history = a **read-only aggregation
of existing data** (bookings, wallet transactions, reviews, referral rewards — no new
write path, no login/profile-edit tracking); feature flags = **global platform-wide
switches** (not per-salon) covering **reviews/comments, stories, portfolio, and
referrals+coupons**.

## Part A — Customer "My Activity" timeline

### Data model

No new table. Reads four existing tables, each already scoped to the caller:

| Source | Table | User FK | Time field | Existing endpoint |
|---|---|---|---|---|
| Booking | `bookings` | `user_id` | `created_at` | `GET /bookings/mine` |
| Wallet transaction | `wallet_transactions` | `user_id` | `created_at` | `GET /wallet/mine/transactions` |
| Review | `reviews` | `user_id` | `created_at` | `GET /reviews/mine` |
| Referral reward | `referral_rewards` | `beneficiary_user_id` (the one outlier — not `user_id`) | `granted_at` | `GET /referrals/mine/rewards` |

**Known gap, accepted as-is:** `bookings` has no `cancelled_at`/`updated_at` column — a
cancelled booking's only timestamp is its original `created_at`. The activity feed will
show a cancelled booking at its *creation* time with `status: 'cancelled_by_user'` in the
detail payload, not at cancellation time. Adding a real `cancelled_at` column is out of
scope here (a separate, small follow-up if the ordering-by-cancellation-time gap matters
later).

### API — `GET /activity/mine?cursor=&limit=`

New module `apps/api/src/activity/` (`activity.module.ts`, `activity.controller.ts`,
`activity.service.ts`) — cross-domain aggregation is real business logic, not simple CRUD,
so per `CLAUDE.md`'s module convention this gets a real service, not a bare-repository
controller.

**`ActivityController`**, `AuthGuard` only (no salon-ownership requirement — this is every
authenticated user's own history, provider or customer alike; a provider account is also a
customer per the domain model and should see their own bookings/reviews too).

**Merge strategy** (deliberately simple, not a true cross-table keyset cursor): fetch the
top `limit` rows from *each* of the 4 source tables (`WHERE userFk = :userId AND timeCol <
:cursorTs ORDER BY timeCol DESC LIMIT :limit`), merge the ≤4×`limit` rows in memory, sort
combined `DESC` by their time field, slice to `limit`, and set `nextCursor` to the last
returned item's ISO timestamp (`null` when fewer than `limit` rows came back — no more
pages). This can rarely skip/duplicate a row on an exact-timestamp tie across two
different sources at a page boundary — accepted given per-user row counts are realistically
in the dozens-to-low-hundreds, not a scale where that matters. A real composite keyset
cursor across 4 heterogeneously-shaped tables would be meaningfully more code for no
practical benefit at this scale.

Response shape follows the existing `{ items, nextCursor, hasMore }` convention
(`search.service.ts`'s own cursor shape) rather than inventing a new one:

```ts
interface ActivityItem {
  type: 'booking' | 'wallet_transaction' | 'review' | 'referral_reward';
  id: string;
  occurredAt: string; // ISO
  detail: BookingActivityDetail | WalletActivityDetail | ReviewActivityDetail | ReferralActivityDetail;
}
```

- **Booking detail**: reuse `BookingsService`'s existing `attachNames` enrichment (salon
  name, service name, worker name) rather than re-deriving it — `{ status, source,
  salonName, serviceName, workerName, startsAt, priceSnapshot }`.
- **Wallet detail**: `{ type, amount, balanceAfter, reason }` straight from
  `WalletTransaction`.
- **Review detail**: `MyReviewListItem` today has no salon/service name joined in (only
  `bookingId`). Add a `LEFT JOIN salons`/`bookings` in the activity query specifically for
  this (on `review.salon_id` for salon name, `review.booking_id` for service name) — the
  existing `/reviews/mine` endpoint itself is untouched, this join is local to
  `ActivityService`. `{ rating, comment, status, salonName, serviceName }`.
- **Referral reward detail**: already rich via the existing `getMyRewards` query — reuse
  as-is: `{ beneficiaryRole, rewardKind, rewardValue, status, couponCode, couponSalonName }`.

### Frontend — `apps/user-app/app/pages/account/activity.vue`

New page, "تاریخچه فعالیت من", linked from the account/profile nav. Cursor-based "بارگذاری
بیشتر" (load more) button (not infinite scroll — matches this app's existing list-page
convention elsewhere rather than adding new IntersectionObserver machinery). Each item
renders with a type-specific icon/color and links to its detail page where one exists
(booking → `/bookings/[id]`; review → the same booking page; referral reward → `/account/
referral`; wallet transaction has no detail page, renders inline only).

## Part B — Platform feature flags

### Data model

Reuses the existing `platform_config` table (`{key, value: jsonb}`) — already
boolean-capable at the storage layer (`PlatformConfigService.set()` already accepts
`boolean`). **Does not** reuse `REQUIRED_PLATFORM_CONFIG_KEYS`/`getNumber()`, since that
path's `describeInvalidConfigValue` coerces via `Number(rawValue)` — silently valid-but-wrong
for a boolean (`Number(true) === 1` would pass numeric bounds checks without actually
validating it's a boolean). New, parallel, boolean-specific list and getter instead:

```ts
export const FEATURE_FLAG_KEYS = [
  'feature_reviews_enabled',
  'feature_stories_enabled',
  'feature_portfolio_enabled',
  'feature_referrals_enabled',
  'feature_coupons_enabled',
] as const;
```

Split into two flags rather than one bundled "referrals+coupons" switch — a salon owner's
own promotional coupon codes share the same `coupons` table as referral-issued ones with
no `source` discriminator, so one flag would have silently disabled a salon's own coupons
whenever an admin only meant to pause the referral program (or vice versa). Kept separate
so each does exactly what its name says.

Migration seeds all five to `true` — preserves current behavior exactly until an admin
explicitly flips one off. `PlatformConfigService` gains `getFeatureFlags()` (mirrors
`getNumber`'s Redis-cache-with-DB-fallback pattern, one batched read instead of 4 separate
round trips) and a boot-time check alongside the existing numeric one, so a missing/
malformed flag row fails deploy the same way a missing numeric key already does.

### API

- **`GET /platform-config/feature-flags`** — public, unauthenticated, same precedent as
  the existing `GET /platform-config/booking-terms`. Returns the 5 booleans. Consumed by
  user-app and provider-panel.
- **`GET/PATCH /admin/feature-flags`** — admin-only (`@Roles('admin')`), deliberately
  **separate** from the existing numeric `/admin/config` endpoint rather than overloading
  it — different validation shape (booleans, not bounded numbers), different admin UI
  (toggle switches, not number inputs). `PATCH` body is a partial `{ reviewsEnabled?,
  storiesEnabled?, portfolioEnabled?, referralsEnabled?, couponsEnabled? }`. Should be wired through
  the existing `@AuditAction` interceptor, same as every other admin mutation — worth
  confirming during planning whether the current numeric config PATCH already does this,
  so the new endpoint matches it exactly rather than guessing.
- **Admin-panel management UI is never gated by these flags** — an admin can always see
  and moderate existing reviews/stories/portfolio/coupons regardless of the customer-facing
  flag. The flag only controls what customers and, per below, providers see.

### Enforcement — deliberately asymmetric by feature, not uniform

A flag being off always hides the customer-facing UI. Whether it also blocks *writes*
differs by feature, for a reason worth stating explicitly rather than applying one uniform
rule:

- **Reviews**: blocks writes too (`POST /reviews`, salon-reply) while off, and hides the
  entire reviews surface including a salon's aggregate rating badge (showing a rating
  derived from currently-hidden comments would look broken). Rationale: reviews are a
  trust signal; letting them silently accumulate while hidden would dump a surprise
  backlog on customers the moment the flag is re-enabled.
- **Stories / portfolio**: does **not** block provider-panel writes — an owner can keep
  managing stories/portfolio while the flag is off, provider-panel shows a persistent
  banner ("این ویژگی موقتاً برای مشتریان غیرفعال است") so they know why nothing shows up
  publicly. Rationale: this is curated content an owner actively manages; blocking it while
  hidden would just be friction with no safety benefit, unlike reviews.
  Public reads (`GET /salons/:slug` review list/rating, wherever that lives) also return
  empty/omit the rating while disabled — hiding is enforced server-side, not just via a
  frontend `v-if`, so a direct API call can't see what's supposed to be hidden either.
- **Stories / portfolio**: does **not** block provider-panel writes — an owner can keep
  managing stories/portfolio while the flag is off, provider-panel shows a persistent
  banner ("این ویژگی موقتاً برای مشتریان غیرفعال است") so they know why nothing shows up
  publicly. Rationale: this is curated content an owner actively manages; blocking it while
  hidden would just be friction with no safety benefit, unlike reviews. The **public read**
  endpoints (`GET /salons/:slug/stories`, `/portfolio`) DO get gated server-side though —
  same "hidden means actually hidden, not just un-rendered" principle as reviews, just
  without the write-blocking part.
- **Referrals** (`feature_referrals_enabled`): the reward-*granting* step
  (`tryGrantReward`, the hourly sweep + booking-completion hook) simply skips while
  disabled — a referral sitting in `awaiting_qualifying_event` stays there and is evaluated
  again once re-enabled, so nothing is lost, only delayed. Referral-code capture at
  registration still records the tracking row (harmless, no grant happens) rather than
  adding a new registration failure mode over an unrelated flag. `GET /referrals/mine/*`
  keeps working (a user can still see rewards already granted) — only new invitations/
  grants pause.
- **Coupons** (`feature_coupons_enabled`): `POST /coupons/validate` (and redemption inside
  booking creation) is blocked while disabled — for every coupon, provider-issued or
  referral-issued alike, since this flag now covers coupons as their own concern
  independent of the referral program.

## Files (representative)

**Backend**: `activity/activity.module.ts`, `activity.controller.ts`, `activity.service.ts`
(new module); `platform-config/platform-config.service.ts` (new `FEATURE_FLAG_KEYS` +
`getFeatureFlags()`); `platform-config/platform-config.controller.ts` (new public route);
new `admin/feature-flags.controller.ts`; one migration seeding the 5 flag rows; enforcement
touches `reviews.service.ts` (write block + public read gating), `salons/mine/stories|
portfolio` controllers' public-read counterparts (read gating only, writes stay open),
`referrals.service.ts`'s `tryGrantReward`, `coupons` validate/redeem path.

**Frontend**: `apps/user-app/app/pages/account/activity.vue` (new); a small
`useFeatureFlags()` composable (user-app + provider-panel) wrapping the public endpoint,
consumed at each gated render site (review sections, story rings, portfolio section,
referral/coupon UI); `apps/admin-panel/src/pages/ConfigView.vue` gains a new "ویژگی‌ها"
toggle-switch section (or a new dedicated page, TBD during planning) calling the new
admin endpoint.

## Verification

- `pnpm typecheck` + full `jest`/`vitest` suites, same bar as every change this session.
- New tests: `activity.service.spec.ts` (merge/pagination correctness across all 4
  sources, including the exact-timestamp-tie edge case called out above),
  `platform-config.service.spec.ts` extension for `getFeatureFlags()`/boot validation,
  e2e coverage for both new endpoints and for at least one enforcement path per feature
  (e.g. `POST /reviews` returns 403 while `feature_reviews_enabled=false`).
- Manual check against the dev stack: flip each flag off via the new admin UI, confirm the
  corresponding user-app/provider-panel surface disappears (or shows the provider banner)
  without a page error, then flip back on and confirm it returns.
