# 31 — Public salon handle, QR, and booking attribution

Phase 4 of the monetization/subscription initiative
(`docs/superpowers/specs/2026-08-30-monetization-platform-design.md`). Makes `salon.slug`
provider-editable and reuses it directly as the shareable public link
(`gheychi.co/salons/<handle>`) rather than adding a parallel `/s/<handle>` route — the
owner's own decision (one routing/sitemap/canonical concept, not two). Adds client-side QR
generation and lightweight, best-effort marketing-channel attribution on bookings.

## Public handle

`slug` was already DB-unique and non-nullable; this phase adds a real edit path, which
didn't exist before (the generator always appended a random suffix and nothing could change
it after creation).

- `UpdateHandleDto` (`apps/api/src/salons/dto/salon-handle.dto.ts`): lowercase
  letters/digits/single hyphens, 3–40 chars, no leading/trailing/doubled hyphen.
- `RESERVED_SALON_HANDLES` (`apps/api/src/salons/reserved-handles.ts`) — two distinct
  reasons a word is listed: a genuine route collision (`mine` is a literal path
  `SalonsController` registers ahead of `GET /salons/:slug`, so a salon with that literal
  slug would make its own public profile permanently unreachable), and plain hygiene (`admin`,
  `api`, `login`, ... — words that would read as a platform page regardless of any actual
  collision).
- `SalonsService.updateHandle()` — checked against the reserved list, then a transactional
  rename translating a unique-constraint violation into a clean 409 (`isUniqueViolation`,
  same pattern as `PlansService.create`'s own key-conflict handling). See "Handle history"
  below for what that transaction also writes.
- Two routes calling the same service method: `PATCH /salons/mine/handle` (owner, via
  `SalonOwnerGuard`) and `PATCH /admin/salons/:id/handle` (admin override/recourse, audited
  `salon.handle.set`) — deliberately its own route/DTO on the owner side, not folded into
  `UpdateSalonDto`'s blanket `Object.assign`, matching the booking-approval-timeout columns'
  own precedent for why a privilege-escalation-prone field needs its own explicit route.

### Handle history, redirects, and the reservation (added later)

The original `updateHandle` was a bare `repo.update({id}, {slug})`: the old handle was
overwritten and lost. That broke the one artifact this feature exists to produce — every
already-printed QR code and shared link 404'd the instant an owner tidied their handle — and,
worse, it *freed* the handle, so a competitor could take it and inherit all of that printed
traffic. `salon_slug_history` (`salon-slug-history.entity.ts`, migration
`1756400000000-salon-slug-history.ts`) closes both:

- **`slug` is the PRIMARY KEY**, so "a released handle stays spoken for, forever" is a
  database invariant rather than an application check some future call site could forget.
  `salon_id` is `ON DELETE CASCADE` — once the salon is gone there is nothing to redirect to.
  Never backfilled: a salon's *current* slug is not history.
- **The history row is written in the same transaction as the rename**, so a handle can never
  be released without being recorded. Statement order inside that transaction is load-bearing
  and deliberately counter-intuitive: the `salons` UPDATE goes **first** so the transaction
  serializes on the `salons.slug` unique index before the reservation is read; a concurrent
  release of that very handle is therefore already visible to the follow-up SELECT. Checking
  first would leave exactly the hijack window the table exists to close.
- **Reclaim deletes the row.** A salon taking one of its own former handles back makes that
  handle live again, so it stops being history (and stops redirecting to itself).
- **A no-op rename writes nothing** — submitting the handle already in use returns early.
- **Admin may override a reservation** (`PATCH /admin/salons/:id/handle` passes
  `asAdmin: true`): this route is the documented recourse for an inappropriate or
  un-undoable handle, so it must not be blockable by the reservation it is being used to
  unwind. It still records the losing salon's own released handle, it drops the now-live
  handle's stale reservation row, and it is already audited (`salon.handle.set`, with a real
  before/after slug diff). An **owner** can never do this — they get a 409.

**Redirect path.** `GET /salons/:slug/canonical` (public, `SalonsController`) answers
`{ slug, moved }` for any handle a salon has ever had, and 404s for one that was never
anyone's — or whose salon is no longer `approved`, matching `findPublicBySlug`'s own gate.
It is deliberately a separate endpoint rather than a field on the profile response: making
`GET /salons/:slug` serve a renamed salon under its old handle would duplicate every salon
page across as many URLs as it has ever had handles, defeating the canonical-URL goal
outright. The user-app's `salons/[slug].vue` only calls it on the path where the profile
fetch already 404'd (so a live handle costs no extra request) and turns a `moved: true` into
a real **301** via `navigateTo({ path, query }, { redirectCode: 301, replace: true })`,
carrying the query string across — losing `?source=qr` there would mis-attribute every scan
of every already-printed code, which is the whole point. The page also now emits a
`rel="canonical"` (and `og:url`) built from the route slug, which is always the current
handle by that point; the sitemap source (`sitemap-salons.controller.ts`) reads `salons`
only, never history, so a former handle is a 301 source and never an indexable URL.

UI: provider-panel's `PublicLinkCard.vue` (on `SalonSettingsView`) is the primary edit
surface, with a copy-link button and the QR code below it. admin-panel's `SalonHandleCard.vue`
(on `SalonDetailView`'s info tab) is recourse-only — no QR/copy-link affordance, since an
admin isn't the one sharing the link.

## QR

Generated entirely client-side (`qrcode` npm package, provider-panel only) — the payload is
just the public URL plus `?source=qr`, not sensitive, so there's no reason to round-trip
through the backend or store a binary image. `VITE_CUSTOMER_APP_BASE` (new build-time env
var, mirroring `VITE_API_BASE`'s own pattern — see `docs/deployment/DEPLOY.md`) is the only
new piece of infrastructure this needed: provider-panel is served from a different domain
than the customer-facing user-app, so the public URL can't be derived from
`window.location`.

## Booking attribution

`Booking.attributionSource: 'qr' | 'direct' | 'search' | null` — a new column, deliberately
named to avoid any confusion with the pre-existing `Booking.source` (`'online' | 'manual'`,
*how the row was created*, not a marketing channel). Resolution happens once, client-side, on
the salon profile page (`apps/user-app/app/utils/attribution.ts`):

- an explicit `?source=qr` or `?source=direct` on the page's own URL wins (the two values
  the platform's own share/QR features ever generate);
- otherwise, a search-engine referrer (`document.referrer`) resolves to `'search'`;
- otherwise `null` — the common case, plain organic in-app navigation.

Carried onto the "Book" link's own query string (not sessionStorage) since the salon profile
page is always the entry point a QR/shareable link lands on — never the booking page
directly. The booking page reads `route.query.source`, validates it against the same fixed
set before ever sending it (the query string is otherwise customer-controlled), and forwards
it as `CreateBookingDto.attributionSource`. `BookingsService.createHoldImpl` both persists it
on the `Booking` row and threads it into the existing `booking_started` analytics event as
`source` (`null`, not omitted, when absent — the funnel event's shape stays constant). This
is deliberately the full extent of attribution for this phase: no UTM-parameter parsing, no
IP/device fingerprinting, no attribution for the `createManual` (walk-in) flow, which has
nothing to attribute.
