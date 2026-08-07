# 24 — Technical Debt

Findings that look **unintentional** — drift, duplication, inconsistency, or a gap not documented anywhere as a deliberate cut — as distinct from [23-known-limitations.md](./23-known-limitations.md), which catalogues intentional scope cuts. Each entry names the file(s) involved so it can be picked up as a concrete follow-up task.

## Backend

### Duplicated `bigintToNumber` transformer
The same TypeORM `bigint`→`number` transformer is copy-pasted independently into **10 entity files** (`booking/payment.entity.ts`, `booking/booking.entity.ts`, `coupons/coupon-redemption.entity.ts`, `salons/salon-service.entity.ts`, `wallet/wallet-transaction.entity.ts`, `wallet/wallet-balance.entity.ts`, and all four `invoicing/*.entity.ts` files) rather than shared from one utility. Low-risk (identical logic everywhere) but a real, quantifiable duplication — and there is nowhere to put a shared utility today, since `pnpm-workspace.yaml`'s `packages/*` glob has no corresponding directory. See [04-database.md](./04-database.md).

### Duplicated worker-eligibility SQL
The exact same opt-out predicate is hand-written independently in `BookingsService.createHold`, `AvailabilityService.computeFor`, and `PublicSalonContentController.listWorkers`. A future eligibility-rule change requires touching all three in sync, with nothing enforcing that they stay consistent. See [09-booking-engine.md](./09-booking-engine.md).

### Admin salon mutations bypass the service layer
`approve/reject/suspend/setFeatured` are raw TypeORM repository calls embedded directly in `AdminSalonsController`, unlike every owner-facing salon mutation, which goes through `SalonsService` with proper transaction/validation-helper structure. The "can't approve a suspended owner's salon" business rule lives in the controller, making it harder to unit-test in isolation and structurally inconsistent with the rest of the domain. See [08-admin-panel.md](./08-admin-panel.md).

### `assignWorker` has no overlap re-check
Reassigning a worker to an existing booking doesn't re-verify that worker isn't already booked elsewhere at that slot — the one gap in an otherwise carefully double-checked booking system. See [09-booking-engine.md](./09-booking-engine.md).

### `PlatformConfigService`'s numeric getter throws an unguarded raw `Error`
Not a NestJS exception — a missing/deleted `platform_config` key would 500 every request path that needs it (deposit, commission, cancellation window, hold TTL, reminder lead time, review edit window), with no schema validation anywhere to catch a bad config state before it's hit in production. See [20-business-rules.md](./20-business-rules.md).

### `payment_authorities` has no TypeORM entity
The only table in the schema accessed exclusively via raw SQL — a deliberate simplicity tradeoff per its own code comment, but it means zero type-safety or migration-tooling coverage for that table beyond the three call sites that touch it. See [04-database.md](./04-database.md).

### `salons.city` (the free-text source of truth) still has no referential integrity of its own
`salons.city_id` was added as a real, indexed FK to `cities(id)` (`1754300000000-cities-table.ts`) and is best-effort-populated on create/update via an exact-name match — but it's deliberately nullable and never enforced, so `salons.city` itself (the actual source of truth for a salon's address, per that migration's own comment) remains free text with no validation against the canonical list. A typo'd or non-canonical city name still saves fine, just with `city_id` left `NULL` rather than being rejected — city-name drift/typos on the free-text column are still possible and unguarded. See [04-database.md](./04-database.md).

### Slug generation degrades badly for Persian-only names
`makeSlug()` strips to `[a-z0-9]` only; a salon (or blog post) named entirely in Persian — very likely the dominant case for an Iranian marketplace — produces an opaque `salon-<8hex>`/`post-<8hex>` slug with zero relation to the actual name. No transliteration step exists. Real SEO/UX cost, not just a cosmetic issue.

### Admin salon queue is alphabetical, not chronological
`GET /admin/salons` (default `status=pending`) orders by `salon.name ASC`, not `createdAt` — moderators don't see oldest-first without manually re-sorting, and there's no `createdAt` sort option exposed in the query DTO at all.

### Favorites return unfiltered salon status
`GET /favorites` has no status filter — a favorited-then-suspended salon is still fully returned, inconsistent with the platform's otherwise-consistent "approved-only" public-visibility convention.

### Weekly hours have no intra-day overlap validation
`ReplaceHoursDto` only checks `openTime < closeTime` per row — nothing prevents two conflicting ranges submitted for the same weekday in one request.

