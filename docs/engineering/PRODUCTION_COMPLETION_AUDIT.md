# Production Completion Audit — 2026-09-03

A gap analysis of Gheychi against a production-readiness checklist, performed before any
code was written for this sprint. Every classification below was reached by reading the
code, not the documentation; where the two disagreed, the code won and the doc was fixed.

**Scope note.** This audit covers the working tree as of 2026-09-03, which already contains
an earlier same-day audit-and-fix pass (secrets scrub, commission-on-captured-money, wallet
reversal on flag-off approval, OTP verify scoping, route-guard test hardening, uploads
volume, ~28 frontend fixes). Those are recorded as COMPLETE here with a note, not
re-litigated.

**Legend.** COMPLETE · PARTIALLY IMPLEMENTED · MISSING · BUGGY · DOCUMENTATION ONLY ·
INTENTIONALLY LIMITED (a recorded product decision — not a defect, and not "fixed" here
unless this sprint explicitly asked for it).

---

## Summary table

| # | Area | Verdict | Sev | Action this sprint |
|---|---|---|---|---|
| A | Booking lifecycle (automatic) | COMPLETE | — | none |
| B | Manual booking approval | COMPLETE | — | none |
| C | Automatic booking mode | COMPLETE | — | none |
| D | Online payment toggle | PARTIALLY IMPLEMENTED | P1 | gate `retryPayment`, fix event-reason lie, document open-window policy |
| E | Payment lifecycle | PARTIALLY IMPLEMENTED | P1 | reconciliation-confirmed bookings notify nobody |
| F | Refund lifecycle | BUGGY | P1 | double gateway call under concurrency |
| G | No-show handling | BUGGY → fixed | P0 | grace period added |
| H | Cancellation rules | BUGGY → fixed | P0 | forfeited-deposit commission made consistent |
| I | Rescheduling | MISSING | P1 | implement |
| J | Booking notifications | PARTIALLY IMPLEMENTED | P1 | no-show + reconciliation-confirm gaps |
| K | Provider booking visibility | PARTIALLY IMPLEMENTED | P1 | implement polling |
| L | Admin booking management | PARTIALLY IMPLEMENTED | P1 | implement list/search |
| M | Salon public handles | COMPLETE | P2 | entitlement gate only |
| N | QR codes | BUGGY | P1 | empty-env-var fallback |
| O | Handle rename behavior | MISSING | P0 | history + 301 + reservation |
| P | Subscription plans | COMPLETE | P1 | no billing-interval dimension |
| Q | Subscription entitlements | PARTIALLY IMPLEMENTED | P1 | capability engine; 1 of N keys enforced |
| R | Subscription discounts | INTENTIONALLY LIMITED | P2 | applicable-plans gap |
| S | Provider CRM | PARTIALLY IMPLEMENTED | P1 | no search/filter/pagination |
| T | Provider analytics | PARTIALLY IMPLEMENTED | P1 | most metrics missing; earnings mislabelled |
| U | Per-salon funnel | MISSING | P1 | 2 of 8 stages instrumented |
| V | Customer management | PARTIALLY IMPLEMENTED | P1 | creation works; discovery doesn't |
| W | SMS sending + quotas | PARTIALLY IMPLEMENTED | P1 | two unmetered provider-triggerable paths |
| X | Referral/wallet provider visibility | INTENTIONALLY LIMITED | P1 | sprint overrides the prior decision |
| Y | Audit logs | COMPLETE | — | none |
| Z | Security | PARTIALLY IMPLEMENTED | P1 | session revocation, Redis auth, metrics exposure |
| AA | Backups | PARTIALLY IMPLEMENTED | P1 | uploads not backed up at all |
| AB | Observability | PARTIALLY IMPLEMENTED | P1 | zero frontend error reporting |
| AC | Cron/job safety | PARTIALLY IMPLEMENTED | P1 | lock has no owner token |
| AD | SEO | PARTIALLY IMPLEMENTED | P0 | no canonicals, no crawlable listing |
| AE | Deployment safety | PARTIALLY IMPLEMENTED | P2 | shared `.env`, missing healthchecks |

---

## A–C. Booking lifecycle, manual approval, automatic mode — COMPLETE

