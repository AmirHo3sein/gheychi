# Trust & free-launch readiness — design and contract (2026-10-08)

Source audit: the 2026-09-28 trust/money audit (see memory `2026-09-28-trust-money-audit`). This
spec implements its **§15A free-launch blockers** in full and the **code-only items of §15B**.
Everything that needs an external decision or vendor stays OFF and is listed under "Not built".

## Decisions taken (defaults — each is reversible by config or one small change)

| # | Decision | Default chosen | Why |
|---|---|---|---|
| 1 | Launch mode | **Free-booking only.** `feature_online_payment_enabled` stays off. | §15B needs custody/legal/KYC decisions only the owner can make. |
| 5 | Provider types | Salons only. | Fits the data model; no home-address privacy problem. |
| 6 | Listing bar | Admin review + phone call, with a written checklist shown on the approval screen. | Lowest-cost honest bar. |
| 7 | Cancellation policy | Platform-wide, **snapshotted on each booking** at creation. | Changing the config must never rewrite an existing booking's terms. |
| 8 | Salon-cancellation consequences | Admin-visible only (risk summary on the admin salon detail). | Avoids salons "ghosting" instead of cancelling honestly. |
| 9 | Owner-entered (manual) bookings | **Not reviewable**, never count toward rating, never trigger referral rewards. | Closes review fabrication; loses only walk-in feedback. |
| 11 | Customer reliability visibility | Own-salon history only (unchanged). | Privacy/fairness. |
| — | «سالن تایید شده» badge | **Removed.** Replaced by honest «عضو قیچی از <ماه سال>» (and the «جدید» label already shipped). | Approval only means an admin reviewed self-declared data. |
| — | Money custody, KYC, payout balance, coupon/wallet funding, Zarinpal refund contract | **Not built** (blocked on owner/vendor). | See "Not built". |

## Glossary (applies to every frontend string; code identifiers unchanged)

- **بیعانه** = deposit. Never «پیش‌پرداخت» (the customer app used that; the salon panel used بیعانه — one transaction, two words). Refundable-in-time / forfeitable-on-no-show is the بیعانه semantic.
- **نوبت** = the appointment/booking as a thing ("نوبت‌های من", "ثبت نوبت"). **رزرو** = the action verb/label ("رزرو نوبت", "پرداخت و رزرو"). Don't use رزرو as the noun for the thing.
- **سالن** = the business, in every UI (customer app, provider panel, admin panel). «آرایشگاه» is replaced in visible strings only (forms: آرایشگاه‌ها → سالن‌ها, آرایشگاهی → سالنی). Never touch API values, seed data, enum values, or category names.
- **کارمند / همکار**: keep whatever each screen already uses; do not churn.

## API contract

### New / changed fields

Public `GET /salons/:slug` (and the object returned by the public salon endpoints that already return the salon): add
`contactPhone: string | null` (digits only, ASCII) and `memberSince: string` (ISO date of `salons.created_at`).

`salons.contact_phone varchar(20) NULL`. Accepted on `POST /salons` and `PATCH /salons/mine` as `contactPhone`:
- `''`/`null` clears it. Persian/Arabic digits are normalised to ASCII, spaces/dashes stripped.
- Valid: Iranian mobile `^09\d{9}$` **or** landline `^0[1-8]\d{9}$` (area code + 8 digits). Anything else → 400 with a Persian message.
- Returned by `GET /salons/mine`. Public ONLY when the salon is `approved` (existing public gate). The owner's **account** phone is never exposed.

Admin `GET /admin/salons/:id` keeps every existing top-level salon column (existing admin UI reads them) and **adds**:
```
owner: { id, name, phone, status }
location: { lat, lng } | null
photos: [{ id, url, sortOrder }]
services: [{ id, name, pricingType, price, priceMax, durationMinutes, isActive }]
hours: [{ dayOfWeek, openTime, closeTime, isClosed }]      // whatever the schedule entity holds
riskSummary: {                                            // last 90 days, this salon only
  bookingsTotal, onlineBookings, manualBookings,
  cancelledBySalon, rejectedBySalon, noShowMarked, openReports
}
```

