# 07 — Salon Panel (`apps/provider-panel`)

The salon-owner back office. Vue 3 + Vite SPA (no SSR need — fully authenticated tool). Port 3004.

## Routing & guard

`src/router/index.ts`. No `meta.requiresAuth`/`meta.role` flags — a single centralized `router.beforeEach` handles everything:

1. If session not yet `checked`, calls `GET /auth/me` (`redirectOn401:false`); only marks `checked` on a real success or a confirmed 401 (network/5xx errors retry on the next navigation).
2. `meta.public` routes (`/login`): logged-in → `dashboard`; else allowed.
3. Not logged in → `/login`.
4. Logged in: fetches `useSalon()` (module-level singleton), lazily `refetch()`s.
   - **Only a confirmed 404 means "no salon."** A non-404 failure (5xx, network) leaves `salon` null *and* `checked` false; the guard toasts and cancels the navigation (`return false`) rather than routing to onboarding, where an owner with an approved salon would be invited to create a second one. The next navigation probes again.
   - No salon → forced to `/onboarding`.
   - Salon `status !== 'approved'` → forced to `/pending-approval`, with carve-outs: `rejected` may still reach `/settings` (to fix and resubmit); `pending` may still reach `/hours` and `/services` (to finish an onboarding that was interrupted partway).
   - Otherwise, `/onboarding`/`/pending-approval` themselves are blocked → redirect to `dashboard`.

**No explicit role check anywhere** — gating is entirely driven by salon-ownership data (`GET /salons/mine`), not `user.role`. Contrast with admin-panel's explicit `role==='admin'` check — see [17-permissions.md](./17-permissions.md).

## Pages (`src/pages/`)

| Page | Purpose |
|---|---|
| `LoginView.vue` | Phone→OTP two-step login, Persian-digit normalization, 120s countdown |
| `OnboardingView.vue` | 3-step wizard: salon info → hours → first service (`POST /salons`, `PUT /salons/mine/hours`, `POST /salons/mine/services`). The first service requires `price > 0` (the field used to be pre-filled `0`, which the API accepted). Logout from here calls `resetSalon()` so the next account's probe starts clean |
| `PendingApprovalView.vue` | Status screen for pending/rejected/suspended salons; `POST /salons/mine/resubmit`. Copy names the platform (قیچی) as the approver |
| `DashboardView.vue` | Today's/upcoming bookings + quick-link grid |
| `BookingsView.vue` | Full booking list, worker assignment, status transitions (`completed`/`no_show`), cancellation, approve/reject for manual-approval requests, and **manual (walk-in/phone) booking creation** (`POST /salons/mine/bookings` — `Booking.source = 'manual'`) |
| `ServicesView.vue` | Service CRUD, inline price/discount/description edits, soft-deactivate (no reactivation path), new-category request (`POST /salons/mine/category-requests`); `addService` has an in-flight guard against double submit |
| `CouponsView.vue` | Salon-scoped coupon CRUD (percent-only from this UI), `JalaliDatePicker` for expiry |
| `TeamView.vue` | Worker roster: add worker (in-flight guarded), toggle active, per-worker service-restriction multi-select, **per-worker days off** (`schedule_exceptions` rows with `workerId` set — listed and deleted here, not in `HoursView`), lazy-reveal referral code |
| `HoursView.vue` | Weekly schedule editor + one-off **whole-salon** closures — lists/deletes only exceptions with `workerId === null`; per-worker days off were previously shown here as salon-wide closures and deletable, which is why the filter is explicit |
| `PhotosView.vue` | Salon photo gallery: upload, set-cover, delete |
| `StoriesView.vue` | 24h-expiring stories (cap 10 active), live countdown |
| `PortfolioView.vue` | Portfolio items (cap 40), caption edit, service link, manual reorder |
| `SalonSettingsView.vue` | Edit salon (reuses onboarding's `SalonInfoStep`) + showcase profile fields + public handle/QR (`PublicLinkCard`) + booking-confirmation mode + live preview. Sends `''` to clear `description` (the DTO's `''→null` transform, same as `tagline`/`about`) |
| `ReviewsView.vue` | Customer reviews, unanswered-first sort, reply composer. Paginates the same public listing the customer app reads (`?page=`, 50/page) instead of silently capping at 50; when the reviews feature flag is off it shows a banner rather than a fake empty state |
| `EarningsView.vue` | Read-only: totals row + monthly invoice history (see [14-commission.md](./14-commission.md) — accrues only on online-captured money) |
| `PlanView.vue` | Read-only "my plan": resolved entitlements + billing-period history; no controls by owner decision ([30](./30-subscription-plan-foundation.md), [34](./34-subscription-coupons-and-billing.md)) |
| `CustomersView.vue` | CRM customer list with segment filter, revenue dashboard, remaining-SMS-quota line ([32-salon-crm.md](./32-salon-crm.md)) |
| `CustomerDetailView.vue` | One customer's booking history, owner notes, and the free-text SMS compose card ([33-salon-sms-quota.md](./33-salon-sms-quota.md)) |
| `ReferralView.vue` | The owner's own referral code, activity, granted rewards, and wallet balance/transactions read together on one screen; renders its own explanatory disabled state when the `salon_owner` referral-reward type is off |

