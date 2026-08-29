# 24 — Technical Debt

Findings that look **unintentional** — drift, duplication, inconsistency, or a gap not documented anywhere as a deliberate cut — as distinct from [23-known-limitations.md](./23-known-limitations.md), which catalogues intentional scope cuts. Each entry names the file(s) involved so it can be picked up as a concrete follow-up task.

## Backend

### `payment_authorities` has no TypeORM entity — evaluated, raw SQL confirmed correct
The only table in the schema accessed exclusively via raw SQL. Re-evaluated (2026-08-10) against all three call sites: an entity would add module-registration ceremony without a real gain. The write, `BookingsService.createPaymentSession`, is a single `INSERT ... SELECT id FROM payments WHERE booking_id = $1 ... ON CONFLICT (authority) DO NOTHING` fired in the same transaction as the `payments.authority` update, deriving `payment_id` from `booking_id` in one round trip — a repository `.create()`/`.insert()` would need the actual `payment_id` already in hand, forcing either an extra lookup query or leaving this one call site on raw SQL anyway (mixed entity/raw usage on the same table, not less ceremony). The two reads, `PaymentsService.resolveByAuthority` and `PaymentReconciliationJob.loadAuthorities`, are single-column, key-based lookups (`WHERE authority = $1` / `WHERE payment_id = $1 ORDER BY created_at DESC`) already returning simply-shaped rows, so a repository buys no meaningful type-safety over what's there today. No code changes made. See [04-database.md](./04-database.md).

### `salons.city` (the free-text source of truth) still has no referential integrity of its own
`salons.city_id` was added as a real, indexed FK to `cities(id)` (`1754300000000-cities-table.ts`) and is best-effort-populated on create/update via an exact-name match — but it's deliberately nullable and never enforced, so `salons.city` itself (the actual source of truth for a salon's address, per that migration's own comment) remains free text with no validation against the canonical list. A typo'd or non-canonical city name still saves fine, just with `city_id` left `NULL` rather than being rejected — city-name drift/typos on the free-text column are still possible and unguarded. See [04-database.md](./04-database.md).

## Frontend

### Extensive component/composable duplication with no shared package
`AppButton.vue`, `AppCard.vue`, `AppInput.vue`, `EmptyState.vue` are near/byte-identical duplicates across provider-panel and admin-panel; `useTheme.ts`, `useToast.ts`, phone-digit-normalization helpers, and the `.app-select` vue-multiselect CSS override block are functionally-identical duplicates across all three frontends. Each is covered by an explicit "cross-app isolation convention" comment — an intentional policy, but a real, unenforced maintenance cost: a fix to `AppInput`'s focus-ring behavior, for instance, has to be manually propagated to 2–3 separate files with nothing checking that it was.

### `user-app`'s `nuxt typecheck` has one carved-out workaround
A dual-Vite version mismatch (Nuxt 4.4→Vite 7 vs. Vitest 3.2→Vite 6) breaks `vue-tsc`'s structural typing for the `vite.plugins` array specifically (needs a hand-written type cast) — documented as "remove once X" in `nuxt.config.ts`, meaning `nuxt typecheck` is not fully trustworthy in that one spot today. The second carve-out that used to live here (the sitemap Nitro handlers needing `h3` imported directly instead of `@nuxtjs/sitemap`'s typed `defineSitemapEventHandler`, since the single non-composite `vue-tsc` pass resolved `#imports` against the wrong program) no longer applies: the multi-file sitemap rework dropped `@nuxtjs/sitemap` entirely in favor of hand-rolled routes/handlers (`server/routes/sitemap*.ts`, `server/handlers/sitemap-*-page.ts`), which still import `defineEventHandler` from `h3` directly as a defensive habit but no longer depend on the module's virtual `#imports` at all.

### `ReportForm.vue` (user-app) is a partial design-system violation — submit button fixed, textarea/close-button deliberately left
The submit action now composes `BaseButton` rather than a raw `<button>`. The raw `<textarea>` and the plain `<button>` used as the dialog's close affordance remain hand-rolled: there is no `BaseTextarea` anywhere in user-app to compose instead, and the close-button idiom (a bare `<button>` next to a dialog's primary action) is repeated identically in other dialog components (`StoryViewer.client.vue`, `ReviewPromptModal.vue`), so fixing it here alone wouldn't remove the pattern from the codebase. (`BaseSelect.vue`'s chevron — previously flagged here too, a hardcoded light-mode-only hex color via physical `left` positioning — has since been fixed: it's now a proper `.base-select-chevron`/`.dark .base-select-chevron` CSS class pair using the current token value, with a working dark-mode variant.)

## How to use this document

Every item here is a legitimate, scoped candidate for a future cleanup ticket. None are urgent — the codebase is unusually well-commented and the underlying functionality works correctly in every case found.

## Related documents

- [23-known-limitations.md](./23-known-limitations.md) — the deliberate counterpart to this list
- [25-future-improvements.md](./25-future-improvements.md) — where some of these gaps already have a reserved seam to grow into

## Resolved by the booking-approval workflow

- **The blocking-status list was duplicated at six call sites.** Now one exported
  `SLOT_BLOCKING_STATUSES` constant. This had to be fixed before `pending_approval` could exist:
  updating five of six sites by hand would have produced a silent, intermittent double-booking
  bug rather than a test failure.
- **Hold deadlines were recomputed from live config on every expiry tick.** Editing
  `booking_hold_ttl_minutes` silently moved the deadline of every in-flight hold. New bookings
  now snapshot `payment_expires_at` at creation; the old derivation survives only as the
  fallback arm for rows predating the column.
- **`BookingExpiryJob` never told the customer anything** when their hold died. It now sends a
  post-commit, best-effort notification.

## Introduced, and accepted

- The two booking-status label maps still diverge in wording across user-app and provider-panel
  (pre-existing), and the new statuses were added to each in that app's own voice rather than
  unifying them.

## Resolved: `approve()` now re-checks availability

Was listed here as an accepted gap; it is a correctness requirement instead. `approve()` replays
`createHold`'s own capacity and worker-availability checks (this booking's own row excluded)
inside the same per-salon Redis lock, and auto-expires the request on the spot if the slot no
longer fits rather than opening a payment window for one that doesn't. See
[28-booking-approval-workflow.md](./28-booking-approval-workflow.md).
