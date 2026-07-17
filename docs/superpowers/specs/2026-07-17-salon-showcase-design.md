# Salon Showcase — Stories, Rich Profile, Portfolio — Design

**Date:** 2026-07-17
**Status:** Approved
**Chosen by:** a three-design judge panel (MVP-first / product-first / risk-first candidates, three scoring lenses). The risk-first design won; consensus grafts from the other two are folded in below.

## Problem

Salon owners have no way to express themselves or show their work. The product owner wants: (1) Instagram-like **stories**, (2) a **profile** where the owner describes the salon beautifully, (3) **sample works** (portfolio). Customer display in the user-app; management in the provider panel; moderation reach for admins.

## Data model — one additive migration

`apps/api/src/migrations/1752800000000-salon-showcase.ts` (next slot after `1752700000000-payment-refunds`):

**Profile — three nullable columns on `salons`** (no new table; `description` stays untouched):
```sql
ALTER TABLE salons ADD COLUMN tagline varchar(120);
ALTER TABLE salons ADD COLUMN about text;
ALTER TABLE salons ADD COLUMN instagram_handle varchar(30);
```
Plain text only — no markdown, no new render surface (the two sanctioned `v-html` sites stay the only two).

**Stories — `salon_stories`** (entity `apps/api/src/salons/salon-story.entity.ts`):
```sql
CREATE TABLE salon_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES salons(id),
  url varchar(500) NOT NULL,
  storage_key varchar(500) NOT NULL,
  caption varchar(200),
  service_id uuid REFERENCES salon_services(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'published',   -- 'published' | 'removed'
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL                    -- stamped at INSERT by the DB clock: now() + interval '24 hours'
);
CREATE INDEX salon_stories_public_idx ON salon_stories (salon_id, status, expires_at);
CREATE INDEX salon_stories_cleanup_idx ON salon_stories (expires_at);
```
No `view_count` (grafted decision: the view beacon was the design's only unauthenticated, unthrottled public write — dropped; seen-state is client-side only).

**Portfolio — `portfolio_items`** (entity `apps/api/src/salons/portfolio-item.entity.ts`):
```sql
CREATE TABLE portfolio_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES salons(id),
  url varchar(500) NOT NULL,
  storage_key varchar(500) NOT NULL,
  caption varchar(300),
  service_id uuid REFERENCES salon_services(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'published',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portfolio_items_salon_idx ON portfolio_items (salon_id, sort_order);
```
Deliberately separate from `salon_photos` (photos = the space, portfolio = the work); `salon_photos` is untouched.

**Reports extension:** `reports` gains `story_id uuid REFERENCES salon_stories(id) ON DELETE SET NULL` and `portfolio_item_id uuid REFERENCES portfolio_items(id) ON DELETE SET NULL`. The exactly-one-target rule widens to four; `salon_id` stays NOT NULL and is **derived** from the story/portfolio item (same pattern as review reports). The open-report dedup partial index is rebuilt to cover the two new columns (`COALESCE(story_id, zero-uuid), COALESCE(portfolio_item_id, zero-uuid)`). Standing rule unchanged: ≥1 completed booking at the salon.

Storage keys namespaced under the existing salon prefix (grafted): `salons/<salonId>/stories/<uuid>.<ext>` and `salons/<salonId>/portfolio/<uuid>.<ext>` — extension derived from the validated mimetype, never from `originalname`.

## API

Registration order: new `salons/mine/*` controllers go **before** `PublicSalonContentController` in `salons.module.ts` (documented Express-order hazard).

**Provider — `SalonStoriesController` (`salons/mine/stories`, AuthGuard + SalonOwnerGuard):**
- `GET` — all **unexpired** rows for `req.salonId` (including `removed`, so the owner sees the badge), `created_at ASC`.
- `POST` — multipart `file` (5MB, `ParseFilePipeBuilder` magic-number `/^image\/(jpeg|png|webp)$/`, 422 — copied verbatim from `SalonPhotosController`) + `CreateStoryDto { caption? @Length(1,200); serviceId? @IsUUID }`. `serviceId`, when present, must belong to `req.salonId` (else 400). Active-story cap: `count WHERE salon_id AND expires_at > now()` ≥ **10** → 409 `'حداکثر ۱۰ استوری فعال مجاز است'` — counted **regardless of status** (a removed story occupies its slot until natural expiry; closes upload-remove-upload churn). `expires_at` set via SQL `now() + interval '24 hours'` (DB clock — the same clock the read filter uses). Returns the row (201).
- `DELETE /:id` — 204; 404 unless `{id, salonId}`; DB delete first, then best-effort logged `storage.delete` (interactive-path order, same as photos).

**Provider — `SalonPortfolioController` (`salons/mine/portfolio`, same guards):**
- `GET` — all rows incl. removed, `sort_order ASC, created_at ASC`.
- `POST` — same multipart pipeline + `CreatePortfolioItemDto { caption? @Length(1,300); serviceId? @IsUUID }` (ownership-checked); cap **40** per salon → 409; `sort_order = count` at insert.
- `PATCH /:id` — `UpdatePortfolioItemDto { caption?; sortOrder? @IsInt @Min(0); serviceId? (nullable to clear) }`; 404 on wrong owner. (Reorder = the panel PATCHing swapped sortOrders.)
- `DELETE /:id` — 204, DB-first + best-effort logged storage delete.

**Profile — no new endpoint.** `UpdateSalonDto` gains `tagline? @MaxLength(120)`, `about? @MaxLength(2000)`, `instagramHandle? @Matches(/^[A-Za-z0-9._]{1,30}$/)` — each `@Transform`ing `''` → `null` so fields can be cleared. The handle regex is the safety boundary that makes `https://instagram.com/<handle>` links injection-free.

**Public — `PublicSalonContentController`** (inherits the `findPublicBySlug` approved-only gate):
- `GET /salons/:slug/stories` — `status='published' AND expires_at > now()` (SQL `now()`, not app clock), `created_at ASC` (viewer plays oldest-first). Fields: `{ id, url, caption, serviceId, createdAt, expiresAt }`.
- `GET /salons/:slug/portfolio` — `status='published'`, `sort_order ASC`. Fields: `{ id, url, caption, serviceId, sortOrder }`.
- `GET /salons/:slug` now also returns `tagline/about/instagramHandle` (columns on the entity; endpoint returns the raw entity today — its over-serialization is a pre-existing known issue, not this plan's to fix).

**Search (grafted):** `SearchResult` gains `hasActiveStory: boolean` via an `EXISTS` subquery over `(salon_id, status, expires_at)` — an SSR-rendered freshness cue for salon cards. No ordering change.

**Admin — extend `AdminSalonsController` (`@Roles('admin')`):**
- `GET /admin/salons/:id/stories` and `GET /admin/salons/:id/portfolio` — all rows incl. removed/expired (admins can inspect a pending/suspended salon's content — the public gate doesn't apply here).
- `PATCH /admin/stories/:id/status` and `PATCH /admin/portfolio/:id/status` — body `{ status: 'published' | 'removed', reason? }`; **remove/restore toggle, not hard delete** (reversible moderation, evidence retention); audited via `@AuditAction('salon.story.status.set' / 'salon.portfolio.status.set')`.

## Story lifecycle

- **Read-filter is authoritative** — expiry is a SQL predicate (`expires_at > now()`), never a state transition that can be missed. Correct even if the cron dies, the app clock drifts (insert and read both use the Postgres clock), or the process restarts.
- **GC cron is storage hygiene only** — `StoryCleanupJob` (`apps/api/src/salons/story-cleanup.job.ts`, `@Cron('0 * * * *')` hourly → `handleCron()` → plain `run(): Promise<number>`; provider in SalonsModule). Each run: select ≤200 rows `WHERE expires_at < now() - interval '1 hour'` (grace hour keeps a just-expired image visible to an admin resolving a fresh report) `AND NOT EXISTS (open report referencing the story)` — **open reports pin the evidence**; resolved/dismissed release it. Per row: `storage.delete(key)` **first**, DB row delete only on success — inverted from the interactive path on purpose: here the row is the GC tracking record, so a failing storage backend self-heals next run instead of silently orphaning objects (failures logged with key + salon id). `removed` rows ride the same GC. Per-row try/catch so one bad row doesn't abort the batch.
- **Media:** images only, 5MB, jpeg/png/webp, magic-number-sniffed. No video (no transcoding infra — hard cut), no thumbnails (matches existing gallery behavior).
- **Storage bound:** ≤10 unexpired stories × 5MB per salon, each object living ~25h.

## User-app UX (all on `salons/[slug].vue`, protecting SSR)

**SSR'd (durable, SEO-relevant):**
- *Profile:* `tagline` as a muted line under the h1; new «درباره سالن» section rendering `about` via `{{ }}` interpolation with `whitespace-pre-line`; Instagram chip → `https://instagram.com/${handle}` with `rel="noopener nofollow"`. SEO: description chain becomes `about-excerpt ?? tagline ?? description ?? name—address`; JSON-LD gains `description` + `sameAs: ['https://instagram.com/<handle>']` (inside the existing `<`-escaped stringify); `ogImage` falls back to the first portfolio image when the salon has no gallery photos (grafted).
- *Portfolio:* a 5th parallel call in the existing `useAsyncData` `Promise.all` (`silent:true`, `[]` fallback — cannot 404-flip the page). New `PortfolioGrid.vue` (components/salon/, auto-imported): responsive 2–3 col grid below «خدمات», heading «نمونه کارها», `NuxtImg provider="arvancloud"`, caption under each tile; tap opens a minimal client-side lightbox; when the item's `serviceId` matches one of the page's already-fetched services, the lightbox shows a «رزرو این خدمت» pill linking to `/booking/[slug]/[serviceId]` (grafted). Section omitted when empty. Everything under the existing root `v-if="page"` guard.

**Client-only (ephemeral):**
- *Stories:* fetched in the page's existing `onMounted` (`silent:true`). If any: `StoriesRing.vue` above the gallery (cover-photo thumbnail in a gradient ring, «استوری» label); tap opens `StoryViewer.client.vue` (`.client.vue` per repo convention) — full-screen overlay, tap-through oldest-first, top progress bars segmented per story with ~5s auto-advance, caption overlay, close on X/last-story/Escape; RTL-aware navigation (tap right = back, left = forward in RTL); story with a matching `serviceId` shows the same «رزرو این خدمت» pill. Seen-state is **localStorage only**: newest-seen `createdAt` per salon (self-expiring, no pruning logic) — ring dims when nothing newer.
- *Cards:* `SalonCard` renders a thin accent story ring around its existing 80×80 thumbnail when `hasActiveStory` (SSR-rendered from search results).

## Provider-panel UX

Routes under the approved-gated `AppLayout` children; entry points from the Dashboard QUICK_LINKS grid (BottomNav stays at 5 tabs).

1. `/stories` → `StoriesView.vue` («استوری‌ها»): cap meter («۳ از ۱۰ استوری فعال»), uploader with optional caption (200-char counter) and optional service `<select>` from `/salons/mine/services`, grid of unexpired stories with remaining time («۱۸ ساعت مانده», shared formatter + interval cleaned up in `onUnmounted`), delete with confirm, danger badge «توسط مدیر حذف شد» on `removed`. 409s surface inline.
2. `/portfolio` → `PortfolioView.vue` («نمونه کارها»): PhotosView's interaction model + inline caption editing (blur → PATCH), up/down sort buttons (swap sortOrders via PATCH), service select (clearable), removed badge, 40-cap message.
3. Profile: `SalonSettingsView.vue` gains «شعار سالن» (120 counter), «درباره سالن» (textarea, 2000 counter, line-breaks-preserved hint), «آیدی اینستاگرام» (LTR input with visual `instagram.com/` prefix, client-side regex mirror + Persian inline error) — through the existing PATCH save flow. A small live-preview block renders tagline + about excerpt as the public page will show them (grafted).

**Uploader (grafted decision):** generalize the existing `PhotoUploader.vue` with optional `endpoint` and `extraFields` props whose defaults keep `PhotosView` byte-identical (existing spec extended to pin that), instead of cloning parallel uploaders. This is a deliberate, approved modification of existing code under CLAUDE.md's ask-first rule — recorded here as the approval.

## Admin panel

`SalonDetailView.vue` gains «استوری‌ها» / «نمونه کارها» tabs (all rows incl. removed/expired, remove/restore toggle with reason prompt). `ReportsView.vue` shows the reported story/portfolio thumbnail + caption when present, «منقضی شده» placeholder when the FK is null.

## Moderation posture

Reactive, unchanged: only approved salons can post; uploads are magic-number-verified images; captions are length-capped plain text rendered by interpolation. Fast takedown via the status PATCH (hides instantly — no cache in front), audited, owner-visible badge. Verified-customer reports extend to both new content types feeding the existing queue + bell. Accepted gap: a provider self-deleting a reported story destroys the image evidence (their delete right wins; report text survives).

## Cuts (explicit)

No video stories. No cross-salon story feed / home-page rail. No server-side per-user seen state or view counts. No highlights/archive/pinning. TTL (24h) and caps (10/40) hardcoded, not platform config. No pre-publish queue, no automated image scanning. `about` is plain text (no markdown). Storage objects remain URL-fetchable after admin removal until GC (same accepted class as existing best-effort deletes). No ops alert on GC backlog (log-only). Profile fields optional everywhere (no onboarding gate). **Named fast-follow, not in scope:** before/after work-sample pairs with a CSS clip-path comparison slider.

## Test matrix (repo-standard minimum)

- API: colocated unit specs for the GC job (evidence pinning, grace hour, storage-first ordering, per-row isolation) and cap/ownership logic; one e2e lifecycle spec per content type (upload with caption → public visibility gated on approved → expiry filter → delete), reusing the `MINIMAL_PNG` buffer pattern; an e2e asserting 400 on an over-length multipart caption (multipart text field + DTO validation is a new combination — prove the whitelist pipe applies); reports e2e extended for a story target incl. dedup index behavior; admin status-toggle e2e with audit row assertion.
- user-app: nuxt component tests for the new page sections (portfolio grid renders + empty-state omission, about/tagline/instagram render + SEO description chain), StoryViewer unit-testable pieces kept in pure utils where possible.
- provider-panel: colocated specs for StoriesView/PortfolioView/uploader generalization (PhotosView pinned unchanged) + settings fields validation.
- admin-panel: specs for the new tabs and report thumbnail rendering.
