# 36 — Flexible service pricing, custom categories & packages

Added 2026-09-11, extending the service catalog (`SalonService`, `ServiceCategory`) so it
represents real salon offerings that don't fit "one fixed price, one system category" —
without touching the booking/payment/deposit/discount/commission engine's own correctness
for the FIXED services it already handles.

## Why it exists

Before this: every `SalonService` had exactly one required `price` (a `bigint`, whole toman)
and one required `categoryId` (a global, admin-owned category). That's genuinely how most
services work (a haircut has a real fixed price), but three real cases had no honest
representation at all:

- **"From 1,000,000 toman"** — hair coloring, where the real price depends on hair length/
  condition and the salon only knows a floor.
- **"2,000,000–5,000,000 toman"** — keratin, where the salon knows a real range but not a
  single number.
- **"Price upon consultation"** — a bespoke treatment with no number until the salon and
  customer actually talk.

Separately, a salon offering something outside the ~14 seeded system categories had only one
path: `CategoryRequest` (`catalog/category-requests.controller.ts`), which asks an admin to
add it to the *global* category list — the right tool for genuinely growing the marketplace
taxonomy, but overkill (and a multi-day wait) for a salon that just wants a private label
like "خدمات ویژه" for its own organization.

## Pricing types

`SalonService.pricingType` (`fixed | from | range | quote`, default `fixed`) plus two new
nullable columns:

| pricingType | `price` | `priceMax` | Meaning |
|---|---|---|---|
| `fixed` | required | must be null | Exactly what it always meant — the definite price |
| `from` | required (the floor) | must be null | "Starts at `price`, may be more" |
| `range` | required (the minimum) | required, `>= price` | "Between `price` and `priceMax`" |
| `quote` | must be null | must be null | No number at all — "price upon consultation" |

Enforced at three layers, each a genuine backstop for the one above it:
1. `apps/api/src/salons/service-pricing.util.ts`'s `validatePricingShape()` — called from
   `SalonServicesService` before ever touching the DB, so a malformed request gets a clear
   Persian `BadRequestException` naming exactly what's wrong.
2. `salon_services_pricing_shape_chk` (migration `1756700000000-service-pricing-types.ts`) —
   the same shape as a DB `CHECK`, the actual last-word guarantee no code path (a raw SQL
   fix-up, a bug, a future migration) can violate.
3. `discountPercent` is additionally constrained (`salon_services_discount_fixed_only_chk`)
   to be non-null only when `pricingType = 'fixed'` — a percentage off a price that isn't
   fixed would misrepresent what the customer actually pays, so `discountPercent` is not a
   concept FROM/RANGE/QUOTE services have at all.

**Every existing service backfilled to `pricingType = 'fixed'`, `price`/`discountPercent`
untouched** — this is 100% behavior-preserving for every service that existed before this
migration; nothing about a FIXED service's booking, search, or display path changed.

### Duration follows the identical shape

`durationMax` (nullable int) is the same idea applied to duration: "takes about 2–4 hours"
is `durationMin: 120, durationMax: 240`. **The booking/availability engine never reads
`durationMax` at all** — `computeAvailableSlots` (`availability.util.ts`) and every overlap
check in `bookings.service.ts` use `durationMin` exclusively, exactly as before. This was a
deliberate design constraint, not an oversight: `durationMin`'s job as "the one deterministic
number the slot-stepping loop and every double-booking check can rely on" is unchanged;
`durationMax` is purely informational, shown to the customer alongside it.

### Updating a service's pricing type is atomic

`reconcilePricingOnUpdate()` (same util file) treats a `PATCH` that includes `pricingType` as
an all-or-nothing switch: any price/priceMax/discountPercent field **not** supplied in that
same request is cleared to `null` rather than left over from the old type (which would
otherwise leave a `range` service's stale `priceMax` sitting on a now-`quote` row, tripping
the shape CHECK). A bare price/discount edit with no `pricingType` in the request is
completely unaffected — this is today's pre-existing PATCH behavior, verbatim.

## Salon custom categories

A new table, `salon_custom_categories` (`salon_id`, `name`, `UNIQUE(salon_id, name)`), and a
nullable `salon_services.custom_category_id`, mutually exclusive with `category_id` via
`salon_services_category_shape_chk` (exactly one of the two set — the same "two nullable
columns + CHECK" shape this codebase already uses for `bookings.discount_percent`/
`discount_fixed_amount`).

- **Self-serve, immediate, no admin approval** — `POST /salons/mine/custom-categories`
  creates and returns a usable category in one call. This is deliberately a *different*
  mechanism from `CategoryRequest`, which still exists unchanged for a salon that wants its
  suggestion added to the **global** marketplace taxonomy.
