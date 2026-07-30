# Gheychi

Salon discovery & booking marketplace (Iran). Spec: `docs/superpowers/specs/2026-07-04-gheychi-marketplace-design.md`.

## Structure

- `apps/api` — NestJS modular monolith (PostgreSQL + PostGIS, Redis)
- `apps/user-app` — Nuxt 4, mobile-first PWA (Plan 4)
- `apps/provider-panel` — Vue 3 SPA, salon-owner back office (Plan 5)
- `apps/admin-panel` — Vue 3 SPA, platform admin back office (Plan 6)

## Getting started

```bash
docker compose up -d          # postgres (postgis) + redis
cp .env.example apps/api/.env
pnpm install
pnpm --filter @gheychi/api migration:run
pnpm dev:api                  # http://localhost:3002/api/health
```

```bash
cp apps/user-app/.env.example apps/user-app/.env   # set NUXT_PUBLIC_NESHAN_API_KEY and NUXT_PUBLIC_VAPID_PUBLIC_KEY for map/push features
pnpm dev:user-app                                   # http://localhost:3003
```

`NUXT_PUBLIC_VAPID_PUBLIC_KEY` must be the public half of the same keypair as the API's `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (`.env.example` at the repo root) — generate one pair with `npx web-push generate-vapid-keys` and split the two halves between the two `.env` files. Map and push both degrade gracefully without real keys (map view fails silently back to list view; push subscribe UI just won't do anything meaningful) — neither blocks the rest of the app.

(Ports are non-default on this machine — see the "Port note" in `docs/superpowers/plans/2026-07-04-plan-1-foundation-backend-core.md`'s Task 2 section if setting up fresh elsewhere and `.env.example`'s values need adjusting for local port conflicts.)

## Tests

```bash
pnpm --filter @gheychi/api test        # unit
pnpm --filter @gheychi/api test:e2e    # e2e (needs docker services)
```

## Booking & payments (Plan 2)

