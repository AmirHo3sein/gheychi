# Arayeshgah — Salon Discovery & Booking Marketplace

**Date:** 2026-07-04
**Status:** Approved design (brainstorming complete)

## 1. Product Summary

A two-sided marketplace for beauty and hair salons in Iran. Users find salons near them, compare services, prices, and verified ratings, and book a time slot by paying a small online deposit. Salons get a self-serve panel to manage their profile, services, hours, and bookings. An admin panel controls quality (salon approval, review moderation) and platform configuration.

The comparison point is Snapp: a mobile-first experience where the user opens the app and finds exactly what they need nearby.

### Decisions locked during brainstorming

| Decision | Choice |
|----------|--------|
| Market | Iran — Zarinpal (payments), Kavenegar (SMS), Neshan/Map.ir (maps), ArvanCloud S3 (storage/CDN) |
| MVP scope | Discovery **and** full online booking |
| Booking depth | Salon-level slots (capacity-based); data model ready for per-staff booking in phase 2 |
| Payment | Small online deposit confirms the booking (default 20% of price, admin-configurable, with a minimum floor); the rest is paid at the salon |
| Gender handling | One app; `users.gender` is matched against `salons.gender_target` in every public query, enforced in the API layer |
| Platform | Mobile-first PWA (Nuxt 3, SSR for SEO); Capacitor wrapper for Cafe Bazaar/Myket in a later phase |
| Salon onboarding | Self-serve signup with admin approval before going live |
| Reviews | Verified bookings only — one review per completed booking, enforced by a DB constraint |
| Home screen | List-first (ranked cards with category chips); map view available as a toggle |
| Architecture | Modular monolith (Approach A) |

### Monetization path (not built in MVP, but shapes the design)

1. Deposit rail exists from day one → commission on bookings can be turned on later.
2. Featured placement in search results (easy add once search exists).
3. Salon subscriptions (freemium listing tiers).
4. Forfeited no-show deposits are paid to the salon minus platform commission.

## 2. Architecture

Modular monolith in a pnpm + Turborepo monorepo:

```
arayeshgah/
├── apps/
│   ├── user-app/          # Nuxt 3, mobile-first PWA, SSR (SEO-indexable salon pages)
│   ├── provider-panel/    # Vue 3 SPA (Vite), mobile-friendly
│   ├── admin-panel/       # Vue 3 SPA (Vite)
│   └── api/               # NestJS modular monolith
├── packages/
│   └── shared/            # UI components, composables, API client, validation schemas
```

**API modules:** `auth`, `salons`, `catalog`, `geo-search`, `booking`, `payments`, `reviews`, `notifications`, `admin`.

**Data stores:**
- **PostgreSQL + PostGIS** — single database; booking + payment state changes happen in one transaction; PostGIS powers "salons within N km ordered by distance".
- **Redis** — OTP codes, sessions, slot-grab locks, rate limiting.

**External providers sit behind interfaces** (`PaymentGateway`, `SmsProvider`, `MapProvider`, `ObjectStorage`) so a provider can be swapped without touching business logic.

**Auth:** phone number + SMS OTP; session in an HttpOnly cookie. Tokens are never stored in JS. Global 401 handling redirects to login. On first login the user sets name and gender.

## 3. Data Model

### Entities

- **users** — id (uuid), phone (unique), name, gender (`female`|`male`), role (`customer`|`provider`|`admin`).
- **salons** — id, owner_id → users, name, slug, description, gender_target (`women`|`men`), status (`pending`|`approved`|`suspended`), location (PostGIS point), address, city, capacity (max concurrent bookings), rating_avg + rating_count (denormalized).
- **service_categories** — admin-managed list (haircut, color, nails, skin, makeup, …) with icons.
- **salon_services** — salon_id, category_id, name, description, price (toman), duration_min, is_active.
- **salon_photos** — salon_id, url (ArvanCloud), sort_order, is_cover.
- **working_hours** — salon_id, weekday (0–6), open_time, close_time.
- **schedule_exceptions** — salon_id, date, is_closed (holidays / custom closures).
- **bookings** — id (uuid), user_id, salon_id, service_id, starts_at, ends_at, price_snapshot, deposit_amount, status (`pending_payment`|`confirmed`|`completed`|`cancelled_by_user`|`cancelled_by_salon`|`no_show`).
- **payments** — booking_id, amount, gateway (`zarinpal`), authority, ref_id, status (`initiated`|`paid`|`failed`|`refunded`).
- **reviews** — booking_id (UNIQUE), salon_id, user_id, rating (1–5), comment, status (`published`|`rejected`), salon_reply. Reviews are created as `published` (moderation is reactive — see §7); admins set `rejected` on upheld reports.
- **platform_config** — admin-editable tunables: deposit percent, deposit minimum, cancellation window hours, commission rate, booking hold TTL.

### Modeling decisions

- **No slots table.** Availability is computed on demand: working hours − exceptions − overlapping active bookings compared against `capacity`. Salons never manage slot rows.
- **Staff-ready.** Phase 2 adds a `staff` table and `bookings.staff_id`; nothing else restructures.
- **price_snapshot** on bookings isolates existing bookings from later price edits.
- **reviews.booking_id UNIQUE** enforces verified-only reviews at the database level.
- **rating_avg/rating_count** update in the same transaction as review creation (and re-compute on rejection) so search never aggregates on the fly.