- **Never pollutes global search/taxonomy** — a custom category is never inserted into
  `salon_categories` (the search-tag join table) or returned from `GET /categories` (the
  public system-category list). A service under a custom category is simply not filterable
  by system category in search; it's still findable via the salon's own page, name search,
  etc. This is the explicit, accepted scope of "private label," not a bug.
- **Restrict-on-delete**, matching `service_categories`' own precedent: `DELETE
  /salons/mine/custom-categories/:id` 409s (Persian message) if any of the salon's own
  services still reference it.
- **Tenant-isolated**: `SalonServicesService` checks `customCategoryId` belongs to the
  calling salon before allowing a service to use it (`ForbiddenException` otherwise) — a
  salon can never point a service at another salon's private category.

## Packages — catalog/display only, deliberately not atomically bookable

`SalonPackage` (`salon_id`, `name`, `description`, `isActive`, the same
`pricingType`/`price`/`priceMax` shape as services, plus optional `durationMin`/`durationMax`
— all purely informational) and `SalonPackageItem` (`package_id`, `service_id`,
`sort_order`), a many-to-many ordered membership table.

**A package is never itself booked, paid for, refunded, or commissioned.** Booking a
"Bridal Package" means booking each of its constituent services separately, through the
existing, completely unchanged single-service `POST /bookings` flow. This was a deliberate
design decision (not a missing feature) after weighing what safely supporting one atomic
multi-service booking would actually require: multi-worker eligibility, multi-duration
sequential-or-parallel scheduling, split refund/commission/review attribution across items —
none of which the booking engine has today, and building it is a project-sized undertaking of
its own, not a natural extension of this one. Making a package purely informational sidesteps
every one of those questions entirely, at the cost of the customer clicking into each item
individually rather than "booking the whole package in one action."

- `POST/PATCH /salons/mine/packages` validate `serviceIds.length >= 2` (a "package" of one
  isn't a bundle) and that every referenced service belongs to the calling salon
  (`BadRequestException` otherwise — tenant isolation, same posture as custom categories).
- `PATCH` replaces the item list **wholesale**, not as a diff — matches how the provider-panel
  form always submits the complete current selection; deliberately simpler than tracking
  individual add/remove operations for a feature with no per-item metadata beyond order.
- Public read: `GET /salons/:slug/packages` (`public-salon-content.controller.ts`) joins each
  package's items back to their own `salon_services` row for display (name, price, duration)
  in one extra query, not N+1.
- Deactivation is the same one-way "archive" pattern as services (`isActive: false`, no
  reactivation path) — matches `SalonServicesController.archive()`'s own precedent exactly.

## Booking: only FIXED services go through the automatic online flow

`BookingsService.createHoldImpl` (the real, money-moving path for `POST /bookings`) now
rejects any service whose `pricingType !== 'fixed'` with a `BadRequestException` before doing
anything else — automatic deposit/payment collection only ever makes sense against one known
price, and FROM/RANGE/QUOTE genuinely don't have one until a real conversation with the salon
settles on one. `POST /coupons/validate` (the checkout price-preview endpoint) carries the
identical restriction for the identical reason — there's no price for a coupon to discount.

**The manual/offline booking path is where a non-fixed service's real price gets recorded.**
`CreateManualBookingDto` gained an optional `priceOverrideToman`:
- **Required** when the service isn't `fixed` — the owner, having actually agreed a price
  with a real customer (by phone, in person, whatever), types in that number, which becomes
  `priceSnapshot` directly (bypassing `resolveBestPriceWithWinner`/discount resolution
  entirely — consistent with how manual bookings already skipped discount resolution for
  FIXED services before this change: `createManualImpl` was never a discount-aware code
  path).
- **Forbidden** when the service is already `fixed` — its own price is already definite, so
  a second, possibly-conflicting number would only invite confusion about which is real.

This means: the money-critical automatic engine (deposit calculation, discount resolution,
`priceSnapshot`/`originalPriceSnapshot` recording, everything downstream in invoicing/CRM)
never had to learn about non-deterministic prices at all — it simply never sees one. A
FROM/RANGE/QUOTE service is only ever priced by a human, at the one moment a human actually
knows the real number.

## Search stays honest: a FROM/RANGE floor is not a promise of an upper bound

`search.service.ts`'s price logic (the `min_price` subquery and the `priceMin`/`priceMax`
`EXISTS` filter) is now pricing-type-aware, extending the same inline-SQL pattern the query
already used for the FIXED-only discount computation:

- **`min_price`** (the salon card's "از X تومان") — `MIN` across FIXED's own discounted price
  **and** FROM/RANGE's own floor `price` column (discounting never applies to non-FIXED
  types, so the raw `price` already IS the honest floor). QUOTE contributes nothing (its
  `price` column is `NULL`, and `MIN()` ignores `NULL`s) — exactly like an inactive service
  already did before this change.
- **`priceMax` filter** ("show me salons under X toman") — **only** FIXED (discounted price
  `<= X`) and RANGE (its own known ceiling `price_max <= X`) can ever satisfy this. **A FROM
  service never matches a `priceMax` filter**, even if its floor is well under `X` — its real
  price could be arbitrarily higher, and asserting "definitely affordable" would be a false
  positive search.service.spec.ts explicitly guards against (see the "pricing-type-aware
  search" describe block in `test/search.e2e-spec.ts`).
- **`priceMin` filter** ("show me salons at least X toman") — FIXED, FROM, and RANGE can all
  satisfy this from their own floor `price` column, since the real price is always `>=` that
  floor by definition. QUOTE never satisfies either bound.

`GET /salons/:slug/services` (the public salon-page endpoint) still returns raw
`SalonService` entity rows — no new server-side computed field was needed, since
`pricingType`/`price`/`priceMax`/`durationMax` are now simply columns on the entity the
frontend renders directly.

## Frontend

**Provider panel** (`apps/provider-panel/src/pages/ServicesView.vue`): a pricing-type radio
card group (reusing `SalonSettingsView.vue`'s established card-radio pattern) with
conditional price/priceMax inputs and a "٪ تخفیف" field shown only for `fixed`. The category
picker is one flat `AppSelect` whose option values are prefixed `sys:<id>`/`custom:<uuid>` —
a single list can then represent "exactly one of two mutually exclusive FK types" with no
optgroup support needed. A "+ دسته‌بندی سفارشی برای همین سالن" link creates and selects a
custom category immediately, distinct from the existing "درخواست دسته‌بندی جدید" (admin
request) flow. Changing an *existing* service's pricing type opens a small inline panel
(radio group + fields, matching the create form) rather than the bare blur-commit price/
discount inputs FIXED services keep — switching type is an atomic action, not a field tweak.
A new `PackagesView.vue` (linked from the dashboard's quick-link grid, `/packages`) covers
package CRUD: a checkbox list to pick 2+ of the salon's own active services, the same
pricing-type radio group (informational only here), and per-package cards showing its
member-service chips.

**User app** (`apps/user-app/app/pages/salons/[slug].vue`): each service row branches on
`pricingType` — FIXED unchanged (discount badge + struck-through original + final price,
clickable into booking); FROM renders "از X تومان"; RANGE renders "X تا Y تومان"; QUOTE
renders "قیمت توافقی". A non-FIXED row keeps its `NuxtLink` markup (so `href` still points at
a real URL for a screen reader/crawler, and no markup needed duplicating across two template
branches) but the click is prevented and a "برای رزرو این خدمت باید ابتدا با سالن هماهنگ
کنید" note is shown instead of a bookable price. The sticky footer's "شروع از X تومان" now
computes its floor exactly like `search.service.ts`'s `min_price` (FIXED discounted +
FROM/RANGE floor, QUOTE excluded). A new "پکیج‌ها" section lists each package with its
informational price and member-service chips — no booking action on the package itself,
matching the backend's own catalog-only design.

**Admin panel**: deliberately unchanged. Custom categories are private to their owning
salon and don't need admin visibility (the product principle this initiative followed
throughout: don't give admin unnecessary control over salon-internal organization); packages
carry no new moderation surface since they're not user-generated content in the same risk
class as, say, a public review or a story image.

## What deliberately is NOT here

- **No service options/variants** (hair length, with/without bleach, etc.). A salon
  achieves the identical practical outcome today, with zero schema/engine changes, by
  creating separate named services ("رنگ مو — موی کوتاه" / "رنگ مو — موی بلند"), each
  independently priced and durationed. Real variants (one service with several priced/
  durationed sub-options) would need genuine surgery on booking creation (which concrete
  service ID does the customer actually book?) and slot generation (each variant
  potentially needing its own duration, which today's "one `durationMin` per bookable unit"
  invariant doesn't support) — deferred because nothing in the current product actually
  needs it yet, not because it's hard to imagine wanting later. The schema here doesn't
  foreclose adding it: a hypothetical future `service_variants` table referencing
  `salon_services(id)` slots in cleanly on top of everything above.
- **No atomic package booking** — see "Packages" above.
- **No admin visibility into custom categories or packages** — see "Frontend" above.
