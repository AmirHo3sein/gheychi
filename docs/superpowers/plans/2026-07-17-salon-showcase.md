# Salon Showcase — Stories, Rich Profile, Portfolio — Execution Record

**Date:** 2026-07-17
**Spec:** `docs/superpowers/specs/2026-07-17-salon-showcase-design.md` (Approved — risk-first design won a three-design judge panel; consensus grafts folded in)
**Status:** Complete

## What shipped

- **API (`apps/api`):** migration `1752800000000-salon-showcase` (profile columns on `salons`, `salon_stories`, `portfolio_items`, reports widened to story/portfolio targets with a `target_type` discriminator + rebuilt open-report dedup index); `SalonStoriesController` + `SalonPortfolioController` under `salons/mine/*` (photos' multipart pipeline verbatim, caps 10 active / 40 total with Persian 409s, serviceId ownership checks, DB-clock `expires_at` stamping); public endpoints on `PublicSalonContentController` (approved-gated, published + unexpired only, minimal field shapes); `StoryCleanupJob` (hourly GC: 1h grace, open-report evidence pinning via NOT EXISTS, storage-first delete order so failures self-heal, batch 200, per-row isolation); `UpdateSalonDto` profile fields with `''→null` clears; `SearchResult.hasActiveStory` EXISTS subquery; admin `GET` lists + `PATCH .../status` remove/restore (audited, reversible — no hard delete).
- **user-app:** salon page renders tagline/about (interpolation + `whitespace-pre-line`, no new v-html)/instagram chip; SEO chain `about-excerpt ?? tagline ?? description ?? name—address`, JSON-LD `description` + `sameAs`, ogImage falls back to the first portfolio image; portfolio as a 5th parallel SSR call + `PortfolioGrid` with lightbox and «رزرو این خدمت» pills; stories client-only (`StoriesRing` + `StoryViewer.client.vue` tap-through player, RTL-aware, scroll-locked, localStorage newest-seen dim state); story ring on `SalonCard`; report affordances for stories and portfolio items wired through the existing eligibility-gated `ReportForm`.
- **provider-panel:** `/stories` and `/portfolio` pages (cap meters, remaining-time countdown, delete-with-confirm, admin-removed badges, inline caption edit with null-clear, sort swap, service selects), settings profile fields with live preview, `PhotoUploader` generalized via `endpoint`/`extraFields` props (PhotosView pinned byte-identical — a pre-approved modification recorded in the spec).
- **admin-panel:** salon detail stories/portfolio tabs with remove/restore (reason prompt), reports view rendering story/portfolio evidence with a reachable «منقضی شده» placeholder discriminated on `targetType`.

## Verification

Adversarial review workflow (5 finder dimensions → 3-lens refutation per finding, 53 agents): 10 confirmed findings (7 after dedup), 6 refuted. Notable confirmed-and-fixed:

1. **FK `SET NULL` cascade vs dedup unique index (major, empirically reproduced):** deleting a reported story could 23505-abort the provider's DELETE → 500, permanently blocking self-deletion of reported content. Root fix: `reports.target_type` (server-set, survives nulling) + the dedup index rebuilt to exclude orphaned content reports; regression e2e reproduces the exact collision and the two-deleted-stories collapse.
2. **No customer-facing report entry point** for stories/portfolio (the widened API was dead surface): «گزارش» affordances added to the story viewer (pausing auto-advance) and portfolio lightbox.
3. **Admin evidence placeholder unreachable** (gated on the FK that nulling destroys — and pinned by a test fabricating an impossible state): now discriminated on `targetType`; the dishonest test rewritten to the real post-deletion shape.
4. `sortOrder = count` collisions after delete-then-upload silently killing panel reorder (now `MAX+1`); story-viewer background scroll leak (scroll-lock util); portfolio caption un-clearable (PATCH `{caption: null}`); live-preview comment/UTF-16 slice corrections.

Final suites: API 338 unit + 280 e2e, user-app 127 (+ only the known pre-existing typecheck error), provider-panel 60, admin-panel 116 — all green. Migration `down()`/`up()` cycle verified against local Postgres.

## Notes for future work

Named fast-follow from the spec: before/after work-sample pairs with a CSS clip-path comparison slider. Cuts recorded in the spec (no video, no story feed/rail, no view counts, hardcoded TTL/caps, no pre-publish queue). Dev machines that ran the interim version of the migration before the `target_type` rework need a manual `ALTER` or a schema rebuild (e2e databases unaffected — they remigrate from scratch).