### Blog cover-set/cover-clear share one audit action name
Both `uploadCover` and `removeCover` are tagged `@AuditAction('post.cover.set', 'post')` — the audit log can't distinguish which happened by action name alone.

### `audit-wiring.spec.ts` doesn't cover every audited handler
`AdminWorkerRatingsController.moderate` is correctly wired (`@AuditAction` + `AuditInterceptor`) but absent from the pinning test's coverage table — a regression there wouldn't be caught by this particular safety net.

## Frontend

### `useApi.ts`'s error-message handling diverges between provider-panel and admin-panel
provider-panel guards against NestJS's English `class-validator` array messages leaking into Persian-only toasts (`normalizeApiMessage()`); admin-panel has no such guard.

### City-list source of truth diverges silently
provider-panel fetches the live, canonical `GET /cities`; admin-panel hardcodes its own static duplicate array (`utils/cities.ts`). If the backend list is ever edited, admin-panel's filters silently drift out of sync with no build-time or runtime signal.

### Extensive component/composable duplication with no shared package
`AppButton.vue`, `AppCard.vue`, `AppInput.vue`, `EmptyState.vue` are near/byte-identical duplicates across provider-panel and admin-panel; `useTheme.ts`, `useToast.ts`, phone-digit-normalization helpers, and the `.app-select` vue-multiselect CSS override block are functionally-identical duplicates across all three frontends. Each is covered by an explicit "cross-app isolation convention" comment — an intentional policy, but a real, unenforced maintenance cost: a fix to `AppInput`'s focus-ring behavior, for instance, has to be manually propagated to 2–3 separate files with nothing checking that it was.

### Minor dependency-pinning inconsistencies
`vue-multiselect` and `@lucide/vue` are pinned exact in provider-panel but caret-ranged in admin-panel. `vue-multiselect`'s CSS is imported globally in admin-panel's `main.ts` but locally per-component in provider-panel.

### `/admin/featured` lives inside `user-app`, not `admin-panel`
A full admin tool (toggle a salon's featured flag) ships inside the customer-facing PWA's bundle and route surface, guarded correctly but architecturally misplaced given a dedicated admin app exists. See [06-user-panel.md](./06-user-panel.md).

### `user-app`'s `nuxt typecheck` has two carved-out workarounds
A dual-Vite version mismatch (Nuxt 4.4→Vite 7 vs. Vitest 3.2→Vite 6) breaks `vue-tsc`'s structural typing for two spots specifically: the `vite.plugins` array (needs a hand-written type cast) and the two sitemap Nitro handlers (must import `h3` directly rather than the module's own typed `defineSitemapEventHandler`, since the single non-composite `vue-tsc` pass resolves `#imports` against the wrong (app-side) program). Both are documented as "remove once X" — meaning `nuxt typecheck` is not fully trustworthy in these two spots today.

### Coupon-rejection detection via string matching
`booking/[slug]/[serviceId].vue`'s `mentionsCoupon()` decides whether a booking-submit failure was coupon-related by checking whether the API's error message contains the literal Persian substring "کد تخفیف" — self-documented in code as fragile ("an error code on the response body would make this robust"). Any future rewording of that API error copy silently breaks this UX path.

### `ReportForm.vue` (user-app) is a confirmed design-system violation
Hand-rolls a raw `<textarea>`/`<button>` instead of composing `BaseInput`/`BaseButton`. (`BaseSelect.vue`'s chevron — previously flagged here too, a hardcoded light-mode-only hex color via physical `left` positioning — has since been fixed: it's now a proper `.base-select-chevron`/`.dark .base-select-chevron` CSS class pair using the current token value, with a working dark-mode variant.)

### Push notifications never deep-link
`sw.ts`'s `notificationclick` handler always opens `/bookings`, never the specific booking the notification was about.

## How to use this document

Every item here is a legitimate, scoped candidate for a future cleanup ticket. None are urgent — the codebase is unusually well-commented and the underlying functionality works correctly in every case found. Prioritize by blast radius: the duplicated worker-eligibility SQL and the city-list source-of-truth divergence (provider-panel live-fetches, admin-panel hardcodes a duplicate) are the two most likely to actively mislead a future engineer or silently drift into a real bug.

## Related documents

- [23-known-limitations.md](./23-known-limitations.md) — the deliberate counterpart to this list
- [25-future-improvements.md](./25-future-improvements.md) — where some of these gaps already have a reserved seam to grow into
