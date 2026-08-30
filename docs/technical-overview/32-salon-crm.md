# 32 — Salon CRM

Phase 5 of the monetization/subscription initiative
(`docs/superpowers/specs/2026-08-30-monetization-platform-design.md`). Gives a salon owner a
customer list, per-customer booking history + free-text notes, and a financial dashboard
summary — entirely derived from data the platform already has, no new customer-identity
concept.

## No separate Customer entity

A "customer" is just any `User` who has at least one `Booking` at this salon. `CrmService`
(`apps/api/src/crm/crm.service.ts`) is a read model over `bookings`/`users`/`payments`/
`financial_transactions`, built with raw SQL aggregation queries — the same
`this.dataSource.query(...)` style `BookingsService.getEarnings` already established for
money/aggregation work in this codebase, rather than TypeORM's query builder.

**Ownership isolation is the query shape, not a separate check.** `getCustomerDetail`'s own
booking-history query is `WHERE salon_id = $1 AND user_id = $2` — an empty result throws
`NotFoundException`. There is no separate "does this user belong to me" branch to forget, and
no way to leak another salon's customer by id-guessing.

## Segmentation

A fixed MVP heuristic (`resolveSegment`, `crm.service.ts`), not admin/owner-configurable —
the same "hardcoded constant, no per-salon knob" precedent story/portfolio caps already set:

- `bookingsCount <= 1` → `new`
- else `daysSinceLastVisit > 60` → `lapsed`
- else → `returning`

## Financial terminology precision

Every number on the dashboard is either directly observed or an explicitly-labeled
derivation — never invented, per the initiative's own stated requirement:

| Field | Source | Meaning |
|---|---|---|
| `grossBookingValue` | `SUM(bookings.price_snapshot)` | The full agreed service price — **not** `financial_transactions.gross_amount`, which is actually the online *deposit* only (that column's own doc comment makes this explicit; conflating the two would have understated real business volume for any partial-deposit booking). |
| `onlineCollected` | `SUM(payments.amount)` where `status = 'paid'` | Real money the platform actually captured. |
| `commission` | `SUM(financial_transactions.commission_amount)` | Real platform commission accrued. |
| `estimatedSalonRevenue` | `grossBookingValue − commission` | Labeled "تخمینی" (estimated) in the UI specifically because it assumes the salon's own cash portion was genuinely collected in full — something this platform cannot observe or verify. |

**Date-window semantics:** all three dashboard queries filter by *when the activity
happened* — `bookings.created_at`, `payments.paid_at`, `financial_transactions.created_at` —
deliberately **not** `bookings.starts_at`. A booking's `starts_at` is almost always a future
appointment slot; filtering the default "last 30 days" window by it would have silently
excluded nearly all real bookings (made in the window, but scheduled further out) while
including old bookings whose appointment happens to fall soon. This was caught during design,
before it ever became a test failure — one consistent "when did this happen" lens across all
three figures, matching `AnalyticsAggregationService`'s own default-window convention.

## Notes

`CustomerNote` (`apps/api/src/crm/customer-note.entity.ts`) — plain free-text, salon-scoped,
`createdBy` stamped from the caller. Owner-only CRUD (create + delete, no edit) via
`salon-customers.controller.ts`; `deleteNote` scopes its `DELETE` by `{id, salonId,
customerId}` together, so a note id alone can never delete across salons.

## Endpoints

All under `@Controller('salons/mine')`, guarded by `AuthGuard, SalonOwnerGuard`
(`apps/api/src/crm/salon-customers.controller.ts`):

- `GET customers` — list, capped at `MAX_CUSTOMERS_LISTED = 2000` (defensive ceiling, no
  pagination UI consumes this yet — same posture as `bookings.service.ts`'s own
  `MAX_SALON_BOOKINGS_LISTED`).
- `GET customers/:customerId` — detail (customer identity, full booking history, notes).
- `POST customers/:customerId/notes` / `DELETE customers/:customerId/notes/:noteId`.
- `GET dashboard-summary` — optional `?from=&to=` ISO8601, defaults to the last 30 days.

Owner-initiated, self-service reads/writes on the caller's own data — deliberately **not**
audited, matching this codebase's established "audit_log = which admin did what" semantics
(the same reasoning already applied to the public-handle self-edit path in Phase 4).

## Analytics: `analytics_events.salon_id`

A new indexed column, lifted out of `event.properties.salonId` (already present on every
booking-funnel event) by `PostgresAnalyticsProvider.track()` — zero changes to
`AnalyticsService.track()`'s own signature or any call site. Not consumed by any CRM endpoint
yet; this is salon-scoped-funnel readiness for a later dashboard, added now because the event
data was already there and the column is cheap.

## Provider-panel UI

- `CustomersView.vue` — dashboard summary (4 KPI tiles) + customer list with segment badges,
  linking to detail.
- `CustomerDetailView.vue` — booking history + notes CRUD.
- Reachable via a new "مشتریان" dashboard quick-link and `/customers`, `/customers/:id`
  routes.

## Deliberate cuts

No customer-initiated contact from the CRM (no in-app messaging — Phase 6 covers salon-sent
SMS separately), no CSV export, no customer merge/dedup (a customer is identified by their
`User` row, and duplicate accounts are an existing, unrelated platform concern), no
admin-side view of a salon's CRM data (this is provider-only, mirroring earnings/reviews).
