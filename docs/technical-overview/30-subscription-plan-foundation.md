# 30 — Subscription/plan foundation

Phases 2 and 3 of the monetization/subscription initiative
(`docs/superpowers/specs/2026-08-30-monetization-platform-design.md`). Phase 2 introduced the
`Plan`/`SalonSubscription` backbone every later phase (entitlement enforcement, salon CRM,
SMS quota, custom-handle access) is meant to read from, backend-only. Phase 3 adds the
salon-specific entitlement override (the third leg of the owner's GLOBAL flag / PLAN
entitlement / SALON-SPECIFIC override split) plus the first real UI: an admin plan/
subscription management surface and a read-only provider "my plan" page. The owner decision
that the salon owner picks only `automatic`/`manual_approval` booking mode, nothing
commercial, is why the provider-panel page has no controls at all — it exists to inform, not
to let the owner change anything commercial.

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
— the platform must never be left with zero resolvable default. **The default plan can never
be inactive**, either: `update` refuses `isActive: false` on the default plan and
`isDefault: true` on an inactive plan (evaluated against the post-update values, so a single
PATCH can't sneak both through). `createDefaultSubscription` reads `isDefault` only, while
`assignPlan` refuses inactive plans — without this guard a new salon could be born on a plan
no admin was allowed to assign.

`salon_subscriptions` (`salon-subscription.entity.ts`) — one row per salon (`salon_id` is
`UNIQUE`, mirroring `salon.ownerId`'s own one-salon-per-owner simplicity), not an
append-only history. Deliberate: there is no billing engine yet to make repeated period rows
meaningful (that is explicitly deferred to the last phase in the initiative — see the
monetization spec). `status: 'canceled'` still has real, useful meaning without billing: it
means an admin ended the salon's specific paid arrangement and it reverted to the platform
default plan, not that anything expired automatically.

## Entitlement resolution

`SubscriptionsService.getEntitlements(salonId)` is the one seam every later phase is meant
to read from. Three-way precedence, matching the owner's GLOBAL / PLAN / SALON-SPECIFIC
split: an `active` subscription's plan entitlements, with any admin-set per-salon override
(`salon_subscriptions.entitlement_overrides`, jsonb, nullable) merged on top key-by-key;
falls back to the current default plan's entitlements (no override applied — it belonged to
the now-ended arrangement) when the subscription is canceled or missing. `cancel()` also
**clears `entitlement_overrides` outright** (the same UPDATE that sets `canceled`), so a later
`assignPlan` starts from the new plan verbatim instead of silently resurrecting a previous
arrangement's per-salon exceptions. There is no generic enforcement gate — each later phase
wires the specific key it needs, so this backbone stays verifiable in isolation; today the
one consumer is `CustomerSmsService` reading `smsMonthlyQuota`
([33-salon-sms-quota.md](./33-salon-sms-quota.md)).

`GET /admin/salons/:salonId/subscription` (and the provider read-only equivalent below)
return both `plan` (whatever the subscription row nominally references, even while canceled)
and `resolvedEntitlements` (what's actually in effect right now) as distinct fields — an
admin inspecting a canceled subscription can see both "was on Plus" and "currently getting
Free" at once, rather than one number silently standing in for both questions.

## Admin surface

- `GET`/`POST /admin/plans`, `PATCH`/`DELETE /admin/plans/:id` (`admin-plans.controller.ts`,
  UI: `PlansView.vue`, `/plans` in the sidebar) — full plan CRUD, entitlements edited as raw
  JSON (no key has real meaning yet — see above). Delete uses the same restrict semantics as
  category delete: a plan referenced by any salon's subscription cannot be deleted, enforced
  by the database's own FK behavior (`isForeignKeyViolation`), not an app-level pre-check.
- `GET`/`PATCH /admin/salons/:salonId/subscription`, `POST .../subscription/cancel`,
  `PATCH .../subscription/overrides` (`admin-salon-subscriptions.controller.ts`, UI:
  `SalonSubscriptionCard.vue` on `SalonDetailView`'s info tab) — view, reassign, cancel, or
  set/clear a salon's override. Reassigning a canceled subscription reactivates it (`status`
  back to `active`, `canceledAt` cleared). `SetOverridesDto.overrides` distinguishes `null`
  (clear every override) from an object (replace the whole bag) via `@ValidateIf`, not
  `@IsOptional` — the field must always be present in the PATCH body.

Every mutation goes through the existing `AuditInterceptor`/`@AuditAction` pattern — no
second audit system. `SubscriptionsModule` has no dependency on `SalonsModule`: salon
existence is enforced by `salon_subscriptions.salon_id`'s own FK, not a `Salon` repository
lookup, which is what lets `SalonsModule` import `SubscriptionsModule` (for
`createDefaultSubscription`) without a cycle. The provider-facing read-only equivalent,
`GET /salons/mine/subscription` (UI: `PlanView.vue`, `/plan` in provider-panel), lives in
`SalonsModule` instead of `SubscriptionsModule` for the same reason — it needs
`SalonOwnerGuard`, which only `SalonsModule` exports, and `SubscriptionsModule` importing
`SalonsModule` back would close the cycle `SalonsModule` already avoids by importing
`SubscriptionsModule` one-directionally.

## Migration safety

`1755600000000-subscriptions-and-plans.ts` seeds exactly one `free` plan
(`monthly_price_toman: 0`, `is_default: true`) and backfills a `salon_subscriptions` row for
every salon that already existed at migration time — no salon, old or new, is ever left
without a resolvable subscription, per the monetization spec's migration-safety requirement.
`1755700000000-subscription-entitlement-overrides.ts` adds the nullable
`entitlement_overrides` column, defaulting every existing subscription to "no override,
inherit the plan verbatim."

Every Playwright e2e harness (`admin-panel`, `provider-panel`, `user-app`,
`e2e-cross-app`) seeds its fixture salons via raw SQL directly against `salons`, bypassing
`SalonsService.createForOwner`'s own subscription-insert hook entirely. Each `prepare-db.cjs`
now backfills the same invariant the migration does, via one idempotent query run after all
salon seeding: `INSERT INTO salon_subscriptions ... SELECT ... FROM salons s, plans p WHERE
p.is_default = true AND NOT EXISTS (...)`. Discovered via `05-plans-and-subscriptions.spec.ts`
failing against a real seeded salon with no subscription row — a genuine gap in every
raw-SQL seed fixture, not a backend bug (the real `createForOwner` path was never affected).