Both modes are fully implemented with genuine compare-and-swap discipline. Every state
transition except two (see AC) conditions its `UPDATE` on the exact status read, so a
losing concurrent caller gets a 409 rather than silently overwriting. Deadlines
(`approval_expires_at`, `payment_expires_at`) are snapshotted at the instant they start and
never recomputed from live config. `approve()` re-checks availability under the same
per-salon Redis lock `createHold` uses, and auto-expires the request in the same
transaction when the re-check fails. `booking_events` gives every transition an append-only
timeline.

**Timing configuration is correct and correctly fenced.** Global
`booking_approval_timeout_minutes` (seeded **10**) and `booking_hold_ttl_minutes`, both
admin-only via `PATCH /admin/config`; per-salon `approval_timeout_minutes` /
`payment_timeout_minutes` overrides via `PATCH /admin/salons/:id/booking-settings` (audited,
`null` = inherit). `UpdateSalonDto` carries only `bookingConfirmationMode`, so the salon
owner picks the mode and nothing else — the blanket `Object.assign` in `updateMine` cannot
escalate into a timeout field because those fields are absent from the DTO by design.

No action.

## D. Online payment toggle — PARTIALLY IMPLEMENTED (P1)

The flag is read live at exactly two sites: `createHold` and `approve()`. What that covers
and what it doesn't:

| In-flight state | ON→OFF | OFF→ON |
|---|---|---|
| `pending_approval` | **Handled.** `approve()` re-reads the flag, confirms outright, and reverses any staked wallet debit. | **Not handled (P2).** The customer submitted under cash-at-salon copy and is now sent to a payment window. |
| `pending_payment` with a live authority | **Not handled (P1).** `retryPayment` mints a *fresh* authority with no flag check, and `handleCallback` still captures → `paid` → `confirmed` → commission accrues. "Collection is off platform-wide" is false for every already-open window. | n/a |
| `confirmed`-unpaid | **Complete.** Nothing retroactively creates a Payment. | **Complete.** |
| `confirmed`-paid | **Complete.** Refund paths never consult the flag — correct; refunding must never be gated. | no-op |

Secondary: the flag-off `approve()` path records `BOOKING_CONFIRMED` with
`metadata.reason = 'zero_deposit'` even when `depositAmount > 0` — the admin timeline
states a false reason.

**Chosen policy (this sprint):** an already-open payment window is allowed to complete.
Blocking a customer mid-redirect after they have been sent to Zarinpal is worse than
honouring the window they were given, and the deadline snapshot already retires unpaid ones.
What changes: `retryPayment` refuses to mint a *new* authority while collection is off,
the user-app hides the retry action, and the event reason tells the truth.

## E. Payment lifecycle — PARTIALLY IMPLEMENTED (P1)

`initiated → paid | failed`, callback capture, retry, and the reconciliation sweep are all
CAS-guarded and correct. **The gap:** when `PaymentReconciliationJob` is the one that
discovers a successful payment (the callback never arrived — the exact case the job exists
for), it flips the booking to `confirmed` but calls no notification and writes no
`booking_events` row. The customer paid, the booking is real, and neither party is told;
the timeline shows a booking that became confirmed by magic.

## F. Refund lifecycle — BUGGY (P1)

Refunds are real and the retry/escalation machinery is sound. But `attemptRefund` reads the
payment **without a row lock**, calls `gateway.refundPayment(...)`, and only then CASes the
status. Two API replicas — or the 5-minute cron racing the inline attempt from `cancel()` —
can both pass the read and both call Zarinpal. The database stays consistent (the loser's
CAS affects zero rows), but the external money API is asked to refund twice, and CLAUDE.md
records that Zarinpal permits **one** refund request per transaction and that the contract
is production-unverified. The in-code comment calling this "harmless, idempotent" is an
untested external assumption, not a fact.

## G. No-show handling — BUGGY → **fixed in this sprint** (P0)

`updateStatus` accepted `no_show` on any confirmed booking, **including one days in the
future**. A salon could forfeit a customer's deposit the moment it was captured; because
`no_show` is not a cancellable status, the customer then had no route to a refund they were
still inside their cancellation window for.

