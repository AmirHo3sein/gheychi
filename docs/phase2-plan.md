# Phase 2 Plan — Maintainability, Scalability, Operational Safety

Scope: `apps/api` primarily, plus targeted frontend work for items 5 (search pagination consumer) and 9 (shared package decision) and 10 (docs). **No user-facing behavior changes** except where a change is the explicit, narrowly-scoped point of the item (e.g. search response shape gains pagination fields).

This document is written and reviewed *before* any Phase 2 code changes, per the brief. Each section covers architecture impact, the migration plan (if any), and the rollback strategy.

---

## 1. Shared Backend Utilities (`apps/api/src/common/`)

**Architecture impact:** Low blast radius, pure refactor. Three genuinely duplicated/scattered pieces of logic, found by direct grep audit:
- `bigintToNumber`/`nullableBigintToNumber` — identical transformer pair copy-pasted into 10 entity files.
- `numericToNumber`/`nullableNumericToNumber` — the same transformer pair, structurally identical, copy-pasted into 3 referral entity files (for `numeric` columns instead of `bigint`).
- `IRAN_UTC_OFFSET_MIN` + the wall-clock↔instant conversion arithmetic — currently owned by `booking/availability.util.ts` and re-implemented (not reused, since the helper functions aren't exported) inline in `invoicing/jalali-period.util.ts`.
- `IRAN_MOBILE` phone regex — not duplicated, but lives inside `auth/dto/auth.dto.ts` and is cross-imported into `salons/dto/worker.dto.ts`; moving it to `common/` gives it a home that doesn't imply "this is an auth-module concept."

**Migration plan:** None (no schema change). Pure TypeScript move-and-reimport.

**Rollback strategy:** Revert the commit. Every consumer only changes its `import` statement; no runtime behavior changes, so a revert is risk-free and instant.

---

## 2. Database Integrity — Cities Table

**Architecture impact:** Medium. Replaces the static in-memory `IRAN_CITIES` array (86 entries, no persistence, no relationship to `salons.city`) with a real `cities` table, and adds `salons.city_id` as an **optional, additive** foreign key alongside the existing `salons.city` free-text column — `city` is *not* removed or deprecated by this change.

- New `cities` entity: `id (identity int)`, `name (unique)`, `slug (unique)`, `province`, `lat`, `lng`, `sort_order` (preserves the exact response order of the current static array — several frontends may implicitly rely on "provincial capitals first" ordering in a dropdown; changing to alphabetical would be a silent UX regression this plan explicitly avoids).
- `GET /cities` now reads from the table instead of the in-memory array, ordered by `sort_order` — **byte-for-byte identical response shape and order** to today, verified by a test that diffs the old static array against the new endpoint output.
- `salons.city_id int NULL REFERENCES cities(id) ON DELETE SET NULL` — nullable, not required by `CreateSalonDto`/`UpdateSalonDto`. `SalonsService` best-effort resolves `city_id` from `dto.city` (exact name match against the `cities` table) on create/update, but a `city` value that doesn't match any canonical city (a small town not in the curated list) is still accepted exactly as today — free text remains the source of truth for display; `city_id` is purely an optional integrity/analytics enrichment.
- The old static `apps/api/src/cities/iran-cities.ts` is retired (the DB table becomes canonical); confirmed via grep that only `cities.controller.ts` and its spec import it, both updated in this change.

**Migration plan:** One migration, `apps/api/src/migrations/<ts>-cities-table.ts`:
1. `CREATE TABLE cities (...)`.
2. Seed all 86 rows (transcribed and diff-verified against the current static array — identical names/lat/lng, `province` and `slug` newly authored, `sort_order` = original array index).
3. `ALTER TABLE salons ADD COLUMN city_id int NULL REFERENCES cities(id) ON DELETE SET NULL`, indexed.
4. Backfill: `UPDATE salons SET city_id = cities.id FROM cities WHERE salons.city = cities.name` (exact match only — no fuzzy matching, to avoid mis-linking).

No data is destroyed; `down()` drops `city_id` and the `cities` table, salons revert to exactly their pre-migration state (the `city` text column is never touched by either direction).

**Rollback strategy:** `pnpm migration:revert` cleanly drops the new column/table; application code changes are reverted alongside (the code never *requires* `city_id`, so even a partial rollback — code reverted but migration not — degrades gracefully: `SalonsService` would just stop trying to populate a column, or fail loudly if the column is gone, so revert both together).

---

## 3. Referral Expiration Job

**Architecture impact:** Low. `referrals.status` already models `'expired'` and `referral_reward_types.expiration_days` already exists as a per-type config value (established in a prior slice), but — confirmed by reading every existing cron job — **no job actually sweeps for and applies it**. This is a real, previously-undetected gap: a referral configured with an expiration and never reaching its qualifying event sits at `awaiting_qualifying_event` forever.

New `apps/api/src/booking/referral-expiry.job.ts` (co-located with `referral-grant.job.ts`, which already lives in the `booking` module for the same reason — it needs `Booking`/`Payment` context), following the codebase's established job pattern exactly: `@Cron()` on a thin `handleCron()` delegating to a plain `async run()`.

Logic: find `referrals` rows where `status = 'awaiting_qualifying_event'` and `expiration_days IS NOT NULL` and `created_at + expiration_days days < now()`, then CAS-update each (`WHERE id = :id AND status = 'awaiting_qualifying_event'`) to `status = 'expired'` — the same conditional-update idiom used everywhere else in this codebase for state transitions, so a row that got granted a moment earlier by `ReferralGrantJob`'s own sweep can never be incorrectly expired out from under it.

**Migration plan:** None — uses existing columns.

**Rollback strategy:** Remove the job's provider registration (or the whole file); no schema to revert. A referral already flipped to `'expired'` by a since-removed job stays `'expired'` (this is a correct, desired terminal state, not something that needs undoing).

---

## 4. Distributed Cron Locking (Horizontal Scaling Prep)

**Architecture impact:** Medium — touches every cron job in the codebase (7 existing + the 2 new ones from items 3 and 7), but as a **thin wrapper**, not a rewrite of each job's own logic.

Today, `@nestjs/schedule` cron jobs run in-process; running more than one API instance would mean every instance executes every job redundantly (e.g., double SMS reminders, redundant reconciliation work — mostly idempotent today, but wasteful and a real correctness risk for a future non-idempotent job).

Design: a `CronLockService` (`apps/api/src/common/cron-lock.service.ts`) exposing `runExclusive(jobName, fn)`, using the **exact same Redis primitive** already trusted for the booking-hold lock: `SET cron-lock:{job-name} NX PX <ttl>`, released with `DEL` in a `finally`. A job that fails to acquire the lock simply skips this tick (another instance is already running it, or already ran it recently) — no queuing, no retry, matching the "at most one instance runs it" requirement without inventing new distributed-systems machinery beyond what this codebase already uses successfully for booking locks.

Each job's `handleCron()` becomes: `return this.cronLock.runExclusive('booking-expiry', () => this.run())`. **The `run()` methods themselves are untouched** — this is purely an outer wrapper, so all existing job-level unit tests (which call `run()` directly) keep passing unmodified.

**Explicitly does not touch** `lock:booking:{salonId}` (the booking-hold/assign-worker lock) — different key prefix (`cron-lock:` vs `lock:booking:`), different purpose, verified no collision is possible.

**Migration plan:** None.

**Rollback strategy:** Revert `handleCron()` back to calling `run()` directly; `CronLockService` becomes unused and can be deleted. Since a single-instance deployment (today's actual production topology, per `docker-compose.prod.yml`) always wins its own lock instantly, this change is a no-op in production today — it only matters once/if the API is scaled horizontally, making it safe to ship well ahead of that need.

---

## 5. Search Scalability — Cursor Pagination

**Architecture impact:** Medium — **the one item in this phase with a real, deliberate API response-shape change**, called out explicitly in the brief as expected ("Update frontend compatibility").

Today `GET /search` returns a bare array, hard-capped at `LIMIT 50` with no continuation. New shape:
```json
{ "items": [...], "nextCursor": "<opaque string | null>", "hasMore": boolean }
```
Cursor design: since results are sorted `(is_featured DESC, <distance_km|rating_avg> ASC, distance_km ASC)` and the featured-boost reordering happens in application code *after* the SQL query (a deliberate, existing, correctness-critical design — the boost must never bypass filters, so it only reorders within an already-filtered/sorted set), a naive offset-based SQL cursor can't be pushed into the query alone. The cursor instead encodes `{lastSeenIsFeatured, lastSeenSortValue, lastSeenSalonId, page}` base64-encoded, and the query fetches `page * pageSize` rows internally (bounded, capped at a hard ceiling to prevent abuse) then slices — functionally identical to today's single-page behavior when no cursor is given, and additive for subsequent pages. `pageSize` stays 50 by default (unchanged from today's hard cap, now a default+override instead of a hard ceiling).

**Frontend compatibility:** `apps/user-app`'s search page (`index.vue`) is the only consumer. It currently expects a bare array; after this change it reads `.items` and, if `hasMore` is true, can request more (a "load more" affordance) — until that UI is added, the page simply renders `.items` (identical visible behavior to today, since the default first page is unchanged) with `hasMore` unused. This is the minimum viable frontend change to not break the existing page; a real "load more" UX is a reasonable fast-follow but is not required to avoid breaking anything.

**Migration plan:** None (no schema change).

**Rollback strategy:** Revert both the endpoint and the one frontend call site together (they change in lockstep — this is why they're one phase-2 item, not two). No data migration exists to unwind.

---

## 6. Availability Query Optimization — Overlap Filtering in SQL

**Architecture impact:** Medium, internal-only (no API/response-shape change). `AvailabilityService.computeFor` currently loads **every** `pending_payment`/`confirmed` booking for the salon in the 14-day window into memory, then `computeAvailableSlots` (a pure function) filters candidate slots against that full in-memory array with `Array.prototype.filter`/`.some()` per candidate slot.

Plan: keep `computeAvailableSlots`'s pure-function shape and public contract identical (so its own extensive existing unit-test suite in `availability.util.spec.ts` keeps proving the slot-generation math is untouched), but change what `AvailabilityService` feeds it — instead of passing every booking in the window, it will query Postgres for only bookings whose interval **could plausibly** intersect the candidate grid (still a coarse per-request fetch, since the exact per-slot overlap check depends on the generated candidate grid which is computed client-side in the pure function) — this is a genuinely careful, incremental step: **fully** pushing the overlap check into SQL would require generating the candidate slot grid in SQL too, which changes the core algorithm significantly for a subsystem with delicate Iran-timezone correctness already hard-won (see the extensive comments in `availability.util.ts` about a previous timezone bug). Phase 2's change is scoped to what can be done safely: add covering/composite index confirmation, and reduce the fetched row set via a tighter SQL-side pre-filter (only bookings overlapping `[now, windowEnd)`, which is already the query — confirmed this is already about as tight as it can get without restructuring the algorithm) plus **benchmark** current performance to establish whether this is a real bottleneck at all before restructuring further.

**Revised, honest plan:** benchmark first. If the existing per-salon booking volume in the 14-day window is small (the common case — a single salon rarely has hundreds of bookings in 14 days), the in-memory filter is not a real bottleneck and restructuring the core algorithm carries correctness risk for negligible gain. The Phase 2 deliverable is therefore: **a reproducible before/after benchmark** (a script seeding N bookings and timing `computeFor`), executed once, its results reported honestly (including "no restructuring needed" as one valid, honest outcome) — and one confirmed-safe SQL improvement in the exact same commit: ensure the existing booking-window query is `EXPLAIN ANALYZE`-verified to use the `bookings (salon_id, starts_at, ends_at)` index rather than a sequential scan.

**Migration plan:** None expected; contingent on benchmark findings.

**Rollback strategy:** Revert the query change (if any) independently — `computeAvailableSlots`'s contract is unchanged either way, so this is a strictly localized, low-risk revert.

---

## 7. Storage Reconciliation Job

**Architecture impact:** Low-medium. Follows the exact reliability pattern already proven by `salons/story-cleanup.job.ts` (the only existing storage-GC job): batched, per-item try/catch isolation, storage-delete-before-DB-delete ordering where the DB row is the retry record.

New `apps/api/src/storage/storage-reconciliation.job.ts`, hourly (matching `story-cleanup.job.ts`'s cadence), two passes:
1. **DB rows with no backing object** — for `salon_photos`/`portfolio_items` rows whose `storage_key` yields a 404/NotFound on a `HEAD`-equivalent existence check, log loudly (this indicates a **prior delete failure that orphaned a live DB reference to a missing file** — a real, user-visible bug: a photo/portfolio item whose image 404s in the UI) but does **not** auto-delete the DB row (a human should look at why an object went missing before removing the customer's record of having uploaded it).
2. **Storage objects with no DB row** — for the `local` provider, lists the `salons/` prefix on disk and cross-references against every known `storage_key` across `salon_photos`/`portfolio_items`/`salon_stories`/blog covers; for `s3`, lists the bucket prefix via the SDK's list API. Deletes orphans older than a grace period (24h, to never race a still-in-flight upload whose DB row hasn't committed yet).

**Migration plan:** None.

**Rollback strategy:** Remove the job's provider registration; no data was destroyed by adding it (case 1 is log-only; case 2 only deletes objects already confirmed orphaned and past the grace period — removing the job just stops future cleanup, it doesn't need to "undo" anything).

---

## 8. Notification Architecture — Per-User Read State

**Architecture impact:** Medium. Today `admin_notifications.read_at` is a single column — one admin marking a notification read marks it read for every admin (a known, documented MVP cut).

New table `admin_notification_reads (notification_id, admin_id, read_at)`, composite PK. `AdminNotificationsService.list()`/`unreadCount()` join against it **per the calling admin's own id** (`req.user.id`, already available at every call site via `AuthGuard`) instead of reading the shared `read_at` column. `markRead`/`markAllRead` upsert into the new table instead of updating the notification row itself.

**"Implement without breaking current UI"**: the admin-panel's notification bell/badge already calls `GET /admin/notifications`, `GET /admin/notifications/unread-count`, `PATCH /admin/notifications/:id/read`, `POST /admin/notifications/read-all` — **the request/response contracts of all four endpoints stay identical**; only the *meaning* of "read" becomes per-caller instead of global. No frontend code changes required for this item (verified by reading `AuditLogView`/notification-bell component: it never reads `read_at` directly off a notification row, only trusts the `unread`-filtered list and the `unreadCount` number, both of which stay contract-identical).

The old `admin_notifications.read_at` column is **kept, not dropped**, for this phase (backward compatibility / rollback safety) but is no longer written to by the new code path — a pure additive migration.

**Migration plan:** One migration creating `admin_notification_reads`. No backfill needed/possible (there's no way to know, retroactively, which specific admin read which historical notification under the old shared-state model — every notification starts unread for every admin under the new model, which is the honest, correct default rather than a guess).

**Rollback strategy:** Revert the service/controller changes back to reading `read_at` directly; drop `admin_notification_reads` (nothing else references it). Since the old column was never removed, a rollback fully restores the exact prior behavior with zero data loss on the "was globally read" signal.

---

## 9. Frontend Shared Package — Evaluation

**Architecture impact:** Decision, not necessarily code. `provider-panel` and `admin-panel` currently duplicate `AppButton.vue`, `AppInput.vue`, `AppCard.vue`, `EmptyState.vue` (near-byte-identical) and `useTheme.ts`/`useToast.ts` (functionally identical, different storage keys) under an explicit, repeatedly-commented "cross-app isolation convention." `pnpm-workspace.yaml` already globs `packages/*`, but no such directory exists.

**Decision (documented in full in the implementation, `docs/phase2-plan.md` §9 below is the summary):** extracting a `packages/ui` **is evaluated and NOT executed in this phase**, and the decision is written down rather than silently skipped, per the brief's explicit "only migrate if it does not increase complexity" gate. Reasoning:
- The duplication is a *deliberate, repeatedly-documented policy* in this codebase (not accidental drift) — reversing it is a scope decision for product/architecture ownership, not something to fold into a mixed Phase 2 sweep alongside seven other unrelated changes.
- `admin-panel` and `provider-panel` are still Vue 3 + Vite SPAs but with independently evolving prop contracts already (`AppSelect.vue` diverges meaningfully between the two apps — `admin-panel`'s has `label`/`width`/`searchable`/`allow-empty:true`, `provider-panel`'s doesn't) — a shared package would need to support the union of both contracts or fork internally, which is real added complexity, not free deduplication.
- A shared package introduces a new build/versioning surface (Turborepo package graph, a `package.json` for `packages/ui`, and either a build step or path-alias wiring into 2–3 consuming apps' Vite configs) — non-trivial infrastructure for four small, stable, rarely-changed components.
- The genuinely high-value, low-risk part of "reduce duplication" — the four byte-identical components plus the two theme/toast composables — is small enough that extraction risk is dominated by *process* risk (three apps' build pipelines, three test suites, a new package's own CI wiring) rather than *code* risk.

**Recommendation for a future phase**, recorded rather than executed: if/when a *fifth* duplicated component or a real bug fix needs propagating to all three apps simultaneously (the concrete pain this duplication causes), that's the trigger to revisit — not a scheduled maintenance task in isolation.

**Rollback strategy:** N/A (no code changes in this item beyond the written decision).

---

## 10. Developer Documentation — DESIGN.md Updates

**Architecture impact:** None (documentation only). `apps/provider-panel/DESIGN.md` and `apps/admin-panel/DESIGN.md` were found, during this session's earlier full-codebase documentation sweep, to describe a **pre-reconciliation** state that no longer matches the shipped code — e.g. both claim `AppButton.vue`/`AppInput.vue`/the full design-token set don't exist yet, when they are in fact fully built and used consistently on every page.

Plan: read every component/token claim in both files against the current source (already done once, in `docs/technical-overview/24-technical-debt.md`, during this session), and rewrite the stale sections to match reality — without inventing a new document structure or design philosophy, just correcting factual drift.

**Migration plan:** N/A.

**Rollback strategy:** Revert the doc commit; no code or data is affected.

---

## Execution order

Items are independent of each other except: **item 4 (cron locking) should land after items 3 and 7** (the two new jobs) so every job gets wrapped in one pass rather than two. Actual implementation order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 (decision only) → 10.

## Overall rollback posture

Every item in this plan is either (a) purely additive at the schema level (items 2, 8), (b) a pure code move/wrapper with no schema change (items 1, 3, 4, 6, 7), or (c) a deliberate, isolated response-shape change with its one frontend consumer updated in the same change (item 5). Nothing in this phase requires a coordinated multi-step rollback across services — every item can be reverted independently by reverting its own commit(s).