## 4. Booking & Payment Flow

1. **Availability:** user picks a service; API computes free slots for the next 14 days, stepping by the service's `duration_min`.
2. **Hold:** user taps a slot. In one DB transaction the API re-checks availability and inserts a `pending_payment` booking, which itself holds the slot for **15 minutes** (TTL from `platform_config`). A Redis lock per salon+slot serializes concurrent grabs; the loser gets "slot taken" with refreshed availability. Double booking is impossible.
3. **Deposit:** payment row created (`initiated`, stores Zarinpal `authority`); user redirects to Zarinpal. Deposit = configured % of `price_snapshot` with a minimum floor.
4. **Confirm:** Zarinpal callback is never trusted alone — the API calls Zarinpal's verify endpoint, then marks payment `paid` and booking `confirmed` in one transaction. If the user's browser dies mid-redirect, the booking is still confirmed server-side.
5. **Notify:** Kavenegar SMS to user (confirmation + address + time) and salon (new booking). Reminder SMS to the user before the appointment.
6. **Complete:** salon marks `completed` (deposit deducted from in-salon payment) or `no_show`. Completion triggers the review prompt — the only entry into the review system.

**Expiry:** a scheduled job cancels `pending_payment` bookings older than the hold TTL, releasing the slot. A reconciliation job re-verifies any `initiated` payment older than 20 minutes against Zarinpal.

### Cancellation & refund policy

| Case | Deposit outcome |
|------|-----------------|
| User cancels ≥ cancellation window (default 24h, salon-configurable) | Full refund |
| User cancels late, or no-show | Forfeited → paid to salon minus platform commission |
| Salon cancels (any time) | Full refund to user; salon reliability score drops (admin-visible, affects ranking) |

## 5. User App (Nuxt PWA)

**Screens:** Login (phone + OTP; name + gender on first login) → Home/Search → Salon profile → Booking flow → My bookings → Profile (account, saved salons).

**Home is list-first:** city selector, search box, service-category chips, ranked salon cards (cover photo, name, rating + count, distance, "from" price). Sort by distance/rating; a map toggle shows the same results on a Neshan map. Results always respect the gender filter.

**Salon profile:** photo gallery, rating summary, services with prices and durations (the booking entry point), hours, address with map, reviews with salon replies. SSR-rendered and indexable — each salon page is a landing page for Google traffic.

**Booking flow:** service → date/slot picker → confirm sheet (price, deposit amount, cancellation policy) → Zarinpal → success screen. Pending payments surface as a retry banner.

## 6. Provider Panel (Vue SPA)

Mobile-friendly — owners will use phones.

- **Onboarding wizard:** salon info, gender target, address + map pin, photos, services, weekly hours + capacity → submits as `pending` for admin review.
- **Dashboard:** today's bookings, next appointments.
- **Bookings:** upcoming list; mark `completed`/`no_show`; cancel (with penalty warning).
- **Services & prices:** CRUD, active toggle.
- **Hours & days off:** weekly template + exception dates.
- **Reviews:** read; one public reply per review.
- **Earnings:** deposits collected, forfeited-deposit payouts, commission deducted.

## 7. Admin Panel (Vue SPA)

- **Salon approvals:** review queue; approve/reject with reason.
- **Review moderation:** reactive — reviews publish immediately (verified-booking-only keeps baseline quality); admins handle reports/flags.
- **Categories:** manage service category list.
- **Users & salons:** search, suspend.
- **Config:** edit `platform_config` tunables.

## 8. Error Handling

- Frontend API client wrapper: global 401 → login redirect; error toast by default; `silent` mode for local handling.
- **Payments:** all state transitions server-side and idempotent (callback replays cannot double-confirm). Reconciliation job for stale `initiated` payments.
- **Booking:** availability re-checked inside the confirming transaction; expiry job releases stale holds.
- **SMS:** queued with retry; notification failure never rolls back a booking.

## 9. Testing

- **Booking module first and hardest** (unit + integration): slot computation, two-users-one-slot concurrency, hold expiry, cancellation windows.
- **Payments:** integration tests for verify flow against a mocked Zarinpal.
- **E2E:** Playwright happy path (search → book → pay → review) against a seeded dev environment.
- **Frontends:** component tests only where logic is nontrivial (slot picker, booking status states).

## 10. Out of Scope (MVP)

- Per-staff booking and staff profiles (phase 2; data model is ready).
- Commission collection, featured placement, subscriptions (rails exist; activation is post-traction).
- Native store apps (Capacitor wrapper later).
- In-app chat, product sales, loyalty programs.
- `fa`/`en` full i18n build-out beyond the primary Persian (fa, RTL) UI.

## 11. Open Risks

- **Supply seeding:** the product only works with salon density; plan is manual onboarding in one city/neighborhood first. This is an operations problem the software supports (fast onboarding wizard) but cannot solve.
- **Refund mechanics:** Zarinpal refund APIs/settlement behavior must be validated early; wallet-credit fallback is the contingency for user cancellations inside the window.