Fixed: `no_show_grace_minutes` platform config (seeded **30**, admin-only, `0..1440`), and
`updateStatus` refuses a no-show until `startsAt + grace`. Completion is deliberately *not*
time-guarded — closing out early is legitimate and non-punitive. The grace period is
platform-wide and never salon-editable, because it is the customer's protection *against*
the salon.

## H. Cancellation rules — BUGGY → **fixed in this sprint** (P0)

The design spec has always said: *"user cancels late, or no-show → forfeited → paid to salon
minus platform commission."* Only the no-show half was implemented. A late
`cancelled_by_user` left the payment `paid` (forfeited) but wrote **no**
`financial_transactions` row — so the platform kept 100% of every late-cancellation
deposit, and the salon's invoice and earnings never showed the money at all.

**Chosen rule (consistent, now implemented):** *any* forfeited deposit accrues commission,
whether it was forfeited by a no-show or by a late cancellation. Refunded cancellations
accrue nothing. Written inside the same transaction as the status flip, exactly like the
no-show path. Code, tests, and documentation now all state this one rule.

## I. Rescheduling — MISSING (P1)

No reschedule path exists anywhere: no route, no DTO, no service method, no UI. `startsAt`
is written only at insert. The only recourse today is cancel → refund → rebook, which for a
within-window cancellation forfeits the customer's deposit through no fault of their own.

## J. Booking notifications — PARTIALLY IMPLEMENTED (P1)

Most of the matrix is well-considered, including several deliberate SMS-budget decisions
(customer silent on request-created because they are on screen; automatic-mode payment
expiry silent; no owner reminder before the approval deadline). Real gaps:

- **No-show: the customer is never told.** Their deposit is forfeited and commission
  accrues, in silence. Now that a late cancellation also forfeits, this asymmetry matters
  more.
- **Reconciliation-confirmed: nobody is told** (see E).
- **Approval expired / payment expired: the salon is never told** a slot freed up.

## K. Provider booking visibility — PARTIALLY IMPLEMENTED (P1)

A salon owner sitting in the provider panel **never learns a new booking request arrived.**
`BookingsView` fetches once on mount; its only `setInterval` is a 60-second clock tick for
countdown labels and does not refetch. There is no `visibilitychange` handler, no
websocket, and no push — provider-panel is a plain Vite SPA with no service worker, so
`POST /push/subscribe` is never called for an owner and every owner-directed push resolves
to zero subscriptions. Against a **10-minute** approval window, the only channel that
actually reaches an owner is one SMS.

## L. Admin booking management — PARTIALLY IMPLEMENTED (P1)

There is no `GET /admin/bookings` list/search/filter endpoint at all. `BookingTimelineView`
exists and works, but nothing links to it — an admin can only reach it by hand-typing a
booking UUID obtained from outside the product. Handling a dispute or a stuck
`refund_pending` is effectively impossible from the admin panel.

No new columns are needed: customer/salon/service/worker names, time, mode, payment state,
amount, deposit, commission, refund state and approval history are all already joinable.

## M. Salon public handles — COMPLETE (P2 gap)

Provider-editable with real server-side validation (`3..40`, `^[a-z0-9]+(-[a-z0-9]+)*$`),
a 25-entry reserved-word list including the genuine `mine` route collision, DB-unique
collision safety translated to a clean 409 (no TOCTOU), an audited admin override, and
deliberate exclusion from `UpdateSalonDto`. **Gap:** no entitlement gate — every salon on
the free plan can set any handle, though the monetization spec lists custom-handle access
as a paid capability. No rate limit on handle churn.

## N. QR codes — BUGGY (P1)

Client-side generation via the `qrcode` package, encoding
`${CUSTOMER_APP_BASE}/salons/${slug}?source=qr` — canonical and attribution-carrying.
**Bug:** `import.meta.env.VITE_CUSTOMER_APP_BASE ?? 'http://localhost:3003'` uses `??`,
which does not catch an **empty string**. CI passes the value from a repo variable; if that
variable is unset it expands to `''`, overriding the Dockerfile default, and every QR code
silently encodes a relative URL. Unscannable, no build failure, and the artifacts are
physically printed and cannot be recalled.

## O. Handle rename behavior — MISSING (P0)