Customer & salon booking responses add `depositPaid: boolean` (already on the customer one), and the **salon** responses add
`prepaidAmount: number` (money actually captured, toman; 0 when none) and `amountDue: number | null` (what the salon still collects; `null` for non-fixed pricing). Admin bookings list/detail add `depositPaid` and must not imply a deposit that was never collected.

Customer booking responses add `reviewable: boolean` (false for `source='manual'`, non-completed, review exists, or window passed).

### New / changed endpoints & rules

- `POST /admin/bookings/:id/cancel` `{ reason: string }` — admin platform-cancel. New terminal status **`cancelled_by_admin`**. Valid from `pending_approval | pending_payment | confirmed`. Releases the hold exactly like a salon cancellation (wallet/coupon returned, slot freed), refunds a captured payment in full through the existing refund path, writes a `booking_events` row + an audit-log row, and notifies the customer (push + SMS only if the booking was `confirmed`). Audited via `@AuditAction`. Admin-only (`RolesGuard`), pinned in `route-guard-audit.spec.ts`.
- `PATCH /salons/mine/bookings/:id` `completed` allowed only when `now >= startsAt`; `completed`/`no_show` refused (403, Persian message) while the salon is not `approved`.
- Booking creation (`createHold`, `createManual`): the customer cannot be the salon's owner or one of its workers (400, Persian message). A manual booking whose phone resolves to the owner/a worker is refused the same way.
- **Abuse limits** on online booking creation: `booking_max_active_per_user` (default 5, bounds 1–50) and `booking_max_active_per_salon_per_user` (default 2, bounds 1–20) counted over `pending_approval | pending_payment | confirmed` bookings starting in the future; an overlapping booking by the same customer is refused; `POST /bookings` is rate-limited per user. Both config keys follow the existing platform-config pattern (seeded by migration, bounded in `admin-config.dto.ts`, mirrored in the admin config screen).
- Reviews: creating a review for a `source='manual'` booking → 400 «این نوبت توسط خود سالن ثبت شده و امکان ثبت نظر ندارد».
- Referral qualifying event requires `booking.source = 'online'` (and the existing completion rules).
- `bookings.cancellation_window_hours int NULL` — snapshot written at creation from the config in force; `cancel()` reads the snapshot and falls back to the live config only when NULL (pre-existing rows are backfilled by the migration).
- No-show SMS mentions forfeiture only if a Payment reached `paid`. `BookingReminderJob` skips bookings of salons that are not `approved`.
- Material post-approval edits (`name`, `genderTarget`, location, address) on an `approved` salon: salon stays live, an admin notification (`salon_material_edit`, with the changed field names) is raised and an audit row written.
- Admin config: `no_show_grace_minutes` bounded 0–1440; numeric `PATCH /admin/config` rejects feature-flag keys (and flag endpoint rejects non-booleans) so a typo can no longer brick boot.
- CRM "estimated revenue" counts **completed** bookings only and is labelled as list-price value.
- Wallet portion applied to a deposit is returned whenever the booking is refunded or cancelled in time (the UI already promises it).

### Not built (blocked on an owner/vendor decision — stays off)
Money custody/legal structure; payout KYC (national ID, Shahkar, IBAN owner match); payable-balance ledger; Zarinpal refund-contract production verification; platform subsidy accounting for coupons/wallet; dispute tools beyond platform-cancel; subscription period enforcement; self-serve account deletion (privacy policy describes the request-based process until built); the temporary SMS relay (operational — see CLAUDE.md).

## Legal pages (user-app)

`/terms`, `/privacy`, `/booking-policy`: public, SSR, indexable, in the footer, the login screen and the booking confirmation. Copy lives in `apps/user-app/app/content/legal.ts` (typed data, one source for the pages and tests). Policy numbers (deposit %, minimum, cancellation window) are fetched live from `GET /platform-config/booking-terms`; deposit wording switches on `feature_online_payment_enabled`. Operator identity/contact come from runtime config (`NUXT_PUBLIC_LEGAL_*`) and are **omitted, never faked**, when unset. Not legal advice — the owner must have the text reviewed and fill the operator identity before launch.

## Map tiles

Tile URL + attribution are runtime-configurable (`NUXT_PUBLIC_MAP_TILE_URL`/`_ATTRIBUTION`, `VITE_MAP_TILE_URL`/`_ATTRIBUTION`), defaulting to OSM, so changing provider is configuration + a CSP `img-src` line, not a code change.
