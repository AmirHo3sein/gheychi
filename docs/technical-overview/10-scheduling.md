# 10 — Scheduling & Availability

Core files: `apps/api/src/booking/availability.service.ts`, `availability.util.ts`, `salons/schedule.controller.ts`, `salons/working-hour.entity.ts`, `salons/schedule-exception.entity.ts`.

## Inputs to availability

1. **`working_hours`** — weekly recurring open/close ranges per weekday (0–6), managed wholesale via `PUT /salons/mine/hours` (delete-all-then-reinsert on every save — no per-weekday PATCH). No overlap validation between two ranges submitted for the same weekday in one request — a real gap, left to client-side discipline.
2. **`schedule_exceptions`** — one-off closed dates (`isClosed`, default `true`). Consumed directly by the availability algorithm as a per-date blackout.
3. **Existing `bookings`** — every `pending_payment`/`confirmed` booking overlapping the query window, used for both salon-capacity and (if a worker is specified) worker-specific exclusion.

## `AvailabilityService.computeFor(salonId, serviceId, now, workerId?)`

1. Salon must be `approved`; service must exist/be active.
2. If `workerId` given: short-circuits to `[]` immediately if that worker is ineligible for the service (same opt-out `worker_services` check as `createHold` — see [09-booking-engine.md](./09-booking-engine.md)) rather than showing slots that would fail at booking time.
3. `windowEnd = now + 14 days` (`AVAILABILITY_WINDOW_DAYS`).
4. Fetches, in parallel: all `working_hours`, all `schedule_exceptions` where `isClosed`, and all overlapping bookings in the window.
5. Delegates to the pure function `computeAvailableSlots()`.

## The Iran-timezone algorithm — why it's non-trivial

Iran uses a **fixed UTC+3:30 offset year-round** (`IRAN_UTC_OFFSET_MIN = 210`) — DST was abolished in 2022, so no DST table is needed, a deliberate simplification. But `working_hours.open_time`/`close_time` are Postgres `time` columns holding exactly what the provider typed on their own (Iran) wall clock, with no timezone attached, while `bookings.starts_at`/`ends_at` are real UTC instants. Converting correctly between the two, on both a date-boundary edge and an hour-boundary edge, is the entire complexity here.

```mermaid
flowchart TD
    A["now: Date (real UTC instant)"] --> B["iranWeekday(now):\nshift +210min, read UTC weekday"]
    B --> C["look up working_hours for that weekday"]
    C --> D["for each range: walk cursorMin from openMin to closeMin\nin steps of durationMin"]
    D --> E["iranWallClockToInstant(dateStr, cursorMin):\nmidnight-UTC-of-date + (minutes - 210) -> real UTC instant"]
    E --> F{"candidateStart <= now?"}
    F -- yes --> G[skip]
    F -- no --> H{"overlap count >= salon.capacity?"}
    H -- yes --> G
    H -- no --> I{"workerId set AND that worker busy?"}
    I -- yes --> G
    I -- no --> J["include slot"]
```

**The historical bug this fixed** (documented at length in the code): the module used to treat wall-clock digits as if they *were* UTC digits, and required every caller to pass `now` the same skewed way — but `AvailabilityService` passed a genuine `new Date()` while every display path renders instants in `Asia/Tehran`. Net effect: a salon open 09:00–20:00 Iran time offered slots that *rendered* as 12:30–23:30 — three hours past actual closing, and never during the first 3.5 open hours. The fix keeps the wall-clock↔instant conversion strictly at this module's boundary; every `Date` crossing it is a real UTC instant on both sides. A separate, one-time **data migration** (`1753600000000-shift-bookings-to-real-utc-instants`) corrected every pre-existing `bookings.starts_at`/`ends_at` row by the same −3h30m offset.

## Slot grid mechanics

- Slots are a **fixed grid** at exact multiples of the service's `durationMin`, starting at the working-hour range's open time — not staggered, not overlapping.
- A `durationMin <= 0` short-circuits to `[]` immediately — a defensive guard against an infinite loop (`cursorMin += durationMin` never advancing), since this function trusts a DB-read value it can't independently verify.
- A candidate slot is skipped if it's in the past, if salon capacity is already exhausted for that interval, or (when a worker is specified) if that specific worker already has an overlapping booking — **both checks are independent**, mirroring `createHold`'s own dual-check design (a worker "is never merely one more unit of capacity").
- Per-day results are sorted ascending (working-hour ranges aren't guaranteed to be stored in chronological order) and only non-empty days are returned.

## `schedule_exceptions` enforcement

A date present in `schedule_exceptions` with `isClosed=true` causes that entire day to be skipped in the slot loop (`closedDates.has(dateStr)` check) — **this is enforced**, contrary to what might appear true from reading the schedule controller alone (see [07-salon-panel.md](./07-salon-panel.md)'s source module, which only manages the CRUD side and never itself reads exceptions against bookings — the actual read-side enforcement lives entirely in `availability.util.ts`). There is currently no support for a one-off *extended or shortened* hours override — only a binary closed/not-closed per date.

## API surface

```
GET /salons/mine/hours          (owner)  — list working hours
PUT /salons/mine/hours          (owner)  — replace the whole weekly schedule
GET /salons/mine/exceptions     (owner)  — list one-off closures
POST /salons/mine/exceptions    (owner)  — add a closure
DELETE /salons/mine/exceptions/:id (owner)

GET /salons/:salonId/availability?serviceId=&workerId=   (public) — computed open slots, 14-day window
```

## Related documents

- [09-booking-engine.md](./09-booking-engine.md) — how a slot becomes a real booking
- [22-performance.md](./22-performance.md) — availability loads the full overlapping-bookings set into memory rather than pushing the check into SQL; a documented, accepted scaling limit at current volume
