# Phase 1 Audit — Correctness, Security & Data-Integrity Fixes

Scope: `apps/api` (backend) plus one small `apps/admin-panel` label-mapping fix required by an audit-log action rename. No business behavior changed except where the change *is* the bug fix. No unrelated refactors.

This document records what was found, what was fixed, the files touched, and the risk level of each item, per the Phase 1 brief. It is written to be read standalone by someone who wasn't in the room for the investigation.

---

## 1. Authorization Safety

**Risk level: High (if a gap had been found) — audit result: no active gap found; regression-tested.**

### Audit method
Read every `*.controller.ts` under `apps/api/src` (48 files) and recorded, for each route handler, whether it carries a class-level or method-level `@UseGuards(...)`. Cross-referenced every guard-less route against what it actually does (public salon/blog/search content, login, health, payment callback) to confirm each is *intentionally* public.

### Finding
**Every currently-existing route already has an appropriate guard**, or is on the deliberate public list: `auth/request-otp`, `auth/verify-otp`, `GET availability`, `payments/callback`, `GET /categories`, `GET /cities`, public blog endpoints, `GET /platform-config/booking-terms`, `GET /referrals/validate` (separately IP-rate-limited), public salon-review/salon-content/search endpoints, and both sitemap endpoints.

The *architectural* risk described in the brief is real, though: there is no global `AuthGuard`, so a new route added without an explicit `@UseGuards(...)` is public by default with no automated signal.

