# 35 — Entitlement engine

The capability seam every paid feature reads from. Added 2026-09-03, replacing a single
inline check that was the only enforcement the monetization initiative ever wired.

## Why it exists

`plans.entitlements` is an open `jsonb` bag an admin edits as raw JSON, and
`SubscriptionsService.getEntitlements(salonId)` resolves it (default plan → active plan →
per-salon override, merged key-by-key). That resolution was always correct. What was
missing was everything after it: exactly **one** key was enforced anywhere
(`smsMonthlyQuota`), `crmCustomerCap` existed only in a test fixture, and custom-handle and
QR access were named in the entity's own doc comment and read by nothing. The one enforced
key did its own coercion inline, so the second feature to be gated would have copy-pasted
that shape and the third would have quietly diverged from it. A typo in the admin editor
produced a silently-ignored key with no feedback at all.

## The two pieces

**`entitlement-keys.ts` — the registry.** Every key the platform understands, with its kind
and, critically, **what its absence means**. That default is a real per-key product
decision, not a convention that generalizes:

| Key | Kind | Absent means | Why |
|---|---|---|---|
| `smsMonthlyQuota` | quota | `0` (blocked) | Every message costs real money. An unconfigured plan must not hand out free SMS. |
| `customHandle` | feature | `true` | Every salon can already edit its handle. A registry that defaulted this off would revoke a live capability from every salon on the default plan the moment it deployed. An admin makes it paid by setting it `false` on the plans that shouldn't have it. |
| `qrCode` | feature | `true` | Same reasoning as `customHandle`. |
| `crmCustomerCap` | limit | `null` (unlimited) | The referral system's own `maxReferralsPerReferrer` convention — a missing ceiling has never meant "show nothing". |

Note that quotas and limits deliberately default in **opposite** directions. That is not an
inconsistency: a quota bounds a recurring per-unit cost, a limit is a defensive ceiling.

**`entitlements.service.ts` — the API.** `hasFeature` / `requireFeature` / `getLimit` /
`getQuota` / `remainingQuota`. It applies the registry default whenever the resolved value
is absent **or malformed** — a non-boolean `customHandle` falls back to the registry rather
than being coerced by truthiness, so a stray `"no"` in the JSON editor cannot accidentally
grant a feature. `getLimit` returns `null` for unlimited rather than collapsing it to
`Infinity`, forcing callers to handle the case explicitly.

## What it deliberately is not

**Not a quota-consumption service.** Usage is derived per feature from that feature's own
append-only log (SMS counts rows in `salon_sms_messages` within the current Jalali month),
which makes usage impossible to drift from reality and avoids a general-purpose counter
that would have to understand every feature's reset period. `remainingQuota` takes the
already-counted usage rather than fetching it.

**Not a gate on everything.** A key in the registry is not enforced until a feature calls
the service. The registry's job is to make the set of meaningful keys explicit and their
absent-behaviour decided once.

## Wired today

- `smsMonthlyQuota` — enforced by `SalonSmsQuotaService` for **every** salon-triggered SMS
  (see [33-salon-sms-quota.md](./33-salon-sms-quota.md)).

The remaining keys are registered with behaviour-preserving defaults and are ready to be
gated; each is a one-line `requireFeature`/`getLimit` call at the point of use.

## Adding a key

1. Add it to `ENTITLEMENT_DEFINITIONS` with the kind and the absent-default that preserves
   today's behaviour for existing salons.
2. Call `EntitlementsService` at the point of use.
3. If the new default would change behaviour for live salons, backfill it onto existing
   plans in a migration rather than shipping the feature silently blocked — the SMS quota's
   own `20`-for-everyone backfill is the precedent.
