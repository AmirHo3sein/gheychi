# Phase O — Product Analytics Strategy (Draft)

**Status: draft with explicit placeholders, not an approved plan.** Per the user's own choice when this production-readiness initiative began ("draft documents with explicit placeholders" for the strategic phases), this document proposes an approach and flags every decision that needs product/business sign-off before any of it is implemented. Nothing in this phase touched application code.

## 1. Current state (verified, not assumed)

A direct audit of the codebase before drafting this confirmed:

- **No analytics SDK anywhere.** No PostHog, Mixpanel, Amplitude, GA/gtag, Plausible, Segment, or Hotjar in any of the four apps' dependencies.
- **No event-tracking code anywhere** in `apps/api`, `apps/user-app`, `apps/provider-panel`, or `apps/admin-panel`.
- **`apps/api/src/audit/`'s `AuditLog` is a security/compliance audit trail, not a product-analytics source.** It only fires on admin mutation endpoints (`@AuditAction()` + `AuditInterceptor`, applied to `admin-*` controllers only) — it captures "which admin did what," never a customer's or provider's behavioral path through the app (search, browse, booking funnel steps, drop-offs).
- **No privacy policy, cookie-consent banner, or consent-management code** in any frontend app.
- Prior specs (`docs/superpowers/specs/2026-07-16-money-critical-alerting-design.md`, `2026-07-11-plan-9-production-deployment-design.md`) already explicitly deferred "metrics/dashboards" and APM as future work — this phase is that deferred work, now being scoped.

This is a genuine blank slate, not a gap-filling exercise on top of partial infrastructure.

## 2. Why this matters for this business

Gheychi is a two-sided marketplace (customers booking, salons fulfilling) with a real payment funnel (Zarinpal deposits) and a referral/growth loop already built. Without product analytics, the business currently cannot answer, with data:

- Where customers drop off between search → salon page → slot selection → payment (`user-app`'s booking flow).
- Whether the referral system (already shipped, Slice 6) is actually driving net-new signups vs. cannibalizing organic ones.
- Which salon categories/cities have supply-demand mismatches (search volume vs. bookable salons).
- Provider-side engagement: do onboarded salons actually keep their calendars/services updated, or churn silently after signup?
- Whether featured/ad-boosted salon placements (already built, `is_featured`) convert at a meaningfully different rate than organic results — the actual business case for that feature.

## 3. Proposed event taxonomy (draft — needs product review)

A minimal funnel-shaped taxonomy, not an exhaustive "track everything" list — over-instrumenting up front tends to produce noise nobody looks at.

**Customer funnel (user-app):**
`search_performed` → `salon_viewed` → `service_selected` → `slot_selected` → `booking_hold_created` → `payment_initiated` → `payment_succeeded` / `payment_failed` → `booking_completed` / `booking_cancelled`

**Growth loop:**
`referral_code_shared`, `referral_code_redeemed`, `referral_reward_granted`

**Provider funnel (provider-panel):**
`onboarding_started` → `onboarding_step_completed` (per step) → `salon_submitted` → `salon_approved` → `first_service_added` → `first_booking_received`

**Retention (both sides, computed from existing data, not necessarily a new "event"):** repeat-booking rate, provider weekly-active (calendar/services touched), can likely be derived from existing `bookings`/`salon_services` timestamps without any new instrumentation at all — worth building as SQL/dashboard queries against the existing schema **before** standing up a whole new event pipeline. This is the cheapest, lowest-risk starting point and doesn't require a placeholder decision below.

## 4. Where events should originate — a real architectural decision, not just a tool choice

Money-critical funnel steps (`payment_initiated`, `payment_succeeded`, `booking_completed`) should be emitted **server-side**, from the same code paths that already own that business logic (`BookingsService`, `PaymentsService`) — not from frontend JavaScript, which ad blockers and privacy extensions routinely block, and which cannot be trusted for anything the business will actually make decisions from. Behavioral/UX events (`search_performed`, `salon_viewed`) are inherently frontend-only. This means the eventual implementation likely needs **both** a backend event-emission point (reusing the existing pattern already established for `AlertsService`/audit logging — a small, testable service other services call) and a frontend SDK/pixel — not a single tool that magically covers both without server-side event support.

## 5. PLACEHOLDER — decisions requiring product/business sign-off

None of the following were decided by this initiative; implementation should not start until they are:

- **[ PLACEHOLDER: analytics platform ]** — self-hosted (PostHog OSS — fits this app's existing "self-host everything, no per-seat SaaS" posture seen in the SMS/payment/storage/push provider-abstraction pattern in `CLAUDE.md`) vs. a hosted SaaS (PostHog Cloud, Mixpanel, Amplitude, GA4). Tradeoffs: self-hosted adds one more service to `docker-compose.prod.yml` (operational cost, matches Phase L's existing resource-ceiling work) but avoids sending customer behavioral data to a third party and avoids per-event pricing at scale; hosted SaaS is zero ops but is a new recurring cost and a new third-party data-sharing relationship.
- **[ PLACEHOLDER: privacy/consent posture ]** — does this business need a cookie-consent banner before adding any client-side tracking pixel? Iran-specific regulatory requirements around user data (this app's entire user base) were not researched as part of this initiative and need real legal/product input, not an engineering guess. GDPR-style consent theater may or may not be the right bar to hold this to.
- **[ PLACEHOLDER: budget/tool cost ceiling ]** — if a paid SaaS tool is chosen, what's the acceptable monthly cost at current and projected event volume?
- **[ PLACEHOLDER: who owns the dashboards ]** — is there a specific person who will actually look at this data regularly? (Mirrors the same "is anyone watching" judgment already applied to CI-failure notifications in Phase N — instrumentation nobody looks at is pure cost with no benefit.)
- **[ PLACEHOLDER: PII handling ]** — customer phone numbers are the primary identifier throughout this app (`User.phone`). Any analytics event carrying a user identifier needs an explicit decision on whether to send the raw phone number, a hashed/pseudonymous ID, or the internal UUID to whatever tool is chosen — this is a real data-handling decision, not a technical default to pick unilaterally.

## 6. Proposed minimal first step (safe to do regardless of the placeholders above)

Build the retention/funnel dashboards described in §3's last paragraph directly against existing production data (read replica or careful read-only queries against the existing schema) — zero new instrumentation, zero new third-party dependency, zero privacy-policy question, and it directly tells the business whether investing further in full event tracking is even worth it. This is the one piece of this phase that could reasonably be implemented without waiting on the placeholders above, if the business wants a concrete next step rather than only a strategy document.
