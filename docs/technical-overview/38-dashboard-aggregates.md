# 38 — Dashboard Aggregates (admin summary, provider capacity, bookings window)

Shipped 2026-10-16 as the backend half of wave 1 of the brand + UX redesign. Four additive,
backward-compatible API changes that let the redesigned admin and provider dashboards show
numbers that are computed by the database, never by counting a fetched list page:

| Change | Route | Guard |
|---|---|---|
| New | `GET /api/admin/dashboard-summary` | `RolesGuard` + `@Roles('admin')` |
| New | `GET /api/salons/mine/capacity?from=&to=` | `SalonOwnerGuard` |
| Extended | `GET /api/salons/mine/bookings?from=&to=` | `SalonOwnerGuard` (unchanged) |
| Extended | `GET /api/admin/notifications` (+ `PATCH /:id/read`): adds `severity` to each item | Admin (unchanged) |
| Extended (wave 2) | `GET /api/admin/notifications?type=&severity=`: optional filters | Admin (unchanged) |
| New (wave 2) | `GET /api/admin/notifications/unread-counts` → `{ total, critical, warning, info }` | Admin (same controller) |

Both new controllers are registered in `route-guard-audit.spec.ts` (`AdminDashboardController`,
`SalonCapacityController`).

## 1. `GET /api/admin/dashboard-summary`

`apps/api/src/admin-dashboard/` (`AdminDashboardService`). It replaces the old admin dashboard
approach, which fetched the first 100 rows of `/admin/salons`, `/admin/users` and
`/admin/reviews` and counted them in the browser, so it silently undercounted once a list held
more than 100 rows. Every figure here is a SQL `COUNT`/`SUM ... GROUP BY`. The service runs four
queries concurrently (one row of scalar counts, the zero-filled 30-day series, today by status,
subscriptions by plan) plus one Redis `GET`.

**Days are Asia/Tehran calendar days.** Postgres computes them from the request instant
(`$now AT TIME ZONE 'Asia/Tehran'`). These are the same boundaries the panels' `tehran-day.ts`
uses. The range predicates run on the raw `timestamptz` columns, so indexes can serve them, and
the Tehran date is applied only when bucketing. "The last 30 days" means today plus the 29
days before it.

```jsonc
{
  "generatedAt": "2026-10-16T08:00:00.000Z",
  "today": "2026-10-16",                       // Tehran date the "today" figures are for
  "salons": { "byStatus": { "pending": 1, "approved": 1, "rejected": 0, "suspended": 0 }, "total": 2 },
  "users":  { "byRole": { "customer": 2, "provider": 2, "admin": 1 }, "suspended": 1, "total": 5 },
  "bookings": {
    "today": {                                  // appointments whose starts_at falls today, by CURRENT status
      "total": 1, "pending": 0, "confirmed": 0, "completed": 1, "noShow": 0,
      "cancelled": 0,                           // every DEAD_BOOKING_STATUSES member (cancelled_*, rejected_by_salon, expired)
      "byStatus": { "completed": 1 }            // raw per-status counts, only statuses that occur
    },
    "last7Days":  { "created": 3, "completed": 1 },
    "last30Days": { "created": 3, "completed": 1 },
    "series": [                                 // exactly 30 entries, oldest first, zero-filled
      { "date": "2026-09-17", "created": 0, "completed": 0 },
      // ...
      { "date": "2026-10-16", "created": 2, "completed": 1 }
    ],
    "pendingApprovalNow": 1                     // bookings in pending_approval right now (any date)
  },
  "payments":   { "refundPending": 1 },         // payments.status = 'refund_pending'
  "moderation": { "openReports": 1, "pendingCategoryRequests": 1 },
  "revenueLast30Days": { "grossAmount": 100000, "commissionAmount": 10000, "accruals": 1 }, // Toman
  "subscriptions": {
    "byPlan": [ { "planId": "uuid", "planKey": "free", "planName": "رایگان", "activeCount": 2 } ] // every plan, admin sort order
  },
  "alerts": { "unreadCritical": 1, "unreadWarning": 2 }, // for the CALLING admin (read state is per admin)
  "backup": { "lastSuccessAt": "2026-10-16T07:00:00.000Z", "status": "ok", "staleAfterHours": 27 }
}
```