`updateHandle` is a bare `repo.update` — the old handle is overwritten and lost. There is no
history table, no reservation, and no redirect anywhere.

1. Every printed QR code and shared link dies the instant an owner renames — the exact
   artifact the feature exists to produce.
2. **The freed handle is immediately claimable by any other salon.** A competitor can take
   it and inherit all existing printed-QR and link traffic. This is a live hijack vector,
   not a theoretical one: handles are guessable and a rename is publicly observable.
3. The indexed URL 404s with no 301.

## P. Subscription plans — COMPLETE (P1 dimension missing)

Full admin CRUD with correct default-plan invariants (cannot unset the only default, cannot
have an inactive default, moving the default unsets others atomically, delete refuses the
default, DB partial-unique backstop). **Plan names/keys are not hardcoded in business logic
anywhere** — verified by grep across the API and all three panels; the only hits are doc
comments.

**Gap:** there is no billing-period/interval concept. The column is literally
`monthly_price_toman` and `createPeriod` bills it regardless of the admin-supplied period
length, so a quarterly or annual period silently bills one month.

## Q. Subscription entitlements — PARTIALLY IMPLEMENTED (P1)

`getEntitlements` resolves the plan's open JSON bag with the per-salon override merged on
top, falling back to the default plan when canceled/missing. Precedence is correct and
tested.

**But exactly one key is enforced anywhere: `smsMonthlyQuota`.** `crmCustomerCap` exists
only in a test fixture; custom-handle access and QR access are named in the entity's own doc
comment and in the spec, and read by nothing. There is no `hasEntitlement` / `getLimit` /
`consumeQuota` abstraction — one ad-hoc `Record<string, unknown>` read plus a hand-rolled
type check, with quota-consumption logic living inside the consuming service. Adding a
second gated feature today means copy-pasting that shape.

This is the seam the entire monetization initiative was built to enable, and it is 1-for-N
wired.

## R. Subscription discounts — INTENTIONALLY LIMITED (P2)

Percent-only by design, with correct row-locked cap enforcement, per-salon uniqueness, and
no negative-price path. Missing versus a full discount system: fixed-amount, validity
*start* date, **applicable-plans restriction** (a "50% off Premium" code equally discounts a
Free upgrade), and minimum conditions. Acceptable while billing is architecture-only; P1 the
moment subscriptions are actually charged.

## S–V. CRM, analytics, funnel, customer management — PARTIALLY IMPLEMENTED (P1)

**What works.** Customer list/detail/notes with ownership isolation expressed as the query
shape itself. Financial terminology is honest and correctly separated: `grossBookingValue`
(scheduled) vs `onlineCollected` (real payments) vs `commission` (frozen ledger) vs
`estimatedSalonRevenue` (labelled "تخمینی" because the cash portion is unobservable). A
salon owner **can** create a customer and appointment (`POST /salons/mine/bookings`), with
real phone validation, duplicate avoidance via `findOrCreateByPhone`, the same overlap and
worker-eligibility checks as online booking under the same Redis lock, and a confirmation
SMS carrying salon name, time and address.

**Gaps.**
- **No search, no filters, no sort, no pagination** on the customer list — client *or* API.
  A salon with hundreds of customers cannot find one.
- `lastVisitAt` is `MAX(starts_at)` including *future* bookings, so "last visit" can be a
  date that has not happened. There is no `firstVisitAt` at all.
- `DashboardView` shows **no metrics whatsoever** — only today's bookings and quick links.
  It never calls the summary endpoint that exists.
- Missing metrics: new/returning customer counts, completed/cancelled/no-show counts,
  average booking value, top services, top workers, busiest days, busiest hours,
  retention rate, month-over-month.
- **`EarningsView` mislabels deposits as revenue.** `totalCollected` ("مجموع دریافتی") is
  `SUM(financial_transactions.gross_amount)` — the online **deposit** only, and only for
  bookings that reached completed/no-show. Nothing in the UI says "deposit", so a salon
  reading this screen under-reads its revenue and cannot tell why it disagrees with the CRM
  tile.
- **Funnel: 2 of 8 stages are instrumented.** No events for profile views, booking requests,
  approvals/rejections, completion, or reviews; `payment_succeeded` carries no `salonId` so
  it is unusable per-salon. `analytics_events.salon_id` is written, indexed, and **read by
  nothing**.

