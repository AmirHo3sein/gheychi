# 23 — Known Limitations

These are **deliberate** scope cuts — documented as such in code comments, the design specs under `docs/superpowers/specs/`, or the root `CLAUDE.md`/`README.md` — as distinct from unintentional gaps, which are catalogued in [24-technical-debt.md](./24-technical-debt.md). The distinction matters: don't "fix" something on this list without first confirming with the team whether the cut is still intentional.

## Payments

- **Payments run through `MockPaymentGateway` by default**; enabling real Zarinpal requires explicit env configuration and a sandbox-verified request/verify contract.
- **The refund contract is real but production-unverified**, and quite possibly implements a stale, de-documented Zarinpal API — see [11-payment-system.md](./11-payment-system.md). No sandbox exists to test refunds at all; a dedicated runbook (`docs/deployment/ZARINPAL-REFUND-VERIFICATION.md`) must be executed against production before refunds can be trusted.
- No live payout/settlement integration exists anywhere — every salon settlement is a manual bank transfer, recorded by an admin after the fact. See [14-commission.md](./14-commission.md).

## Reviews & moderation

- **Moderation is reactive, not pre-publish**: a review is `published` the instant it's created; there is no queue to clear before it's visible. An admin can only ever act after the fact, typically prompted by a report.

## Referrals

- No invite-token/link flow for workers — adding a worker requires already knowing a phone number that resolves via `findOrCreateByPhone`. The worker *is* SMS-notified when added ("you were added as staff by «salon», log in with this number"), but only once the salon is `approved`; there is no accept/decline step, the roster row exists the moment the owner adds it.
- Wallet balance is accrue-only from the platform's side, spend-only at checkout — there is no cash-out/withdrawal flow.
- No referral campaigns, tiers, or multi-level referrals.
- No IP/device fraud-signal capture beyond the redemption-eligibility rules already enforced.
- The one accepted non-reversible edge case: a discount-kind reward already redeemed on a distinct booking survives its qualifying booking's later refund — annotated for audit visibility (`reversal_reason`), not reversed, and deliberately not paged as an incident.
- Real reward amounts/percentages are an admin data-entry task, not a code change — every reward type ships `enabled=false` with placeholder values until an admin configures and enables it in `/referrals/settings`.

## Salon showcase (stories/portfolio)

- No video — images only.
- No cross-salon story feed.
- No view counts or server-side "seen" state (seen-tracking is client-side `localStorage` only, in `user-app`).
- Hardcoded TTL (24h) and caps (10 stories, 40 portfolio items) — not admin-configurable.
- No pre-publish moderation queue for showcase content.
- Named fast-follow (not built): a before/after work-sample comparison slider.

## Blog / content CMS

- No comments, likes, or reader interaction.
- No scheduled publishing — publish is a manual action, no cron.
- A single category per post (no tags).
- No post revisions/history.
- Byline is free text — no author user accounts.
- No RSS/Atom feed, no in-blog search, no related-posts logic.
- No redirect table — changing a published post's slug, renaming a category without pinning its slug, or hard-deleting a post all break previously-indexed URLs. Accepted for MVP; the editor warns on the slug-change case, unpublish is the soft-removal path for posts.

## Admin panel

- The salon-side effect of a user-suspension cascade has no separate audit row (only the `user.status.set` row exists) — reconstructing a salon's status timeline purely from audit rows has this gap, by design.
- Featured/ad placement is a boolean + optional expiry set directly by an admin — no bidding, no priority tiers, no self-serve payment flow.

## Search

- No `city`-name filter parameter — search is purely geographic (point + radius); a city selection in any frontend resolves to that city's lat/lng and is passed through as the search origin.
- Cursor-paginated (`{items, nextCursor, hasMore}`, 50/page default) with a 1000-row safety ceiling (`MAX_FETCH_ROWS`) past which `hasMore` is forced `false` rather than continuing indefinitely — not the flat, unpaginated 50-result hard cap this used to be (see also [22-performance.md](./22-performance.md)).

## Deployment & operations

- Migrations are never run automatically — always a manual `docker compose exec api pnpm migration:run` step, by design (avoids an unreviewed schema change firing on every container restart).
- Daily full Postgres backups only — no point-in-time recovery (WAL archiving), an accepted up-to-24h data-loss window.
- Backup-failure alerting is in place (`backup.sh` `report_backup()` → `POST /api/internal/backup-report` → `AlertsService` `backup-failed`, plus the 4-hourly `BackupStalenessCheckJob` raising `backup-stale` when no success has landed in 27h — see [18-background-jobs.md](./18-background-jobs.md)); the remaining cut is that the reporting POST is best-effort and never flips a successful backup's own exit code, and there is no restore drill automation — restore is a documented manual procedure in `docs/deployment/DEPLOY.md`.
- Uploaded images in production (`STORAGE_PROVIDER=local`) live on a single named Docker volume (`api_uploads`) on the one host — no S3 replication, so the daily Postgres dump does not cover them; losing the host loses the images.

## General

- No i18n — the entire platform (all three frontends) is Persian/RTL only, by explicit product decision, not an oversight.
- No Swagger/OpenAPI — [15-api-reference.md](./15-api-reference.md) is the API's only contract document.
- No shared code package between the three frontend apps — every duplicated file carries an explicit "cross-app isolation" rationale (see [24-technical-debt.md](./24-technical-debt.md) for the cost side of this decision).

## Related documents

- [24-technical-debt.md](./24-technical-debt.md) — gaps that look unintentional rather than deliberate
- [25-future-improvements.md](./25-future-improvements.md) — reserved seams already visible in the schema/code for several of the items above

## Closed 2026-09-03 (production-hardening sprint)

Previously listed here, now genuinely implemented — do not re-report these as gaps:

- **Rescheduling exists.** Both customer- and salon-initiated; see
  [09-booking-engine.md](./09-booking-engine.md).
- **Admin bookings list exists** (`GET /admin/bookings`, read-only) with a real admin-panel
  page, which finally makes the booking timeline reachable without hand-typing a UUID.
- **A provider is now told about a new booking request** while sitting in the panel
  (visibility-aware polling with new-request detection). Still polling, not push:
  provider-panel is a plain SPA with no service worker, so `POST /push/subscribe` is never
  called for an owner and every owner-directed push resolves to zero subscriptions. Adding
  a service worker there remains the real fix.
- **Salon handles survive a rename** (history + permanent redirect + reservation).
- **A salon owner can see their own referral code and wallet** from the provider panel.
- **Uploaded files are backed up.**
- **The frontends report production errors.**

## Still open, deliberately

- **Provider push** — see above; polling only, and only while the panel is open.
- **Redis has no `requirepass`.** Not publicly exposed, but a compromised sibling container
  on the internal Docker network can read live OTP codes.
- **Every container receives the full shared `.env`**, so user-app's SSR process and Caddy
  hold credentials they never use.
- **Subscription billing remains architecture-only** — no plan billing interval (the column
  is literally `monthly_price_toman`, so a quarterly period silently bills one month), no
  applicable-plans restriction on subscription coupons, and no real charge flow. Unchanged
  by this sprint and still the owner's explicit decision.
- **Entitlement keys beyond `smsMonthlyQuota` are registered but not enforced** — the
  registry ships them with behaviour-preserving defaults, so gating any one of them is now a
  one-line change at the point of use rather than a design question. See
  [35-entitlement-engine.md](./35-entitlement-engine.md).
- **The salon-page JSON-LD is still thin** (`url`, `image`, `geo`, opening hours). A
  ready-to-apply snippet is in the sprint report; `telephone` is impossible — `Salon` has no
  phone column.