Field semantics worth knowing before you put a label on them:

- **`series[].created`** counts bookings by `created_at`, meaning when they were made.
  **`series[].completed`** counts bookings whose *appointment* (`starts_at`) fell on that day and
  whose status is now `completed`. There is no `completed_at` column, and `booking_events`
  only covers bookings created after that table existed. The appointment day is the honest
  bucket that covers every row.
- **`revenueLast30Days`** reads only the commission ledger's `commission_accrued` rows
  (`financial_transactions`, written when a booking reaches `completed`/`no_show`). `grossAmount`
  is the deposit money that was actually captured, never the full service price
  ([14](./14-commission.md)). With `feature_online_payment_enabled` off, the ledger stays empty,
  so this reads 0. That is the true figure, not missing data.
- **`alerts`** counts unread `type = 'alert'` notifications for the caller. A pre-column alert
  (`severity IS NULL`) counts as a warning, never as critical (see §4).
- **`backup.status`** is `ok` | `stale` (more than 27h since the last success, the same threshold
  as `BackupStalenessCheckJob`) | `missing` (key absent or unparseable, matching the job's
  reading) | `unknown` (Redis errored; the rest of the dashboard still returns).

## 2. `GET /api/salons/mine/bookings?from=&to=`

Optional ISO-8601 instants (`ListSalonBookingsQueryDto`, `@IsISO8601({strict:true})`) that filter
on `starts_at`, with `from` inclusive and `to` exclusive. Either bound may be given alone. If
both are omitted, the query is byte-for-byte the previous one (`where: { salonId }`). The
response shape, the `startsAt DESC` order and the 1,000-row cap are all unchanged. `from >= to`
returns 400. The caller converts a Tehran day to instants (`startOfTehranDayIso`/`endOfTehranDayIso`
in the panels). Example for "Tehran today", 2026-10-16:
`?from=2026-10-15T20:30:00.000Z&to=2026-10-16T20:30:00.000Z`.

## 3. `GET /api/salons/mine/capacity?from=&to=`

`booking/salon-capacity.service.ts` + the pure `booking/capacity.util.ts`. `from`/`to` are Tehran
calendar dates (`YYYY-MM-DD`), with `from` inclusive and `to` exclusive. They default to today
through today+7 (7 days). The window may span at most 31 days. Anything else returns 400: a
bad date, a full timestamp, `from >= to`, or more than 31 days.

It uses the availability engine's own model so that "open" means what the slot grid means:

- **Open minutes** come from the weekday's `working_hours` ranges minus that date's whole-salon
  `schedule_exceptions` row. A whole-day exception closes the day. A partial one is removed with
  the same `subtractInterval` the slot grid uses. Overlapping hour rows are merged so time is
  never counted twice. Wall-clock times are converted with `iranWallClockToInstant`.
- **Capacity minutes** = open minutes × `salons.capacity`. That one salon-wide chair count is the
  only concurrency limit `computeAvailableSlots` applies. Workers and per-worker time off only
  narrow availability when a customer picks a specific worker, so they are deliberately **not**
  a capacity dimension here.
- **Booked minutes** come from `SLOT_BLOCKING_STATUSES` bookings (`pending_approval`,
  `pending_payment`, `confirmed`), counted only for the part that falls inside open hours.
  A manual booking recorded after closing uses up no on-offer capacity. Free time is floored at
  0 if bookings exceed capacity.
- The result is minutes, not slots. A slot count depends on which service's duration you walk the
  day with, so there is no single honest "empty slots" number for a salon.
- Today counts as a whole day, including the part that is already over.

```jsonc
{
  "from": "2026-10-17",
  "to": "2026-10-19",
  "capacity": 2,                                // salons.capacity the minutes are multiplied by
  "days": [
    {
      "date": "2026-10-17", "weekday": 6,       // 0 = Sunday, Tehran
      "closedReason": null,                     // null | "no_hours" | "closed_exception"
      "openMinutes": 480, "capacityMinutes": 960,
      "bookedMinutes": 60, "freeMinutes": 900,
      "freePercent": 94,                        // null when nothing was on offer: closed is not "0% free"
      "bookingsCount": 1                        // slot-blocking bookings STARTING that day
    },
    { "date": "2026-10-18", "weekday": 0, "closedReason": "closed_exception", "openMinutes": 0,
      "capacityMinutes": 0, "bookedMinutes": 0, "freeMinutes": 0, "freePercent": null, "bookingsCount": 0 }
  ],
  "totals": { "openMinutes": 480, "capacityMinutes": 960, "bookedMinutes": 60, "freeMinutes": 900, "freePercent": 94 }
}
```