Every page has a colocated `.spec.ts`. Logout (`AppLayout.vue` and `OnboardingView.vue`) calls `resetSalon()` alongside the session clear, so a second account logging in on the same tab never inherits the previous salon's cached probe.

## Composables (`src/composables/`)

- **`useApi.ts`** — `apiFetch<T>(path, {method, body, silent, redirectOn401})`. Includes a `normalizeApiMessage()` helper that converts NestJS `class-validator`'s English `message: string[]` arrays into a fixed Persian fallback string for 400s (admin-panel now carries an equivalent copy — same cross-app-isolation duplication as the rest of `composables/`).
- **`useSalon.ts`** — module-level singleton, treats a `GET /salons/mine` 404 as "no salon" (not an error state).
- **`useCities.ts`** — fetches `GET /cities` (the backend-canonical Iranian city list with lat/lng).
- **`useServiceCategories.ts`** — fetches `GET /categories`.
- **`useTheme.ts`** — `localStorage['provider-theme']`.
- **`useToast.ts`** — module-level singleton, 5s auto-dismiss.

## UI component library (`src/components/ui/`)

`AppButton`, `AppCard`, `AppIcon`, `AppInput`, `AppMultiSelect` (**provider-panel-only** — `vue-multiselect` in `multiple` mode, used by `TeamView`'s worker-service restriction picker), `AppSelect`, `EmptyState`, `JalaliDatePicker`, `StatusBadge`. Confirmed **not shared** with admin-panel despite being near-byte-identical for several files — see [24-technical-debt.md](./24-technical-debt.md).

## The salon-owner workflow

```mermaid
stateDiagram-v2
    [*] --> NoSalon
    NoSalon --> Onboarding: user has no salon row
    Onboarding --> Pending: POST /salons (3-step wizard)
    Pending --> Approved: admin approves
    Pending --> Rejected: admin rejects (reason required)
    Rejected --> Pending: POST /salons/mine/resubmit (owner fixes & resubmits)
    Approved --> Suspended: admin suspends directly, OR owner account gets suspended (cascade)
    Suspended --> Approved: admin un-suspends (only if cascade-caused, see 08-admin-panel.md)
    Approved --> [*]: fully operational — bookings/services/team/showcase all active
```

## Feature depth: the worker-service restriction feature

`TeamView.vue` is the UI for the most recently added feature: letting an owner restrict which of the salon's services each team member is allowed to perform. It fetches `GET /salons/mine/workers` (each worker returned with an attached `serviceIds` array) and `GET /salons/mine/services`, renders an `AppMultiSelect` per worker bound to that worker's `serviceIds`, and on change calls `PATCH /salons/mine/workers/:id/services`. An **empty selection is valid and meaningful** — it clears the worker back to "unrestricted, eligible for every service," not an error. Full backend detail (including how this is enforced at booking time): [09-booking-engine.md](./09-booking-engine.md).

## Styling

Tailwind v4 (`@theme static {}`, no `tailwind.config.js`). Design tokens in `src/assets/css/main.css`: `--color-surface`, `--color-accent(-strong/-deep/-soft/-text)`, `--tone-success/warning/danger/neutral/info(-bg/-text)`, `--shadow-sm/md/lg`. Manual `.dark` class toggle (not OS-only), driven by `useTheme.ts` + `localStorage`. Font: `@fontsource-variable/vazirmatn`, RTL throughout via logical CSS properties (`start-`/`end-`/`ps-`/`pe-`).

`apps/provider-panel/DESIGN.md` (rewritten 2026-08-07) is the app's design-system reference — it canonizes `apps/user-app/DESIGN.md`'s "Verified Ledger" system and records only what differs for this "Operate mode" surface; read the user-app file alongside it.

## Related documents

- [09-booking-engine.md](./09-booking-engine.md) — the worker-eligibility feature this panel manages
- [13-financial-system.md](./13-financial-system.md) — coupons, referral codes
- [14-commission.md](./14-commission.md) — the earnings/invoice data this panel displays
- [08-admin-panel.md](./08-admin-panel.md) — the counterpart moderation flow that approves/rejects/suspends this panel's salon