### Fix
Added `apps/api/src/route-guard-audit.spec.ts` — a Jest unit test that reflects over every controller class (via `Reflect.getMetadata` on Nest's own `__guards__`/`path` metadata keys, the same technique already used by `audit/audit-wiring.spec.ts`) and asserts every route handler is either guarded or present on an explicit, reviewable `PUBLIC_ROUTES` allowlist. Verified the test actually catches a regression by temporarily removing `WalletController`'s guard and confirming the test fails with a clear diff, then restoring it.

**Files:** `apps/api/src/route-guard-audit.spec.ts` (new).

---

## 2. Admin Salon Service Layer Violation

**Risk level: Medium** (maintainability/testability gap, not a live bug).

### Finding
`AdminSalonsController.setStatus`/`setFeatured` ran raw `Repository<Salon>` calls, including the "can't approve a salon whose owner is suspended" business rule, directly in the HTTP handler — the only mutation path in the `salons` domain that bypassed `SalonsService`.

### Fix
Moved `setStatus()` and `setFeatured()` into `SalonsService` verbatim (same logic, same Persian error messages, same `suspendedCause` bookkeeping). The controller now only receives the request and delegates.

**Files:**
- `apps/api/src/salons/salons.service.ts` — added `setStatus()`, `setFeatured()`.
- `apps/api/src/salons/admin-salons.controller.ts` — now injects `SalonsService`, handlers are one-line delegations.
- `apps/api/src/salons/salons.service.spec.ts` — moved/adapted the full `setStatus`/`setFeatured` unit-test coverage from the controller spec (8 new test cases).
- `apps/api/src/salons/admin-salons.controller.spec.ts` — rewritten as a thin delegation test (3 cases: params/dto passed through unchanged, result returned unchanged, errors propagate unchanged).

---

## 3. Worker Assignment Double-Booking Bug

**Risk level: High — real production incident potential** (two customers' appointments silently assigned to the same worker at overlapping times).

### Finding
`BookingsService.assignWorker()` (used by `PATCH /salons/mine/bookings/:id/assign-worker`) validated the worker's existence, active status, and service eligibility, but **never checked whether that worker already had another overlapping booking** at the target time. `createHold()` (the booking-creation path) already had this check; `assignWorker()` — a second, later write path onto the same `workerId` column — did not.

### Fix
`assignWorker()` now:
1. Acquires the same per-salon Redis lock (`lock:booking:{salonId}`) `createHold()` uses, so the two write paths can't race each other.
2. Inside a transaction, re-validates worker/eligibility, then runs the **exact same overlap query** `createHold()` uses (`status IN (pending_payment, confirmed)`, interval overlap on `startsAt`/`endsAt`), excluding the booking being assigned itself.
3. Rejects with `ConflictException` on any overlap.

**Files:**
- `apps/api/src/booking/bookings.service.ts` — `assignWorker()` rewritten.
- `apps/api/src/booking/bookings.service.spec.ts` — `assignWorker` describe block rewritten (transaction/em-based mocking), new cases: lock-held 409, overlap 409, overlap-predicate assertion, and a **concurrency test** (`Promise.allSettled` on two simultaneous calls, asserts exactly one succeeds).
- `apps/api/test/worker-selection-booking.e2e-spec.ts` — new `describe('assign-worker rejects a double-booking')` block: a sequential-overlap 409 case, and a real **concurrency e2e test** against live Postgres+Redis (two simultaneous `PATCH .../assign-worker` HTTP requests, asserts `[200, 409]`).

---

## 4. Duplicated Worker Eligibility Logic

**Risk level: Medium** (maintainability — a rule change previously required touching 3+ call sites in sync).

### Finding
The "worker with no `worker_services` rows is unrestricted; a worker with rows is restricted to exactly those" SQL predicate was hand-written independently in `BookingsService.createHold`, `BookingsService.assignWorker`, `AvailabilityService.computeFor`, and `PublicSalonContentController.listWorkers`.

### Fix
Extracted `WorkerEligibilityService` (`apps/api/src/salons/worker-eligibility.service.ts`), exporting:
- `isWorkerEligibleForService(workerId, serviceId, manager?)` — boolean check, optionally transaction-scoped.
- `applyEligibilityFilter(qb, serviceId)` — the same predicate as a reusable `QueryBuilder.andWhere()` fragment, for the roster-listing endpoint that filters a whole set of workers at once.

Registered as a provider/export of `SalonsModule`; injected into `BookingsService`, `AvailabilityService`, and `PublicSalonContentController`, replacing all four duplicated SQL blocks.

**Files:**
- `apps/api/src/salons/worker-eligibility.service.ts` (new) + `.spec.ts` (new, 5 tests).
- `apps/api/src/salons/salons.module.ts` — registered/exported the new service.
- `apps/api/src/booking/bookings.service.ts`, `apps/api/src/booking/availability.service.ts`, `apps/api/src/salons/public-salon-content.controller.ts` — now call the shared service instead of inline SQL.
- `apps/api/src/booking/bookings.service.spec.ts`, `apps/api/src/booking/availability.service.spec.ts` — updated to mock the new service.

---

## 5. PlatformConfig Failure Handling

**Risk level: Medium** (a raw `Error` on a missing config key previously surfaced as an unstructured 500 the first time it was hit, rather than at deploy time).

### Fix
- `getNumber()` now throws `InternalServerErrorException` (a typed NestJS exception with a clear message) instead of a raw `Error`.
- Added `onApplicationBootstrap()` (NestJS lifecycle hook) that checks every key the live getters can ask for (`REQUIRED_PLATFORM_CONFIG_KEYS`) is present in `platform_config` at boot, and **throws if any are missing** — since `main.ts` awaits `NestFactory.create()`, this causes the process to fail to start (with a clear, itemized error message) rather than serving traffic with a landmine config.

**Files:**
- `apps/api/src/platform-config/platform-config.service.ts` — `REQUIRED_PLATFORM_CONFIG_KEYS`, `onApplicationBootstrap()`, `InternalServerErrorException`.
- `apps/api/src/platform-config/platform-config.service.spec.ts` — 5 new tests (getter exception type/message, clean boot, boot failure listing missing keys, empty-table case).
- Verified live: ran `test:e2e -- health` against the real seeded test DB to confirm the app still boots cleanly with the hook in place.

---

## 6. Missing Weekly Schedule Overlap Validation

**Risk level: Medium** (a salon could be configured with self-contradictory hours, e.g. two overlapping ranges on the same weekday, silently accepted).

### Fix
Added `findOverlappingHourRanges()` (`apps/api/src/salons/schedule-hours.util.ts`), a pure function that detects any two submitted ranges on the same weekday whose intervals overlap (touching at a shared boundary, e.g. 09:00–12:00 + 12:00–17:00, is explicitly *not* an overlap — that's a valid back-to-back schedule). Wired into `ScheduleController.replaceHours()` alongside the existing per-range `openTime < closeTime` check, both running **before** the delete-and-reinsert transaction.

**Files:**
- `apps/api/src/salons/schedule-hours.util.ts` (new) + `.spec.ts` (new, 8 tests).
- `apps/api/src/salons/schedule.controller.ts` — calls the new validator, 400s with a clear message naming the conflicting weekday/ranges.
- `apps/api/test/schedule.e2e-spec.ts` — 2 new e2e cases (overlap rejected + nothing written; back-to-back accepted).

---

## 7. Favorites Visibility Bug

**Risk level: Medium** (a customer could keep seeing a suspended/rejected salon in their favorites list indefinitely — inconsistent with every other public salon listing in the platform).

### Fix
`GET /favorites` now filters to `status: 'approved'`, matching `SalonsService.findPublicBySlug` and `SearchService`. The underlying `Favorite` row is left untouched (not deleted) so the salon reappears automatically if later re-approved.

**Files:**
- `apps/api/src/favorites/favorites.controller.ts` — `list()` filter added.
- `apps/api/test/favorites.e2e-spec.ts` — new regression test with a second, `suspended`-status salon: confirms it's favoritable (no existing guard against that) but excluded from the list while an approved favorite still shows.

---

## 8. Persian Slug Generation

**Risk level: Low** (SEO/UX quality issue, not a correctness or security bug).

### Finding
`makeSlug()` fell back to an opaque `salon-<8hex>`/`post-<8hex>` for any name with fewer than 3 Latin/digit characters after stripping — which is every Persian-only name, i.e. the dominant case for this Iranian marketplace.

### Fix
Added a deterministic Perso-Arabic → Latin character transliteration table (standard letter mappings, Persian/Arabic-Indic digit normalization, and special-cased handling of the very common word-final "یی" double-ye ending, e.g. `طلایی` → `talayi` not `talayy`) applied before the existing slugify/hex-suffix pipeline. English names pass through unaffected. The fallback path is kept for input with literally nothing translatable (emoji, pure punctuation).

**Known, documented limitation:** Persian orthography omits short vowels entirely, so a word whose spelling depends on an unwritten vowel (e.g. `رز` "rose", pronounced /roz/ but written with no vowel letter) cannot be recovered from the text alone — this is a linguistic limit of any deterministic, dictionary-free transliteration, not an implementation gap. Documented directly in the source and in the test suite.

**Files:**
- `apps/api/src/common/slug.util.ts` — transliteration table + logic.
- `apps/api/src/common/slug.util.spec.ts` — rewritten; 7 new Persian-transliteration cases plus the 3 pre-existing Latin-name cases (kept, unchanged in behavior).
- `apps/api/src/content/content.service.spec.ts` — updated the one test that asserted the old opaque-fallback behavior for a Persian blog title; added a new test confirming the true-fallback case (title with nothing translatable) still works.

---

## 9. Audit Logging Improvements

**Risk level: Low** (observability/compliance-trail quality, not a live bug).

### Fixes
1. **Split the shared blog-cover audit action.** `post.cover.set` (used identically for both upload and delete) is now two distinct actions: `post.cover.upload` and `post.cover.remove`. The audit log can now distinguish which happened by action name alone.
2. **Added a distinct warning-level log on audit-write failure**, in addition to the existing error-level log (which already carried a full stack trace). The new line uses a fixed, greppable prefix (`AUDIT_WRITE_FAILED action=... targetType=... targetId=... actorId=...`) specifically so an external log-based monitoring/alert rule can page on it without parsing a free-form message. Wiring the in-app `AlertsService` in directly was investigated and **rejected**: `AlertsModule → AdminNotificationsModule → AuthModule → AuditModule` is a real, pre-existing module-import chain, so importing `AlertsModule` into `AuditModule` would create a circular dependency — out of scope for a Phase 1 fix that must not introduce new architectural risk. This is flagged as a Phase 2/future candidate (see the doc comment left in `audit.service.ts`).

**Files:**
- `apps/api/src/content/admin-blog.controller.ts` — two `@AuditAction` strings.
- `apps/api/src/audit/audit.service.ts` — added the `logger.warn(...)` line.
- `apps/api/src/audit/audit-wiring.spec.ts` — updated pinning test for the two new action strings.
- `apps/api/src/audit/audit.service.spec.ts` — new `AuditService.record` describe block (5 tests: success path, swallowed failure, both log lines asserted, null-targetId rendering).
- `apps/api/test/blog.e2e-spec.ts` — updated the audit-row-count assertion for the two split actions.
- `apps/admin-panel/src/utils/labels.ts` — split the one Farsi label into two.
- `apps/admin-panel/src/utils/labels.spec.ts` — updated the action-count pinning guard (27 → 28).

**No existing behavior changed** beyond the audit log's own action-string vocabulary — this does not affect any user-facing response shape.

---

## 10. Security Test Suite

**Risk level: N/A** (net-new coverage).

Added `apps/api/test/security.e2e-spec.ts` — a consolidated e2e suite covering every scenario in the brief, deliberately cross-referencing (not duplicating) existing coverage found elsewhere:

| Scenario | What's new here | Pre-existing coverage referenced |
|---|---|---|
| Unauthorized access to admin endpoints | 14 cases (7 routes × no-session/non-admin-session) proving guards reject real HTTP requests end-to-end | `route-guard-audit.spec.ts` (item 1) proves every route *has* a guard, statically |
| Provider accessing another salon | 5 cases: cross-tenant `assign-worker`, service edit, worker edit, booking-status edit all 404 (not leak/succeed); confirms tenant A's data is untouched | — (new ground) |
| Suspended users | 1 case: a suspended provider is blocked from a salon-management *mutation* mid-session | `user-suspend-login.e2e-spec.ts` already covers login-time and `GET /auth/me` lockout |
| Invalid uploads | 2 new cases: spoofed-mimetype malicious content (422), oversized file (413/422) | `salon-photos.e2e-spec.ts` already covers the plain non-image case |
| XSS markdown payloads | 1 case: a `<script>`/`onerror` payload is stored and returned byte-for-byte verbatim through both the admin and public blog endpoints, proving the API does no unsafe server-side transformation | Actual escaping happens client-side (`markdown-it` `html:false`), pinned by `apps/user-app/test/unit/markdown.spec.ts` and `apps/admin-panel/src/utils/markdown.spec.ts` |
| Role escalation | 2 cases: an injected `role`/`status` field on `PATCH /auth/profile` is silently stripped (DTO whitelisting); a customer cannot self-escalate via the admin status endpoint | — (new ground) |

All 26 cases pass against the real Postgres/Redis test stack.

---

## Summary of changed files

**New files:**
- `apps/api/src/route-guard-audit.spec.ts`
- `apps/api/src/salons/worker-eligibility.service.ts` + `.spec.ts`
- `apps/api/src/salons/schedule-hours.util.ts` + `.spec.ts`
- `apps/api/test/security.e2e-spec.ts`
- `docs/phase1-audit.md` (this file)

**Modified (backend):**
`apps/api/src/salons/salons.service.ts`, `salons.service.spec.ts`, `admin-salons.controller.ts`, `admin-salons.controller.spec.ts`, `salons.module.ts`, `public-salon-content.controller.ts`, `schedule.controller.ts`, `booking/bookings.service.ts`, `bookings.service.spec.ts`, `booking/availability.service.ts`, `availability.service.spec.ts`, `platform-config/platform-config.service.ts`, `platform-config.service.spec.ts`, `favorites/favorites.controller.ts`, `common/slug.util.ts`, `common/slug.util.spec.ts`, `content/content.service.spec.ts`, `content/admin-blog.controller.ts`, `audit/audit.service.ts`, `audit/audit.service.spec.ts`, `audit/audit-wiring.spec.ts`, `test/worker-selection-booking.e2e-spec.ts`, `test/favorites.e2e-spec.ts`, `test/schedule.e2e-spec.ts`, `test/blog.e2e-spec.ts`.

**Modified (admin-panel):** `apps/admin-panel/src/utils/labels.ts`, `labels.spec.ts`.

## Migrations required

**None.** Every fix operates on the existing schema (no new columns, tables, or constraints).

## Possible breaking changes

- **`audit_log.action` values `post.cover.upload`/`post.cover.remove`** replace `post.cover.set`. Anything outside this repo (an external log query, a saved admin-panel filter, a BI dashboard) that filters on the literal string `post.cover.set` will need updating. Nothing inside this repo depends on the old string after this change (verified by repo-wide grep).
- **`GET /favorites`** now returns fewer results for any account that had favorited a since-suspended/rejected salon — this is the bug fix itself, not a regression, but is a response-shape/content change a frontend integration test elsewhere could conceivably have baked an assumption around (none found in this repo).
- **`makeSlug()`** produces different slugs for Persian input than before (readable transliteration instead of a random hex string). Since slugs are generated once at creation time and stored, this only affects *newly created* salons/posts going forward — no existing stored slugs are altered.
- **`PATCH /salons/mine/bookings/:id/assign-worker`** can now return `409 Conflict` in a case that previously silently succeeded (assigning a worker who is already double-booked). This is the bug fix itself — any client-side code that assumed this endpoint never conflicts should handle the new 409 (the provider-panel's existing `useApi()` error handling already surfaces any non-2xx via its generic toast, so no frontend code change was required).
- **App boot now fails fast** if a required `platform_config` row is missing. In the extremely unlikely case that a production database is currently missing one of the 7 required keys, the next deploy will refuse to start instead of serving traffic with a landmine — this is intentional per the brief ("Application should fail during boot"), but is worth a pre-deploy check against production data before shipping this change.

## Test results

- **Unit** (`pnpm --filter @gheychi/api test`): all passing (689+ tests across 56+ suites, including every new spec file above).
- **E2E** (`pnpm --filter @gheychi/api test:e2e`): every touched/new e2e file re-run individually and passing (`worker-selection-booking`, `favorites`, `schedule`, `blog`, `security`, `health`); full e2e suite run recorded in the Phase 1 completion report.
- **Typecheck** (`pnpm --filter @gheychi/api typecheck`): clean throughout.
- **`admin-panel`** unit suite (270 tests): passing after the label-mapping update.
