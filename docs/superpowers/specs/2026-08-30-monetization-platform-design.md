# Monetization, Public Salon Links, Salon CRM & Subscription Platform — Design

Source: an owner request covering ~30 features across global payment control, public salon
links/QR, salon-managed customer SMS, a salon subscription/plan system with admin-configurable
entitlements, subscription coupons, salon CRM, and supporting dashboards. Full scope and every
constraint the owner specified are preserved in this repo's conversation history; this doc
records the Phase-A discovery findings and the phased build order the owner approved, so later
phases have a stable reference instead of re-deriving decisions already made.

## Phase-A discovery summary

Four parallel research passes (payment/config machinery; public salon URL/QR/attribution;
salon SMS/coupons/audit/CRM-adjacent; subscription-system existence check) confirmed:

- **No subscription/plan/entitlement/CRM system exists anywhere** in the codebase — this is
  genuinely new work, not duplication of something already built. The original design doc
  (`2026-07-04-gheychi-marketplace-design.md`) explicitly lists subscriptions as deferred
  future work.
- **The feature-flag machinery** (`PlatformConfigService`'s `FEATURE_FLAG_KEYS`/
  `getFeatureFlags()`, `AdminFeatureFlagsController`) is a zero-new-plumbing fit for a global
  admin toggle — used directly for Phase 1 below.
- **`salon.slug`** is already a DB-unique, non-nullable public identifier and `/salons/:slug`
  already renders a complete public profile with correct visibility gating — reusable
  directly as "the public link" rather than adding a parallel `/s/:handle` route (owner
  decision, see Phased plan below). It is not provider-editable today (absent from
  `UpdateSalonDto`, no edit path) and its generator always appends a random suffix (never a
  clean handle) — both need new work when that phase is built.
- **No QR library, no booking-attribution/source tracking, and no per-salon analytics
  column** exist. `AnalyticsService.track()` already accepts an arbitrary `properties`
  object, so attribution is cheap to add later; `analytics_events` needs a `salon_id` column
  before any salon-scoped funnel is buildable.
- **Salon-initiated customer SMS already has a working send path** (`createManualImpl` →
  `notifyConfirmed` → `SmsProvider`) — the real gap is a quota/usage layer, not a new send
  mechanism.
- **Subscription coupons need a genuinely separate entity from the booking `Coupon`** —
  `coupon_redemptions.booking_id` is `NOT NULL UNIQUE`, structurally a booking-redemption
  object; a subscription-period redemption doesn't fit without abusing that constraint. The
  row-locking *pattern* (`pessimistic_write` + count-under-lock) is reusable, the table isn't.
- **No Customer entity or salon-scoped aggregation endpoint exists** — "customer" today is
  only booking-attached `customerName`/`customerPhone` enrichment. `GET /salons/mine/earnings`
  is the one existing precedent for a real provider-side aggregation endpoint (commission-aware
  revenue rollup) — new CRM/dashboard endpoints should follow its guard/query-shape convention.

## Owner decisions (locked in before any phase's code was written)

1. **Billing activation**: architecture only for now (`Plan → Subscription → BillingPeriod →
   Invoice` shape, admin can manually mark a subscription paid/comp'd) — no real Zarinpal
   subscription-charge flow goes live in this initiative.
2. **Plan numbers**: every plan name, price, and per-plan limit (SMS quota, CRM caps, etc.)
   ships as an admin-editable placeholder, not a hardcoded business decision — matches the
   owner's own requirement that admin be the commercial-policy control plane.
3. **Public URL shape**: reuse `/salons/:slug`, made provider-editable and branded, rather than
   adding a parallel `/s/:handle` route — one routing/sitemap/canonical concept to maintain
   instead of two.

## Phased build order

Dependency-driven: the subscription/entitlement engine is the backbone several later phases
read from, so it's built before the features that will eventually be gated by it.

1. **Global payment toggle** — isolated, fast, closes a real admin lever immediately. ✅ shipped
   2026-08-30 (see `docs/technical-overview/29-global-payment-toggle.md`).
2. **Subscription/plan foundation** (`plans`, `salon_subscriptions`, entitlement-resolution
   service, admin plan CRUD, lifecycle states, migration backfill of a FREE subscription for
   every existing salon). ✅ shipped 2026-08-30, backend-only (see
   `docs/technical-overview/30-subscription-plan-foundation.md`).
3. Entitlement enforcement + admin override (with audit) + usage/plan dashboards (provider and
   admin sides), reading from the Phase 2 backbone.
4. Public handle + QR + attribution (`salon.slug` made provider-editable with reserved-word
   checking, client-side QR generation, `source` field threaded into
   `AnalyticsService.track('booking_started', ...)`).
5. Salon CRM (customer list/detail/notes, revenue dashboard with precise gross/collected/
   commission/estimated-revenue terminology, backed by a new aggregation endpoint following
   the `salons/mine/earnings` pattern; `analytics_events.salon_id` added here).
6. Salon SMS + quota (reuses the existing `notifyConfirmed`/`SmsProvider` send path; quota
   numbers read from the Phase 2/3 entitlement engine).
7. Subscription coupons + the remaining billing-architecture scaffolding — last, since it's
   explicitly the "don't overbuild" cluster.

Each phase gets its own implementation record under `docs/superpowers/plans/` (or a
`docs/technical-overview/` entry for a self-contained one like Phase 1) rather than one giant
combined write-up, matching this repo's per-plan documentation convention.
