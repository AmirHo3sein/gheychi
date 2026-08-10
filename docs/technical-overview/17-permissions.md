# 17 — Permissions

There are exactly **three** distinct authorization mechanisms in the backend, applied per-route (never globally), plus independent client-side gating in each of the three frontends. There is no fine-grained permission system, no per-resource ACLs, and no role beyond `customer|provider|admin` on the `users.role` column.

## Backend guards

### `AuthGuard` (`apps/api/src/auth/auth.guard.ts`)
The base gate. Reads the `session` HttpOnly cookie, verifies the JWT, loads the user, re-checks `status !== 'suspended'` on **every request** (not cached from login), attaches `req.user`. Full detail: [05-authentication.md](./05-authentication.md).

### `RolesGuard` (`apps/api/src/auth/roles.guard.ts`)
Reads `@Roles(...roles)` metadata via `Reflector`. **Must run after `AuthGuard`.** The only role ever used anywhere in the codebase is `'admin'` — every admin controller declares `@UseGuards(AuthGuard, RolesGuard)` + `@Roles('admin')`. There is no `@Roles('provider')` — provider-facing routes are gated by ownership (below), not role.

### `SalonOwnerGuard` (`apps/api/src/salons/salon-owner.guard.ts`)
Resolves `req.salonId = SalonsService.findMine(req.user.id).id`. **404s if the caller owns no salon at all.** Does **not** check the salon's moderation status — a `pending`/`rejected`/`suspended` salon's owner still passes this guard; individual handlers gate on status themselves where it matters. Always declared as `@UseGuards(AuthGuard, SalonOwnerGuard)`. Used by every `salons/mine/*` controller: photos, portfolio, stories, services, workers, schedule, bookings, earnings, coupons, review-reply, invoices.

### No global guard exists
`AppModule` registers no `APP_GUARD` provider. **A new route added without an explicit `@UseGuards(...)` is public by default.** This is a standing review-checklist risk for anyone adding endpoints — grep for the route in question and confirm a guard is present before assuming it's protected.

## Guard matrix by resource area

| Area | Guard(s) | Notes |
|---|---|---|
| Auth (login/OTP) | none (login itself) → `AuthGuard` after | — |
| `salons/mine/*` (all provider sub-resources) | `AuthGuard, SalonOwnerGuard` | ownership, not role-based |
| `admin/*` (everything) | `AuthGuard, RolesGuard('admin')` | role-based |
| `bookings/*` (customer) | `AuthGuard` | scoped by `userId` in queries, not a separate ownership guard |
| Public content (`salons/:slug/*`, `/search`, `/categories`, `/cities`, `/blog/*`, `/health`) | none | approved/published-only filtering happens in the query itself |
| `payments/callback` | none | intentionally public — it's Zarinpal's own browser redirect target |
| `reports`, `reviews`, `wallet/mine`, `push/subscribe`, `favorites` | `AuthGuard` | scoped by `req.user.id` |

Full endpoint-by-endpoint guard listing: [15-api-reference.md](./15-api-reference.md).

## Ownership vs. role: why both patterns exist

A salon owner is never granted a special `role` — they're a plain `customer`-turned-`provider` (the role flips automatically the moment `SalonsService.createForOwner` succeeds) whose *authorization* for `salons/mine/*` comes entirely from owning a row in `salons`, resolved fresh on every request. This means:
- A suspended-then-reinstated owner regains access automatically the moment their salon un-suspends — no separate grant/revoke step.
- There's no way to have "an assistant admin for one salon" or any delegated access — exactly one person (the `owner_id`) can ever manage a salon via the API. Workers do **not** get any API access to manage the salon themselves — they only appear as booking-assignable staff and rating subjects; a worker's own login only ever sees their personal referral code, never the salon's back office.

## Frontend gating (defense-in-depth, not authoritative — the backend guards are)

| App | Mechanism |
|---|---|
| `user-app` | `middleware/auth.global.ts` (session required except `isPublicRoute()`) — no role-based middleware; the admin-only `/admin/featured` tool that used to require one has moved to `admin-panel` |
| `provider-panel` | Router guard branches entirely on `GET /salons/mine` resolving + its `status` — **no role check at all** |
| `admin-panel` | Router guard checks `session.user?.role === 'admin'`, redirects non-admins to `/forbidden` — an explicit, real role check unlike provider-panel's |

None of these client-side checks are a substitute for the backend guards — they exist purely for UX (don't show a screen the API would reject anyway); a determined client could always call the API directly, which is why every sensitive check above is duplicated server-side.

## Audit trail for privileged actions

Every admin mutation is captured by `@AuditAction(action, targetType)` + `AuditInterceptor` into `audit_log` — this is the accountability layer for who-did-what, not an authorization mechanism itself. Full mechanism: [21-security.md](./21-security.md).

## Related documents

- [05-authentication.md](./05-authentication.md)
- [15-api-reference.md](./15-api-reference.md)
- [21-security.md](./21-security.md)
