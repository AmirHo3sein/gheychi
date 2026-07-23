# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A small internal team of trusted platform staff (not salon owners, not customers) — operating this panel at a desk during business hours. Desktop is the safe default screen assumption; mobile is not a priority. Same phone-OTP-only auth as the rest of the platform, but the account itself carries an internal `admin` role, not a customer or salon-owner one.

## Product Purpose

The operator console for running the Arayeshgah marketplace: approve/reject/suspend salons, moderate reviews and worker ratings, resolve abuse reports, manage the platform-wide service-category taxonomy, configure platform-wide settings (deposit percent, cancellation window, commission), manage users and salons (search/suspend), issue and configure platform-wide coupons and the referral-reward program, adjust wallet balances, and review an audit log of every admin action taken. Success is a small team being able to run day-to-day trust-and-safety and money-adjacent operations confidently and without ambiguity.

## Positioning

Operational control and accountability, not growth or persuasion — this surface exists so a small internal team can act correctly and be able to prove what they did (every mutation is audited). There is no external audience to persuade here; the product's job is to make consequential actions (money-moving, trust/moderation) unambiguous and confirmable, not to be inviting or expressive.

## Operating Context

Two categories of action, treated as equally high-stakes: (1) money-moving — wallet balance adjustments, referral-reward-type configuration (reward amounts/percentages, enable/disable), coupon issuance; (2) trust/moderation — approving or suspending a salon, moderating a review or worker rating, resolving an abuse report, cancelling a referral. Both categories involve real consequences with no automatic undo, and both are covered by the existing audit log (`/audit-log`) recording who did what, when. Secondary, lower-stakes surfaces: category management, platform config, user/salon search.

## Capabilities and Constraints

- Desktop-primary; do not over-invest in a mobile-optimized layout at the expense of information density a desk-based operator needs.
- Every mutating admin action already flows through an audit-log interceptor — the design should make "this action will be recorded" implicit and trustworthy, not something the operator has to wonder about.
- A small team, not a large one — do not design multi-admin coordination UX (presence, assignment, locking) that has no real current need; the shared-notification-queue model already in place (one queue, not per-admin state) is an accepted, deliberate simplification, not a gap to visually paper over.
- Confirmation/clarity bar should be uniformly elevated for both money-moving and trust/moderation actions — neither category should read as more "casual" than the other.

## Brand Commitments

None yet — same working-name, open-canvas status as `apps/user-app`/`apps/provider-panel`. This app should share a visual language with the other two rather than be designed as an unrelated internal tool, even though its Operate-mode priorities (density, clarity, confirmation) differ from the customer-facing app's.

## Evidence on Hand

No real operational history, incident reports, or usage data exist — local development build only, do not fabricate any. Real evidence: the actual running app and its current feature set (salons, reviews/worker-ratings, reports, categories, platform config, users, coupons, referrals, wallet, audit log).

## Product Principles

1. Every consequential action is unambiguous and confirmable before it happens, not just recorded after the fact.
2. Money-moving and trust/moderation actions get the same elevated clarity bar — neither outranks the other.
3. Desktop information density over mobile-friendly simplification — this is a working tool for a seated operator, not a glanceable app.
4. The existing audit trail is a feature to surface confidently, not a background compliance detail.
5. Shares a visual language with `user-app`/`provider-panel` rather than diverging as an unrelated internal tool.

## Accessibility & Inclusion

No formal accessibility standard confirmed. Same RTL-correctness expectation as the rest of the platform; low-bandwidth tolerance is not a priority here the way it is for the customer-facing/mobile apps, given the desktop-primary, internal-team usage context.
