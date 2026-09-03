# 33 — Salon-initiated customer SMS + monthly quota

Phase 6 of the monetization/subscription initiative
(`docs/superpowers/specs/2026-08-30-monetization-platform-design.md`). Lets a salon owner
send a free-text SMS to one of their own customers (from the CRM's customer detail screen),
gated by a real monthly quota read from the Phase 2/3 entitlement engine — the first feature
to actually enforce an entitlement, rather than just resolving one.

## No new send infrastructure

`CustomerSmsService` (`apps/api/src/crm/customer-sms.service.ts`) reuses the existing
`SmsProvider` interface — the same one `notifyConfirmed`/`notifyOne` already send through
elsewhere. There is no new gateway, template system, or provider abstraction.

**Approved salons only.** `send()` looks the salon up via `SalonsService.findById` and 409s
unless `status === 'approved'` — the same standing `approve()` already requires before a
salon can take on committed work. A suspended/rejected salon keeping a free-text SMS channel
to every past customer, on the platform's own sender number, is exactly what suspension
exists to stop; the CRM read side stays available so nothing about their own records is lost.

**Always attributed to the salon on the wire.** The text actually sent is
`"${salon.name}: ${message}"`. The message is free-form and goes out on the platform's
shared sender number, so an unprefixed message could pass itself off as the platform ("your
booking was cancelled, pay here"). The logged `salon_sms_messages.message` stays the owner's
own unprefixed text — the prefix is delivery framing, not content — so quota accounting and
the audit trail are unaffected.

**Deliberately not best-effort.** Every other SMS call site in this codebase
(`notifyConfirmed`, `notifyCancelled`, ...) is a side effect of something else and swallows a
send failure (`.catch(() => {})`) so it never blocks the primary operation. This send **is**
the primary operation the owner asked for — a real failure propagates as a real error instead
of silently pretending the message went out.

## Quota resolution

`entitlements.smsMonthlyQuota` (a plain number in the Phase 2/3 `Plan.entitlements` jsonb bag)
is read via the existing `SubscriptionsService.getEntitlements()` seam — no new resolution
logic. A missing or non-numeric value resolves to **0 (blocked)**, not unlimited — a plan an
admin hasn't configured must never grant free-form SMS for nothing, matching this codebase's
"off/zero until an admin explicitly opts in" posture (the global payment toggle's own
seeded-off default). This is a deliberate departure from the referral system's own
`maxReferralsPerReferrer: null → unlimited` convention — different domain, different default
risk: an SMS quota bounds a genuine per-message platform cost, so the safe default leans the
other way.

The migration backfills the placeholder `{"smsMonthlyQuota": 20}` onto every existing plan
(today, only `free`) rather than shipping it silently at zero — matching the initiative's own
"every plan name/price/limit ships as an admin-editable placeholder" decision. Admins raise or
lower it per plan via the existing Plans CRUD UI, or per salon via the existing entitlement
override endpoint (`PATCH /admin/salons/:id/subscription/overrides`) — **no new admin
endpoint or UI was needed for this phase.**

## Usage tracking: an append-only log, not a mutable counter

`salon_sms_messages` (one row per successful send: salon, customer, phone, message, sender,
timestamp) is both the audit trail and the quota-usage source of truth — usage for the current
period is `COUNT(*)` within the current **Jalali calendar month** (`jalaliMonthOf`/
`jalaliMonthBounds`, the same utility `MonthlyInvoiceGenerationJob` already uses), not a
rolling 30-day window and not a separately-maintained counter that could drift from reality.
The bounds are applied as a half-open `[periodStart, periodEnd)` range
(`And(MoreThanOrEqual(periodStart), LessThan(periodEnd))`), matching every invoicing query —
`periodEnd` *is* the next month's first instant, so an inclusive `Between` would have counted
a send at exactly midnight against both months.

**Accepted race window.** The check-then-send-then-insert sequence has no lock: two concurrent
sends near the quota boundary could both pass the count check. This is a deliberate MVP
simplification, not an oversight — unlike the referral system's per-referrer cap (real money
per redemption, and the reason a row lock was added there after an adversarial test proved the
race), overrunning an SMS quota by one or two messages during a human owner's own manual,
low-frequency action costs a fraction of a cent and nothing more. Revisit only if real usage
patterns ever show otherwise.

## Endpoints

Both on the existing `SalonCustomersController` (`salons/mine`, `AuthGuard, SalonOwnerGuard`)
— no new controller:

- `GET sms-quota` — `{ quota, used, remaining }` for the caller's own salon.
- `POST customers/:customerId/sms` — `{ message }` (1–500 chars); reuses
  `CrmService.requireCustomerBelongsToSalon`/`getCustomerContact` for the same ownership
  isolation the CRM feature already established (a customer only exists for a salon if they
  have a real booking there). 409 if the salon is not `approved`, and 409 once the quota is
  exhausted (checked in that order — an unapproved salon never learns its quota standing
  through this route).

Owner-initiated, self-service — deliberately not audited, same reasoning as every other
`salons/mine/...` self-service action in this codebase.

## Provider-panel UI

`CustomerDetailView.vue` gained a compose card (remaining-quota line + textarea + send
button) above the booking history. `CustomersView.vue` gained a small remaining-quota line
near the page header, fetched from the same endpoint, so an owner sees their standing before
opening a specific customer.

## Deliberate cuts

No message templates/canned replies, no scheduled/bulk send, no delivery-status tracking
(the same posture the platform already takes toward its own automated SMS — Kavenegar/
PayamakYab's own delivery callbacks aren't wired into anything user-facing), no SMS history
view in the UI (the log exists in the database for support/audit, not surfaced as a screen
yet), and quota resets are implicit (a new Jalali month simply has no rows yet) rather than a
cron-driven reset job — there's nothing to reset since usage is derived, not stored as a
counter.

## Every salon-triggered SMS is metered (2026-09-03)

The quota originally governed exactly one path — the CRM free-text message — while two
other salon-triggerable paths sent SMS with no accounting at all:

- `POST /salons/mine/workers` — an arbitrary phone gets a salon-worded invite. The roster
  row is unique per `(salon, user)`, but add/remove/re-add is not, and the number of
  distinct phones a salon can name is unbounded.
- `POST /salons/mine/bookings` — a confirmation SMS to any phone the salon types in.

So "per-salon SMS spend is bounded" was simply not true. `SalonSmsQuotaService`
(`sms/salon-sms-quota.service.ts`) is now the single meter for all three, writing to the
same `salon_sms_messages` log and reading the same `smsMonthlyQuota` entitlement through
the [entitlement engine](./35-entitlement-engine.md).

Two entry points, because the callers differ in kind:

- **`consumeOrThrow` semantics** for an action the owner explicitly asked for (the CRM
  message): being over quota is a real answer they must see, so it surfaces as a 409.
- **`tryConsume`** for an SMS that is a side effect of some other successful action (a
  worker was added; a walk-in was booked): running out of budget must **not** fail the real
  operation. The roster row and the booking still stand; the message is skipped and logged.

A customer-initiated online booking is deliberately **not** metered — the customer, not the
salon, caused it. Only the salon-entered manual booking is.

The service lives in its own `SalonSmsQuotaModule` rather than inside `SmsModule`: it needs
the entitlement engine, and `SubscriptionsModule → AuthModule → SmsModule` would close a
module cycle. Splitting it out is also honest — it never sends anything. It meters and
records, and the caller passes the send in as a closure, so it has no need of
`SMS_PROVIDER`.