## W. SMS sending + quotas — PARTIALLY IMPLEMENTED (P1)

Quota mechanics are correct where they apply: Jalali-month reset, derived usage from an
append-only log (no counter drift), missing entitlement → 0 (blocked, not unlimited), and
check → send → log ordering so a **failed send never consumes quota**.

**But two provider-triggerable send paths are entirely unmetered**, so per-salon SMS spend
is not actually bounded:
- `POST /salons/mine/workers` — an approved salon can loop add/delete/re-add for unlimited
  platform-paid SMS to arbitrary phones.
- `POST /salons/mine/bookings` — a confirmation SMS to any phone, unlimited.

There is no rate limiting anywhere in the API outside the OTP path. The metered path's own
check-then-insert race is a documented, accepted cut on its own — but it compounds here.

## X. Referral / wallet provider visibility — INTENTIONALLY LIMITED → in scope this sprint

The backend fully supports a `salon_owner` referrer type, and the endpoints are
role-agnostic. The provider panel has no referral or wallet surface at all; the referral
spec records this as a deliberate decision (*"the owner's own code and wallet live in the
user-app, same as a customer's — they're a `User` too"*). **This sprint's brief explicitly
asks for it (§20), which overrides that earlier decision.** No new backend work is required;
the privacy constraint is that a provider-side view must show counts, statuses and reward
amounts, never a referred customer's identity beyond what the CRM already grants.

## Y. Audit logs — COMPLETE

Declarative `@AuditAction` on every admin mutation, enforced by a wiring spec, browsable in
the admin panel, with `booking_events` as the separate non-admin lifecycle log. The known
gap (a cascaded salon suspension writes no separate row) is recorded and deliberate.

## Z. Security — PARTIALLY IMPLEMENTED (P1)

**Clean:** no hardcoded secrets remain in the working tree (100% of credential-bearing
config keys are in `.env.example`); no template-string SQL anywhere; every upload endpoint
sniffs real bytes; cookies are HttpOnly/SameSite/Secure-in-prod; `trust proxy 1` matches the
single Caddy hop. **Authorization is genuinely solid** — all 30 non-admin `:id` handlers
were traced to their DB lookup and every one scopes by `req.salonId` or `req.user.id`; the
route-guard spec now pins `RolesGuard` on every `admin/*` route and `SalonOwnerGuard` on
every `salons/mine*` route.

**Open:**
- **Session revocation is missing (P1).** 30-day JWTs with no `jti`; logout only clears the
  cookie, so a stolen token stays valid for up to a month. Mitigating: `AuthGuard` reloads
  the user and re-checks suspension on every request, so admin suspension *is* live.
- **Redis has no `requirepass` (P2).** Not publicly exposed, but any compromised sibling
  container on the internal network can read **live OTP codes** — a full account-takeover
  primitive — and delete cron/booking locks.
- **`/api/metrics` is publicly reachable (P1).** `@Public()` plus a catch-all Caddy proxy
  with no path exclusion leaks booking/payment/revenue volume to anyone. The Prometheus
  config comment claiming it is internal-only is factually wrong.
- **`ConsoleSmsProvider` is the silent fallback for an unrecognized `SMS_PROVIDER` and logs
  OTP codes ungated (P1).** A typo'd env var in production prints every login OTP to stdout
  while login still appears to work.
- Minor (P2): `POST /push/subscribe` re-points a subscription by endpoint with no ownership
  filter; `POST /salons/:id/favorite` 500s on a nonexistent salon instead of 404.

## AA. Backups — PARTIALLY IMPLEMENTED (P1)

The Postgres side is genuinely strong: custom-format dump, a minimum-size sanity check, an
`mc stat` byte-for-byte upload verification (catching partial uploads `mc cp`'s exit code
misses), 14-day retention, two-layer alerting (per-run report plus an independent staleness
cron), and a restore procedure that was actually exercised rather than merely written.

**Uploaded files are not backed up at all.** Production runs `STORAGE_PROVIDER=local`, so
every salon photo, story, portfolio image and blog cover lives only in the `api_uploads`
volume. Losing the VPS means permanently losing every uploaded image while the database rows
survive pointing at 404s. S3 is fully implemented and switchable by env, but cutover needs a
data migration and a CSP change.

## AB. Observability — PARTIALLY IMPLEMENTED (P1)

Strong: request correlation IDs propagate into services and jobs via `AsyncLocalStorage`; 22
Prometheus metrics; `AlertsService` pages on every cron/refund/payment/backup failure; no
log path leaks JWTs, cookies, OTPs, or payment secrets.

**Frontend error reporting is entirely absent in all three apps** — no reporter dependency,
no `error.vue`, no `app.config.errorHandler`, no `window.onerror`. A white-screen crash in
production is completely invisible. Separately, `SENTRY_DSN`/`ERROR_TRACKING_PROVIDER` do
not appear in the production compose file, so even the backend silently runs the logger
provider.

## AC. Cron / job safety — PARTIALLY IMPLEMENTED (P1)

All 11 jobs go through `CronJobRunner` → `CronLockService` with universal failure alerting,
and the idempotency review found no job that corrupts money state on a duplicate run.

**Two structural findings:**
1. **`CronLockService` has no owner token (P1).** It acquires with `SET NX PX` then does a
   blind `DEL` in `finally`. A replica whose lock expired mid-run **deletes its successor's
   lock**, permitting a third concurrent run. The booking lock already solved exactly this
   with a compare-and-delete Lua script; the cron lock never got parity.
2. **`refund-retry` is the one path where a duplicate run reaches an external money API**
   (see F).

Also (P2): the referral-expiry `UPDATE` puts its status predicate only in the subquery, so
under READ COMMITTED a just-granted referral can be stamped `expired`; and
`partially_granted` referrals past their expiry are never expired at all, contradicting the
docs.

## AD. SEO — PARTIALLY IMPLEMENTED (P0)

**Exclusion is airtight** — sitemap sources and canonical pages both filter to
approved/published via live per-request queries, so a suspension drops out on the next
crawl. Sitemap infrastructure is production-grade (real multi-file index, 5,000/page,
absolute URLs).

**But:**
- **Canonical URLs are missing on every page except blog articles**, including the salon
  profile — and the blog list generates `?category=`/`?page=` variants with no canonical
  signal.
- **There is no crawlable discovery path to any salon page.** Home-page results load
  client-side and are hard-gated on login (search needs a session-derived gender), so an
  anonymous crawler sees a home page with **zero salon links**. The sitemap is the only
  entry channel; `robots.txt`'s `Allow: /salons/` points at a route with no listing page.
- `robots.txt`'s `Sitemap:` line is relative (Google ignores that); `/account/` is not
  disallowed; both panels are fully crawlable with no `robots.txt` or `X-Robots-Tag`.
- `BeautySalon` JSON-LD omits `url`, `image`, `geo`, `telephone`, and opening hours — all of
  which the page has already loaded.

## AE. Deployment safety — PARTIALLY IMPLEMENTED (P2)

Strong: real resource ceilings on every service, only Caddy publishes ports, Grafana is
loopback-bound, api/user-app run non-root, Caddy applies HSTS/nosniff/DENY/Referrer-Policy
plus per-site Report-Only CSP, and the migration-before-restart ordering is correct and
documented with a revert-first rollback path.

Open: every container receives the full shared `.env` (user-app SSR and Caddy can read
`JWT_SECRET`, Zarinpal and S3 credentials they never need); healthchecks exist only on
postgres and api; both nginx panel images run as root; no `cap_drop`/`no-new-privileges`.

---

## Risks and dependencies for the implementation phase

- **Money-path changes must not regress refund correctness.** The refund claim fix (F) must
  release its claim on gateway failure, or `RefundRetryJob`'s whole reason for existing —
  and its 24-hour human escalation — is defeated. This is the single highest-risk change in
  the sprint.
- **The forfeiture rule change (H) alters financial semantics**, deliberately and per the
  spec. It is additive (a ledger row that was previously absent) and cannot retroactively
  alter existing rows, but salon-visible earnings will increase for salons with historical
  late cancellations *going forward only*.
- **Handle history (O) is a one-way door**: once handles are reserved permanently, releasing
  them later is a policy change, not a rollback.
- **Entitlement enforcement (Q) can lock existing salons out of features they use today.**
  Every key must ship with a default that preserves current behaviour, and the backfill must
  be explicit — the SMS-quota migration's `20`-for-everyone precedent is the model.
- **Rescheduling (I) must not become a free late-cancellation escape hatch**; the
  cancellation window has to be evaluated against the *original* start time.

---

# Implementation record (2026-09-03)

What actually shipped against the audit above. Every item was verified by running the real
suites, not by inspection.

## P0

| Area | Change |
|---|---|
| G | `no_show_grace_minutes` (platform config, seeded 30, admin-only). A no-show cannot be recorded before `startsAt + grace`. Completion stays un-guarded. |
| H | **One forfeiture rule**: any forfeited deposit accrues commission, late-cancellation or no-show, written in the same transaction as the status flip. |
| D | `retry-payment` refuses to mint a new gateway session while collection is off; an already-open window is honoured (documented policy). `booking_events` records `online_payment_disabled` instead of a false `zero_deposit`. |
| O | `salon_slug_history` — the old handle redirects permanently (301, query string preserved so `?source=qr` attribution survives) and stays reserved against any other salon. Admin may override, audited. |
| Z | Session revocation (`jti` + Redis denylist, fail-closed, legacy tokens degrade rather than force-logout). |
| AA | Uploads mirrored to S3 from a read-only mount; restore documented. |
| AD | Crawlable SSR salon listing (`/salons`), canonicals, absolute `Sitemap:`, `Disallow: /account/`, both panels `noindex`. |

## P1

| Area | Change |
|---|---|
| E, J | Reconciliation-confirmed bookings now notify both parties and record `PAYMENT_SUCCEEDED`/`BOOKING_CONFIRMED`. A no-show now notifies the customer. |
| F, AC | Refund claimed **before** the gateway call (TTL'd, released on failure); cron lock given an owner token via a shared compare-and-delete helper; referral-expiry CAS moved to the outer `WHERE`. |
| I | Rescheduling, customer- and salon-initiated, with the cancellation window measured against the **original** start so it cannot become a late-cancel escape hatch. |
| K | Visibility-aware polling in the provider panel with new-request detection, quiet degradation, and mutation safety. |
| L | `GET /admin/bookings` (read-only, filterable, single query) plus an admin page — the booking timeline is finally reachable. |
| N | `??` → empty-string-safe `buildEnv` at all three build-env sites (an unset CI variable was baking unscannable QR codes). |
| Q | Entitlement engine: key registry with per-key absent-defaults + `hasFeature`/`getLimit`/`getQuota`. SMS quota migrated onto it. |
| S, T, U, V | CRM search/filter/sort/pagination with escaped `LIKE`; corrected visit semantics + `firstVisitAt`; a real dashboard with previous-period comparison; honest deposit labelling; `GET /salons/mine/funnel`. |
| W | All three salon-triggered SMS paths metered through one seam. |
| X | Owner referral + wallet surface in the provider panel (counts and amounts only, never a referred customer's identity). |
| Z | Production SMS fail-fast; `/api/metrics` blocked at the edge; push-subscribe IDOR closed; favourite 404 instead of 500; route-guard spec hardened to exact controller count + per-actor guard pinning. |
| AB | Frontend error reporting in all three apps, inert without a DSN, PII-scrubbed. |

## Deliberately not done

- **Push for providers** (K) — polling only. Needs a service worker in provider-panel; the
  backend half already works for any role.
- **Plan billing interval, subscription-coupon applicable-plans, admin subscriber list**
  (P, R) — billing remains architecture-only by the owner's own standing decision, and
  these only become load-bearing when real charging goes live.
- **Entitlement keys beyond the SMS quota** (Q) — registered with behaviour-preserving
  defaults so gating any one is now a one-line change, but gating them now would revoke
  capabilities live salons have today.
- **Redis `requirepass`, per-service `.env` scoping** (Z, AE) — infrastructure changes that
  need a coordinated deploy, tracked in `24-technical-debt.md`.
- **Salon-page JSON-LD enrichment** (AD) — snippet prepared; `telephone` is impossible
  because `Salon` has no phone column.