The capacity endpoint makes three queries (hours, whole-salon exceptions, and blocking bookings
that overlap the window), with no per-day round trips. It is scoped by `req.salonId` from
`SalonOwnerGuard`. A caller without a salon gets 404, which is the guard's standard behaviour.

## 4. Admin notification severity

`AlertsService.raise()` always received a `severity` (`critical` pages by SMS, `warning` does not)
but never stored it, so the admin bell could not tell a stuck refund from a resubmitted salon.
Migration `1758400000000-admin-notification-severity` adds `admin_notifications.severity`
(`varchar(16) NULL`, CHECK `critical|warning`, plus a partial index on `type = 'alert'`), and
`AlertsService` now writes it through `AdminNotificationsService.emitAlert()`.

Every item of `GET /admin/notifications`, and the response of `PATCH /admin/notifications/:id/read`,
now carries `severity: 'critical' | 'warning' | 'info'`, derived by `severityOf(type, stored)`:

- an alert row reports its stored severity;
- an alert row written before the column existed (NULL) reports `warning`, because nothing records
  that it was critical, and the migration does not backfill a guess;
- every other notification type reports `info`.

The field is added alongside the existing ones and no existing field changed.

### Filters and per-severity unread counts (wave 2)

`GET /admin/notifications` accepts two more optional query params, each composable with
`unread`, `page` and `pageSize`:

- `type` — one of `alert`, `report_created`, `salon_resubmitted`, `salon_material_edit`,
  `category_requested` (`ADMIN_NOTIFICATION_TYPES` in `admin-notification.entity.ts`). Any other
  value is a 400. A new `emit()` type has to be added to that list before it can be filtered on.
- `severity` — `critical` | `warning` | `info`, matched against the **displayed** severity, not
  the stored column: `info` matches every non-alert row, and a NULL-severity (pre-column) alert
  matches `warning`. The SQL predicate (`EFFECTIVE_SEVERITY_SQL` in
  `admin-notifications.service.ts`) is the database twin of `severityOf()`, and the e2e suite
  asserts the two agree.

`GET /admin/notifications/unread-counts` returns the caller's unread rows (same per-admin read
state as `unread-count`) as `{ total, critical, warning, info }` from one aggregate query, with
the same rule: **a NULL-severity alert counts as `warning`**, and `total` is always the sum of
the three. `GET /admin/notifications/unread-count` keeps its `{ count }` shape for existing
callers.

## Tests

- Unit: `admin-dashboard/admin-dashboard.service.spec.ts`, `booking/capacity.util.spec.ts`,
  `booking/salon-capacity.service.spec.ts`, the `listForSalon date window` block in
  `booking/bookings.service.spec.ts`, and `severityOf`/`emitAlert` in
  `admin-notifications.service.spec.ts` (plus the filter parameter binding and `unreadCounts`).
  `alerts.service.spec.ts` now asserts that the severity is
  passed through.
- E2E: `test/admin-dashboard-summary.e2e-spec.ts` covers 401/403, every count against seeded rows,
  Tehran-midnight bucketing (23:59 vs 00:01 Tehran fall on the same UTC date), the ledger sum,
  stale and missing backup states, and `severity` on the notifications list.
  `test/salon-capacity.e2e-spec.ts` covers 401/404, a real computed day, the exception day,
  cancelled bookings no longer counting, tenant isolation, defaults, 400s, and the bookings
  window (inclusive/exclusive bounds, isolation, 400s). `test/alerts.e2e-spec.ts` asserts that
  a refused refund's alert is stored as `warning`. `test/admin-notifications.e2e-spec.ts` covers
  the `type`/`severity` filters (400 on unknown values, NULL alert → `warning`), their
  composition with `unread`, and `unread-counts` (401/403, counts before and after a read).
