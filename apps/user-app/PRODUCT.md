# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Consumers in Iran booking salon/beauty appointments — mostly on mid/low-end Android phones over variable mobile data, not desktop. OTP-phone-only auth (no email, no password), Persian/RTL-only interface (no i18n). Secondary roles (salon owner, admin) exist in this monorepo but are served by separate apps (`apps/provider-panel`, `apps/admin-panel`); this app (`apps/user-app`) is customer-facing only.

## Product Purpose

A salon discovery & booking marketplace: search/filter salons by location, gender-target, and service; view a salon's profile (services, hours, photos, stories, portfolio, reviews); book a specific service at a specific time slot; pay a deposit online to hold the booking; manage/cancel bookings; leave a review after a completed visit. Success is a held, trustworthy booking a customer actually shows up to, not just a browsed listing.

## Positioning

Trust and verification, not just discovery breadth or raw booking speed. The mechanism a copycat listings app can't casually replicate: every review is tied to a completed, paid booking (DB-enforced one-review-per-booking, no anonymous/unverified reviews); a booking is backed by a real, non-refundable-by-default deposit charged through Zarinpal, so it's a financial commitment, not a soft reservation; every salon is human-approved by a platform admin before it's publicly listed or bookable. The product's job is to make "this salon and this booking are real" legible at a glance.

## Operating Context

Entirely mobile web / installable PWA (Nuxt 4 SSR, `@vite-pwa/nuxt`, Web Push). Core flow: OTP login → browse/search → salon profile → pick service + time slot → pay deposit (external Zarinpal redirect, back via callback) → booking confirmed → attend → leave a review. Secondary flows: manage/cancel a booking (deposit refund policy depends on cancellation window), apply a discount coupon or referral-issued coupon before paying, view/spend referral rewards and wallet balance, follow salon stories/portfolio, read blog content (SEO/discovery surface). RTL Persian typography (Vazirmatn) throughout, light/dark theme toggle.

## Capabilities and Constraints

- **Durable technical constraint (confirmed):** design for mobile-first, budget/mid-range Android hardware and variable/slow mobile network conditions as the default case, not the edge case — avoid heavy client bundles, large unoptimized imagery, or effects that assume a fast connection or a high-end GPU.
- Persian/RTL is a hard requirement, not a locale option — there is no other language and no i18n library in this app by design.
- Auth is phone-OTP only; there is no password, email, or social login surface to design for.
- Payments/deposits are real and external (Zarinpal redirect) — the design must accommodate a full page navigation away from and back into the app mid-flow, not just an in-app modal.
- Maps use Leaflet + CARTO tiles (no paid map SDK, no API key) — client-only, never SSR'd.
- Push notifications are optional/best-effort (VAPID) and must degrade gracefully with no keys configured.

## Brand Commitments

None yet — "آرایشگاه" (Arayeshgah) is a working name for this practice/dev project, not a committed brand identity. The current teal-accent light theme / purple-accent dark theme (`app/assets/css/main.css`, "Teal Trust" / "Bold Editorial") is an existing implementation, not a binding brand commitment — open to being treated as evidence/anti-reference for a future redesign rather than preserved as-is, per the user's explicit choice during this init.

## Evidence on Hand

No real customer testimonials, press, case studies, or production usage data exist for this project — it is a local development build. Do not fabricate any of these. Real, non-fabricated evidence that does exist in-repo: the actual running product across all four apps (api/user-app/provider-panel/admin-panel), and this document's own product-truth answers.

## Product Principles

1. Legible trust over polish for its own sake — every screen should make it obvious what's verified (reviews, salon approval, payment status) versus merely claimed.
2. Design for the real device and network, not the demo device — mobile-first, budget Android, forgiving of slow/flaky connections.
3. A booking's financial commitment (the deposit) must never feel hidden, ambiguous, or reversible-by-accident.
4. RTL Persian is the only reading direction — never a mirrored afterthought of an LTR design.
5. Respect the phone-OTP-only, no-password mental model — don't design flows that assume email/social identity exists.

## Accessibility & Inclusion

No formal accessibility standard has been confirmed as a requirement. Given the primary-user evidence (budget Android, variable networks, Persian/RTL), treat low-bandwidth tolerance and correct RTL behavior (not just mirrored LTR) as accessibility-adjacent durable constraints, already covered above under Capabilities and Constraints.