- `POST /api/bookings` — hold a slot + get a Zarinpal deposit payment URL (customer, authenticated)
- `GET /api/salons/:salonId/availability?serviceId=...` — next 14 days of open slots (public)
- `GET /api/payments/callback?Authority=...&Status=OK|NOK` — Zarinpal redirects here; the API 302s onward to `/booking/callback?status=...&bookingId=...` on the frontend (Plan 4's `apps/user-app/app/pages/booking/callback.vue`), which renders the success/failure confirmation
- `GET /api/bookings/mine`, `GET /api/bookings/:id`, `POST /api/bookings/:id/cancel` — customer-facing
- `GET /api/salons/mine/bookings`, `PATCH /api/salons/mine/bookings/:id` — provider-facing (mark completed/no_show)

**Payments run against `MockPaymentGateway` by default** (`PAYMENT_GATEWAY=mock` in `.env`/`.env.test`) — no real Zarinpal account is needed for local dev or tests. To use the real gateway, set `PAYMENT_GATEWAY=zarinpal`, `ZARINPAL_MERCHANT_ID`, and `ZARINPAL_ACCESS_TOKEN` (panel-issued, required for refund API auth — the API refuses to start in zarinpal mode without it), and **verify the payment contract against Zarinpal's sandbox first** — see the note at the top of `docs/superpowers/plans/2026-07-04-plan-2-booking-payments.md`. Refunds cannot be sandbox-tested at all — see `docs/deployment/ZARINPAL-REFUND-VERIFICATION.md` before enabling real refunds.

Two background jobs run every 1 and 5 minutes respectively: expiring abandoned booking holds (`booking_hold_ttl_minutes`, seeded at 15) and reconciling payments whose Zarinpal callback never arrived (fixed 20-minute stale threshold). The 20-minute threshold is intentionally longer than the default hold TTL, so a genuinely-late-but-successful payment commonly finds its booking already expired by the time reconciliation runs — this is handled (the payment is still marked `paid`, the booking is not resurrected into a possibly-rebooked slot), not a bug, but the two numbers are tuned relative to each other and shouldn't be changed independently without re-checking that relationship.

**Refunds are real as of Plan 8.** Cancelling a confirmed booking (salon cancel, or customer cancel outside the window) triggers an actual Zarinpal refund (`/pg/v4/payment/refund.json`, authenticated with a panel-issued access token): the payment moves `refund_pending → refunded` with the gateway's refund reference stored, a retry cron self-heals gateway failures, and the reconciliation job's "captured after the booking died" edge case now queues an automatic refund instead of a manual-review log. As of Plan 9, those operator signals page for real: every money-critical condition (stuck refund, refused refund, captured money on a dead booking, orphaned authority) becomes an in-app admin notification, and critical ones SMS `ALERT_ADMIN_PHONE`, deduped per condition so the 5-minute crons can't storm. The remaining caveat is bigger than a missing sandbox run: 2026-07-17 research found the implemented `refund.json` endpoint matches Zarinpal's *legacy, de-documented* REST contract (the current official refund API is GraphQL `AddRefund`), and no sandbox covers refunds — execute `docs/deployment/ZARINPAL-REFUND-VERIFICATION.md` against production before enabling real refunds.

## Reviews & moderation (Plan 3)

- `POST /api/reviews` — leave a rating (1-5) + optional comment for one of your own completed bookings (customer, authenticated)
- `GET /api/salons/:salonId/reviews` — published reviews for a salon, newest first (public)
- `PATCH /api/salons/mine/reviews/:id/reply` — salon owner sets or updates their one reply to a review (provider, authenticated)
- `PATCH /api/admin/reviews/:id` — admin sets a review's status to `published` or `rejected` (admin-only)

**Reviews are verified-booking-only**, enforced at the database level by a UNIQUE index on `reviews.booking_id` — a booking can only be reviewed once, and only after the salon marks it `completed`.

**Moderation is reactive, not pre-publish**: a review is `published` the instant it's created; there's no queue to clear before it's visible. An admin can later flip it to `rejected` (or back) if a report is upheld — reports originally arrived out-of-band (support ticket, phone call), but Plan 7 added an in-system report flow (see "Platform hardening (Plan 7)" below). Zarinpal refund settlement is now in-system (Plan 8).

`salons.rating_avg`/`rating_count` are always recomputed from every currently-`published` review for that salon, in the same transaction as any status-changing write — never incremented/decremented in place — so a rejection (or reversal) immediately and correctly updates the salon's public rating. The recompute locks the salon row first (`SELECT ... FOR UPDATE`) before reading the aggregate, closing a lost-update race that a naive single-statement `UPDATE ... FROM (aggregate subquery)` would have under concurrent writes to the same salon's reviews.

## Provider panel (Plan 5)

A Vue 3 + Vite SPA (`apps/provider-panel`) covering onboarding, dashboard, bookings, services, hours, photos, reviews, and earnings for salon owners. Backend additions it needed:

- `POST /api/salons/mine/photos` — upload a salon photo (multipart `file` field, jpeg/png/webp, 5MB max); the first photo uploaded is automatically marked cover. `PATCH /api/salons/mine/photos/:id` (isCover/sortOrder), `DELETE /api/salons/mine/photos/:id`.
- Photo storage goes through a swappable `StorageProvider` (`STORAGE_PROVIDER=local|s3`, same pattern as `SmsProvider`/`PaymentGateway`/`PushProvider`) — `local` writes under `apps/api/uploads/` and serves it at `/uploads/*`; `s3` talks to any S3-compatible bucket via `S3_ENDPOINT`/`S3_BUCKET`/`S3_REGION`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_PUBLIC_BASE_URL`.
- `GET /api/salons/mine/earnings` — `{ totalCollected, commissionPercent, commissionAmount, netPayout }`, computed from `paid` payments on the caller's own bookings. No new payment infrastructure; purely aggregates existing `Booking`/`Payment` rows.
- CORS now allows both `FRONTEND_BASE_URL` (user-app) and `PROVIDER_APP_BASE_URL` (provider-panel) as credentialed origins.
- No salon-approval workflow was added by this plan — that gap is closed by Plan 6 below.

## User app (Plan 4)

The first real UI: a Nuxt 4 SSR PWA covering login, discovery, salon profiles, booking, my bookings, and profile — plus an admin-controlled "featured salon" placement and push/SMS appointment notifications. Full design: `docs/superpowers/specs/2026-07-05-plan-4-user-app-frontend-design.md`.

**New public (unauthenticated) surface, specifically for SEO:** salon profile pages (`/salons/:slug`) are the one part of this app reachable without logging in — they're SSR-rendered with JSON-LD/OG metadata as Google landing pages, matching the original marketplace spec's intent. Every other route requires a session.

**Featured salons ("تبلیغ" / Ad badge):** `PATCH /api/admin/salons/:id/featured` (admin-only) flags a salon as featured with an optional expiry. Featured, still-approved, still-filter-matching salons are boosted to the top of `/api/search` results (capped at 2 per query) and rendered with a distinct badge — this can never bypass the gender/city/category filters every other result already goes through. There's no self-serve payment flow yet; an admin sets the flag directly (via the bare-bones `/admin/featured` page in the frontend, or the API) — Plan 6's admin-panel (below) doesn't add featured-salon management either, so this stays on the bare-bones page until a pricing model and dedicated UI exist.

**Push notifications, and closing Plan 2's reminder gap:** booking confirmations now send a push notification alongside the existing SMS, and a new scheduled job (`booking-reminder.job.ts`, same pattern as the existing hold-expiry/reconciliation jobs) sends both an SMS and a push reminder a configurable number of hours (`platform_config.reminder_lead_hours`, seeded at 3) before each confirmed appointment — Plan 2 shipped without this.

**Known gaps carried forward, not fixed by this plan:**
- ~~`salon_photos` has a public read endpoint now, but still no upload path anywhere in the system — galleries stay empty until provider-panel (a future plan) ships photo management.~~ Closed by Plan 5: `POST /api/salons/mine/photos` (see "Provider panel (Plan 5)" above) lets a provider upload/manage photos.
- ~~The admin `/admin/featured` page and the two admin salon endpoints it calls are intentionally minimal — there's still no salon-approval workflow (`pending` → `approved`) anywhere in the API; that remains a future admin-panel concern, same as before this plan.~~ Closed by Plan 6: `PATCH /api/admin/salons/:id/status` (see "Admin panel (Plan 6)" below) adds a real approve/reject/suspend workflow.
- ~~Blog/content-marketing SEO is a separate, not-yet-started Plan 5 — this plan only covers the salon-profile side of SEO.~~ Closed by Plan 8 (the plan numbering shifted after this was written — "Plan 5" became provider-panel): see "Blog / content CMS (Plan 8)" below.

## Admin panel (Plan 6)

A new Vue 3 + Vite SPA (`apps/admin-panel`, port 3005) for platform staff, same minimal stack and "Teal Trust" tokens as provider-panel, no shared code between the two per the isolation rule. Built as five vertical slices, backend + frontend together per slice:

- **Salon approvals** — a queue view (defaults to `status=pending`) and a detail view with Approve / Reject (reason required) / Suspend (reason required) actions. This closes the biggest gap Provider Panel (Plan 5) left open: `pending` → `approved` no longer needs a manual DB update anywhere in the flow.
- **Review moderation** — a filterable list (salon/status/rating) so an admin can find the review a report was about and flip it published ↔ rejected via the existing `PATCH /api/admin/reviews/:id`.
- **Categories** — create and rename service categories. ~~No delete (categories are FK'd from `salon_services`, so removing one in use needs a restrict-or-cascade decision left for later).~~ Closed by Plan 7: restrict-style delete shipped.
- **Users & salons** — search/filter users (phone, name, role, join-date range) and salons (name, city, status, gender target), with suspend/unsuspend on both. ~~Suspending a user blocks their login only — it does not cascade to their salon.~~ Closed by Plan 7: suspension now cascades to the approved salon with cause tracking.
- **Platform config** — a generic key/value editor over `platform_config`, no per-key curation or bounds checking.

New/changed API endpoints:
- `GET/PATCH /api/admin/salons` — now filterable by `status`/`city`/`name`/`genderTarget`, plus a `status=all` option; defaults to `status=pending`
- `PATCH /api/admin/salons/:id/status` — `{ status: 'approved'|'rejected'|'suspended', reason?: string }` (reason required for reject/suspend)
- `GET /api/admin/salons/:id` — full detail for the salon-detail view
- `POST /api/salons/mine/resubmit` — provider-panel side; flips a `rejected` salon back to `pending`
- `GET /api/admin/reviews` — filterable review list for moderation
- `POST/PATCH /api/admin/categories` — create/rename
- `GET/PATCH /api/admin/users` — search/filter, and `PATCH /api/admin/users/:id/status` to suspend/unsuspend
- `GET/PATCH /api/admin/config` — read all `platform_config` rows / bulk-update them

**Provider Panel addition:** a Salon Settings page (Dashboard → Settings, alongside Hours/Photos) reusing the onboarding `SalonInfoStep.vue` in edit mode, plus a `rejected`-status branch on the pending-approval screen showing the rejection reason with a link to Settings and a resubmit button — so a rejected provider has a real recovery path instead of a dead end.

CORS now also allows `ADMIN_APP_BASE_URL` (default `http://localhost:3005`) as a credentialed origin, alongside the existing `FRONTEND_BASE_URL`/`PROVIDER_APP_BASE_URL` — found and fixed as part of this plan's e2e work (Task 24).

**Out of scope at the time — all six closed by Plan 7 (see "Platform hardening (Plan 7)" below):**
- ~~No report/flag mechanism — reports about a salon or review still arrive out-of-band (support ticket, phone call), same as before.~~
- ~~No category delete.~~
- ~~No auto-suspend of a user's salon when the user is suspended.~~
- ~~No first-admin bootstrap script — the first admin account is still a manual DB update.~~
- ~~No audit log of admin actions (who approved/rejected/suspended what, when).~~
- ~~No notification to an admin when a provider resubmits a rejected salon.~~

## Platform hardening (Plan 7)

Closes the six trust-and-safety gaps carried since Plans 5/6 — no new product surface beyond these. Spec: `docs/superpowers/specs/2026-07-10-plan-7-platform-hardening-design.md`.

- **Admin audit log** — every admin mutation (salon status/featured, user status, review moderation, category create/update/delete, config update, report resolve) writes an `audit_log` row via a declarative `@AuditAction` decorator + interceptor; audit-insert failures are logged and swallowed, never failing the admin's request. Browse via `GET /api/admin/audit-log` (filterable by actor/action/target-type/date, paginated) or the admin-panel's Audit Log page. No before/after value snapshots in v1 — the log answers "who did what, to what, with what input, when."
- **First-admin bootstrap** — `pnpm --filter @gheychi/api create-admin 09121234567` idempotently creates the user if missing and sets `role='admin'`, `status='active'`; the first admin is no longer a manual DB update. (pnpm 9 sometimes leaks a `--` separator into forwarded script args — the script tolerates both `create-admin 09...` and `create-admin -- 09...`.)
- **Reports** — a verified customer (at least one `completed` booking at the salon) can report a salon or one of its reviews from the salon profile page: `POST /api/reports` (one *open* report per reporter per target, enforced by a partial unique index → 409), `GET /api/reports/eligibility?salonId=` gates the UI. Admins work the queue via `GET/PATCH /api/admin/reports` and the admin-panel Reports page. Resolving a report doesn't itself moderate anything — the queue links to the existing, already-audited moderation actions.
- **Category delete** — `DELETE /api/admin/categories/:id` with restrict semantics: a category referenced by any salon service (active or not) 409s, mirroring the DB's FK. Reassign-or-cascade is deferred until someone actually needs it.
- **Cascade suspend** — suspending a user now also suspends their `approved` salon in the same transaction, recording `suspended_cause='owner_suspended'`; reactivating the user restores only cascade-suspended salons — a salon an admin suspended directly (`suspended_cause='admin'`) stays suspended. Public review listing (`GET /api/salons/:salonId/reviews`) now also requires the salon to be `approved`.
- **Admin notifications** — a persisted queue (`admin_notifications`) polled by the admin panel (bell badge, 60s cadence), fed by two emit points: provider resubmits (`salon_resubmitted`) and new reports (`report_created`). One shared read-state for all admins is a deliberate cut.

**Known gaps carried forward, not fixed by this plan:**
- An admin can approve a pending salon whose owner is suspended — the salon goes publicly live while its owner is locked out of managing it; no guard exists on either side.
- The salon-side effect of a user-suspension cascade is not separately audited (only the `user.status.set` row exists) — deliberate; reconstructing a salon's status timeline from audit rows alone has that gap.
- Admin notifications are one shared queue (read = handled for everyone), not per-admin state — deliberate MVP cut.

## Salon showcase — stories, profile, portfolio (2026-07-17)

Salon owners can now present themselves: Instagram-style **stories** (image-only, 24-hour lifetime enforced as a DB-clock SQL predicate with an hourly storage-GC cron; cap 10 active), a richer **profile** (`tagline`, «درباره سالن» free text, Instagram handle — all optional, edited in the provider panel's settings), and a **portfolio** of sample works (captioned, optionally linked to a bookable service, cap 40, reorderable). Customers see them on the salon page (story ring + full-screen tap-through viewer, portfolio grid with «رزرو این خدمت» booking pills) and story rings on search cards (`hasActiveStory`); provider panel manages them at `/stories` and `/portfolio`; admins get per-salon content tabs with reversible remove/restore (audited) and the verified-customer report flow extends to both content types (`reports.target_type` survives content deletion, so evidence handling stays coherent). Spec + execution record: `docs/superpowers/specs/2026-07-17-salon-showcase-design.md`, `docs/superpowers/plans/2026-07-17-salon-showcase.md`. Cuts: no video, no story feed, no view counts, hardcoded TTL/caps.

## Coupons & discounts (2026-07-19)

Salon owners set a direct percent-off (1–100%) on any of their services, and can issue their own coupon codes (`/coupons` in the provider panel) scoped to their salon; admins issue platform-wide codes (`/coupons` in the admin panel). Codes support optional expiry and an optional total-redemption cap, with one redemption per user per code enforced at the database level (`coupon_redemptions`, `UNIQUE(coupon_id, user_id)`). Customers preview a code before paying (`POST /coupons/validate`) and the booking-creation transaction re-validates and redeems it atomically. **No stacking** — when both a service discount and a coupon apply, only the larger single discount is used (`apps/api/src/booking/discount.util.ts`).

## Referrals & ratings (2026-07-22)

A referral program plus per-worker ratings, built as 6 sequentially-shipped, adversarially-verified slices. Salon owners can add **workers** (staff backed by a real account) and get per-worker ratings alongside the existing salon review; every account (customer, salon owner, or worker) has one lifetime **referral code**, redeemable once at registration, whose reward tier is resolved from the referrer's role at that moment. A reward — wallet credit, cashback, loyalty points, or a percent/fixed discount coupon — grants only after the referred user's first qualifying booking, with a configurable hold-back buffer and full reversal (including wallet debit) if that booking is later refunded. All of it is admin-configurable and ships **disabled with placeholder values** — nothing pays out until an admin turns it on in `/referrals/settings`. Spec + execution record: `docs/superpowers/specs/2026-07-21-referral-and-rating-system-design.md`, `docs/superpowers/plans/2026-07-22-referral-and-rating-system.md`. Cuts: no worker SMS invites yet, wallet is accrue-only (no spend-at-checkout), no campaigns/tiers/multi-level referrals.

## Blog / content CMS (Plan 8)

A Persian content-marketing blog: admins author Markdown articles in the admin panel, and the user-app serves them as SEO-optimized public pages that pull organic search traffic toward salon discovery. Spec: `docs/superpowers/specs/2026-07-10-plan-8-blog-cms-design.md`. This is the "backend module + admin editor + public pages" subsystem deferred since Plan 4.

**Authoring flow (admin panel, `/blog`):** create a draft («مطلب جدید») → edit in a Markdown editor with a live side-by-side preview — slug auto-generates from the title but stays editable, plus optional category, free-text byline, excerpt, per-post SEO overrides (meta description, og-title), and a cover image (uploaded through the same swappable `StorageProvider` as salon photos) → publish. Publishing stamps `published_at` on the *first* publish only; unpublish → republish keeps the original date. Publish/unpublish are conditional updates (`WHERE status='draft'`/`'published'`), so a lost race 409s instead of double-applying; delete is a hard delete of any status. Categories are managed in a side card on the same page. Every admin mutation writes an audit row (`post.create/update/publish/unpublish/delete/cover.set`, `blogcategory.create/update/delete`) via the Plan 7 audit seam.

Admin endpoints (all `@Roles('admin')`, all audited):

- `GET /api/admin/blog/posts?status&categoryId&page&pageSize` — `{items, total, page, pageSize}` envelope, items joined with category name; status defaults to all (admins manage everything)
- `GET /api/admin/blog/posts/:id` · `POST /api/admin/blog/posts` · `PATCH /api/admin/blog/posts/:id` · `DELETE /api/admin/blog/posts/:id`
- `POST /api/admin/blog/posts/:id/publish` · `POST /api/admin/blog/posts/:id/unpublish` — the conditional transitions above
- `POST /api/admin/blog/posts/:id/cover` (multipart, same size/type validation as salon photos; replaces and best-effort-deletes any previous cover object) · `DELETE /api/admin/blog/posts/:id/cover`
- `POST /api/admin/blog/categories` · `PATCH /api/admin/blog/categories/:id` · `DELETE /api/admin/blog/categories/:id` — delete restricts: a category referenced by any post 409s, same semantics as Plan 7's salon-service category delete

Public endpoints (no auth):

- `GET /api/blog/posts?category=<slug>&page&pageSize` — published only, `published_at DESC`, list items carry no article body. An empty-string `category` param behaves as no-filter, not as an empty-slug match.
- `GET /api/blog/posts/:slug` — full article incl. `bodyMarkdown` and SEO fields; 404 unless published
- `GET /api/blog/categories`
- Published articles feed the user-app sitemap via a dedicated sitemap source (`apps/api/src/content/sitemap-blog.controller.ts`), same mechanism as salon profile pages, both wired into `apps/user-app/server/api/__sitemap__/` Nitro handlers consumed by `@nuxtjs/sitemap`. Cover images get public URLs the same way salon photos do. **Both sitemap sources are unbounded** (fetch-all, no pagination) — cap or paginate before either approaches practical XML-sitemap size limits.

User-app pages: `/blog` (SSR list — cover cards, category chips, pagination) and `/blog/[slug]` (SSR article with `useSeoMeta`, canonical URL, and JSON-LD `Article`). Both are public (unauthenticated) routes, joining `/salons/:slug` as the app's SEO surface. A post with neither `metaDescription` nor `excerpt` set emits no `description` meta tag at all — accepted rather than fabricating one. The article page also guards its whole template behind a root `v-if="post"` to sidestep a Suspense render-pass hazard around the not-found path; `salons/[slug].vue` and the booking page still use the older unguarded `page!` pattern and should get the same fix when next touched.

**The `html: false` safety invariant.** Posts store raw Markdown; nothing is sanitized because nothing needs to be. Both frontends render through their own three-line `markdown-it` utility configured `{ html: false, linkify: true }`, so raw HTML in a post body never parses into DOM — `<script>alert(1)</script>` and `<img src=x onerror=…>` come out escaped/inert, and each app's utility has an invariant test pinning exactly that (a config regression fails CI). The rendered output is bound with `v-html` in exactly two places (admin editor preview, user-app article body), each commented as sanctioned solely by this invariant. Do not loosen `html: false` or add a third `v-html` site without re-deciding the whole model.

**Deliberate cuts, recorded in the spec — not bugs:** no comments, likes, or any reader interaction; no scheduled publishing (publish is manual, no cron); a single category per post (no tags), no post revisions/history, byline is free text (no author user accounts); no RSS/Atom, no in-blog search, no related-posts logic; no editorial roles beyond the existing single `admin` role; and no redirect table — changing a published post's slug, or renaming a category without pinning its slug, or hard-deleting a post, all break previously indexed URLs, which is accepted for MVP (the editor hints at the slug case; unpublish is the soft path for posts).

**Other known rough edges from this plan — both since fixed:** creating a post with a manually-edited slug now sends the slug atomically in the create `POST` (`CreateBlogPostDto` accepts an optional `slug`); a 409 on a taken slug creates nothing, keeps the admin on the form with state intact, and shows a persistent inline error on the slug field (both create and edit modes). Storage best-effort deletes (salon photos and blog covers alike) remain fire-and-forget by design but now log every failure with the orphaned key and owning entity.

## Production deployment (Plan 9)

One VPS running `docker-compose.prod.yml`: the four app images (built and pushed to GHCR by CI, never built on the server), Postgres, Redis, and a Caddy reverse proxy with automatic HTTPS and baseline security headers. Full runbook, provider cutover checklist, and rollback steps: `docs/deployment/DEPLOY.md`. Design rationale: `docs/superpowers/specs/2026-07-11-plan-9-production-deployment-design.md`.
