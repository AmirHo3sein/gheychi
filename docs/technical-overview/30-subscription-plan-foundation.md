# 30 — Subscription/plan foundation

Phase 2 of the monetization/subscription initiative
(`docs/superpowers/specs/2026-08-30-monetization-platform-design.md`). Introduces the
`Plan`/`SalonSubscription` backbone every later phase (entitlement enforcement, salon CRM,
SMS quota, custom-handle access) is meant to read from. **Backend-only** — no provider-panel
or admin-panel UI ships in this phase; the owner decision that the salon owner picks only
`automatic`/`manual_approval` booking mode, nothing commercial, means there is no
owner-facing subscription surface to build yet, and the admin dashboard for browsing/
managing subscriptions is explicitly the next phase's job.

## Data model

`plans` (`apps/api/src/subscriptions/plan.entity.ts`) — an admin-configurable tier. FREE/
PLUS/PREMIUM are launch examples, not hardcoded concepts: `name`, `description`,
`monthlyPriceToman`, `isActive`, `sortOrder`, and `entitlements` are all editable via
`PATCH /admin/plans/:id`. `key` (e.g. `'free'`) is the one field set at creation only —
absent from `UpdatePlanDto` entirely, same reasoning as `salon.slug`'s current immutability:
later phases will branch on `key` in code, and letting an admin silently rename it would
break whichever check keyed off it.

`entitlements` is an open `jsonb` bag (`Record<string, unknown>`), not a fixed set of typed
columns. No phase before this one enforces any specific key — CRM caps, SMS quota,
custom-handle access all belong to the phases that actually gate on them. This is
deliberate: the backbone is stable now, without inventing meaning for keys nothing reads yet.

`is_default` — exactly one plan may carry this at a time, DB-backstopped via a partial
unique index (`CREATE UNIQUE INDEX ... ON plans ((true)) WHERE is_default = true`, the same
"index a constant under a filtered predicate" idiom `schedule_exceptions` already uses for
its own "at most one whole-salon closure per date" rule). It is:
- the plan a newly created salon starts on (`SubscriptionsService.createDefaultSubscription`,
  called inside `SalonsService.createForOwner`'s own transaction — a salon can never even
  momentarily exist without a resolvable subscription);
- the fallback a salon's entitlements resolve to if its own subscription is ever canceled
  (`SubscriptionsService.getEntitlements`).

Moving the flag to a different plan (`PlansService.update`) unsets every other plan's flag
first, in the same transaction — the same "setting a new cover photo unsets every other
cover row" precedent salon-photos.service.ts already established. Deleting the default plan,
or unsetting `isDefault` without moving it elsewhere first, is refused (`ConflictException`)
— the platform must never be left with zero resolvable default.

`salon_subscriptions` (`salon-subscription.entity.ts`) — one row per salon (`salon_id` is
`UNIQUE`, mirroring `salon.ownerId`'s own one-salon-per-owner simplicity), not an
append-only history. Deliberate: there is no billing engine yet to make repeated period rows
meaningful (that is explicitly deferred to the last phase in the initiative — see the
monetization spec). `status: 'canceled'` still has real, useful meaning without billing: it
means an admin ended the salon's specific paid arrangement and it reverted to the platform
default plan, not that anything expired automatically.

## Entitlement resolution

`SubscriptionsService.getEntitlements(salonId)` is the one seam every later phase is meant
to read from: returns the salon's live plan entitlements when its subscription is `active`,
falling back to the current default plan's entitlements otherwise (canceled or, in
principle, missing). **Not wired into any enforcement yet** — that is deliberately the next
phase's job, so this phase can be verified in isolation before anything depends on it.

## Admin surface

- `GET`/`POST /admin/plans`, `PATCH`/`DELETE /admin/plans/:id` (`admin-plans.controller.ts`)
  — full plan CRUD. Delete uses the same restrict semantics as category delete: a plan
  referenced by any salon's subscription cannot be deleted, enforced by the database's own
  FK behavior (`isForeignKeyViolation`), not an app-level pre-check.
- `GET`/`PATCH /admin/salons/:salonId/subscription`, `POST .../subscription/cancel`
  (`admin-salon-subscriptions.controller.ts`) — view, reassign, or cancel a salon's
  subscription. Reassigning a canceled subscription reactivates it (`status` back to
  `active`, `canceledAt` cleared).

Every mutation goes through the existing `AuditInterceptor`/`@AuditAction` pattern — no
second audit system. `SubscriptionsModule` has no dependency on `SalonsModule`: salon
existence is enforced by `salon_subscriptions.salon_id`'s own FK, not a `Salon` repository
lookup, which is what lets `SalonsModule` import `SubscriptionsModule` (for
`createDefaultSubscription`) without a cycle.

## Migration safety

`1755600000000-subscriptions-and-plans.ts` seeds exactly one `free` plan
(`monthly_price_toman: 0`, `is_default: true`) and backfills a `salon_subscriptions` row for
every salon that already existed at migration time — no salon, old or new, is ever left
without a resolvable subscription, per the monetization spec's migration-safety requirement.
