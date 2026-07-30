# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The salon owner, as an owner-operator — the account holder and the person actually tapping through the app day to day, not a separate front-desk staff role (this app has no non-owner login concept; salon "workers" are staff the owner manages, they don't get their own provider-panel access). Primarily checks the app on their phone between clients, but also uses a desktop/tablet for deeper setup and earnings-review sessions — design for both, without assuming one is secondary. Same phone-OTP-only auth and Persian/RTL-only interface as the rest of this platform.

## Product Purpose

The salon owner's operating console for their Gheychi listing: onboard and configure the salon (profile, hours, photos, stories, portfolio), manage services and pricing (including per-service discounts and coupon codes), handle incoming bookings (confirm/complete/cancel, assign which staff member performed a service), manage a staff roster (workers) and respond to reviews, and see earnings. Success is a salon owner who trusts this panel enough to run their real booking calendar and pricing through it, not a side dashboard they don't actually rely on.

## Positioning

Growth tooling, not just back-office admin. The value beyond "manage your listing" is filling empty appointment slots and growing repeat business: coupon codes and referral rewards exist to let an owner actively drive bookings (not just record them), the showcase (stories/portfolio) exists to make the salon look worth booking, and earnings/reviews visibility exists so the owner can see what's actually working. The panel should read as a business-growth tool a salon owner chooses to use, not a mandatory compliance form the platform makes them fill out.

## Operating Context

Core loop: get notified of / check a new booking → confirm or the system auto-confirms on payment → optionally assign a staff worker to it → mark completed (or handle a cancellation/no-show) → see it reflected in earnings. Setup/maintenance loop, done less often but higher-stakes: working hours, service catalog + pricing + discounts, salon profile/photos/stories/portfolio, team roster, coupon codes, resubmission after a rejected/suspended status. Checked in short bursts on a phone between clients, and in longer focused sessions on a larger screen for setup or reviewing earnings/reports.

## Capabilities and Constraints

- Same durable technical constraint as the rest of this platform: must work well on budget/mid-range Android and variable mobile networks, since a meaningful share of real usage is a phone check between clients — do not design as if a desktop back-office computer is the only real context.
- Persian/RTL-only, phone-OTP-only auth — same as `apps/user-app`; no separate staff accounts exist to design a permissions/roles system for.
- A salon only becomes usable after admin approval (`pending` → `approved`); a `rejected`/`suspended` salon has a distinct, more limited state (resubmit flow) that the design must represent honestly, not just gray out.
- Money-adjacent screens (earnings, deposit/commission figures, coupon/referral reward config) must read as trustworthy and precise — this is the same platform whose customer-facing pitch is "you can trust that this booking and this money are real."

## Brand Commitments

None yet — same working-name, open-canvas status as `apps/user-app` ("آرایشگاه" is not a committed brand identity for this project). Whatever visual world is chosen for the platform should be shared/consistent across `user-app`, `provider-panel`, and `admin-panel` rather than decided independently per app, since they're one product from three different roles' viewpoints.

## Evidence on Hand

No real salon-owner testimonials, usage data, or case studies exist — local development build only, do not fabricate any. Real evidence: the actual running app and its current feature set (bookings, services, hours, photos, stories, portfolio, team, coupons, reviews, earnings, settings).

## Product Principles

1. Growth tooling, not a compliance form — every screen should make an owner want to use it to get more bookings, not just tolerate it.
2. Mobile-capable by default — a between-clients phone check must be genuinely fast and legible, not a cramped desktop layout.
3. Money and trust figures (earnings, deposits, discounts) read as precise and unambiguous, matching the platform-wide trust positioning.
4. A salon's non-approved/limited states (pending, rejected, suspended) are represented honestly, not hidden or glossed over.
5. Shares a visual language with `user-app`/`admin-panel` rather than diverging as an independently-designed app.

## Accessibility & Inclusion

No formal accessibility standard confirmed. Same RTL-correctness and low-bandwidth-tolerance expectations as `apps/user-app` apply here.
