# 17 — Permissions

There are exactly **four** distinct authorization mechanisms in the backend — one global (`AuthGuard`), two applied per-route (`RolesGuard`, `SalonOwnerGuard`), and one single-purpose shared-secret guard (`BackupReportSecretGuard`) — plus independent client-side gating in each of the three frontends. There is no fine-grained permission system, no per-resource ACLs, and no role beyond `customer|provider|admin` on the `users.role` column.

## Backend guards

### `AuthGuard` (`apps/api/src/auth/auth.guard.ts`)
The base gate. Reads the `session` HttpOnly cookie, verifies the JWT, loads the user, re-checks `status !== 'suspended'` on **every request** (not cached from login), attaches `req.user`. Full detail: [05-authentication.md](./05-authentication.md).

### `RolesGuard` (`apps/api/src/auth/roles.guard.ts`)
Reads `@Roles(...roles)` metadata via `Reflector`. **Must run after `AuthGuard`** (guaranteed, since `AuthGuard` is global and global guards run before controller-level ones). The only role ever used anywhere in the codebase is `'admin'` — every admin controller declares `@UseGuards(RolesGuard)` + `@Roles('admin')`. There is no `@Roles('provider')` — provider-facing routes are gated by ownership (below), not role.

### `SalonOwnerGuard` (`apps/api/src/salons/salon-owner.guard.ts`)
Resolves `req.salonId = SalonsService.findMine(req.user.id).id`. **404s if the caller owns no salon at all.** Does **not** check the salon's moderation status — a `pending`/`rejected`/`suspended` salon's owner still passes this guard; individual handlers gate on status themselves where it matters. Declared as `@UseGuards(SalonOwnerGuard)` (a few older controllers still spell out the redundant `AuthGuard, SalonOwnerGuard`). Used by every `salons/mine/*` controller: photos, portfolio, stories, services, workers, schedule, bookings, earnings, coupons, review-reply, invoices, CRM customers/SMS, subscription, billing periods.

### `BackupReportSecretGuard` (`apps/api/src/backup-monitoring/backup-report-secret.guard.ts`)
Not user-facing at all: `POST /internal/backup-report` (the `backup` container's daily outcome report) is `@Public()` to `AuthGuard` and instead requires an `x-backup-report-secret` header that constant-time-matches (`timingSafeEqual` over SHA-256 digests) the `BACKUP_REPORT_SECRET` env var. A missing/empty configured secret fails closed — no header could ever satisfy it.

### `AuthGuard` is global — routes opt *out*, never in
`AppModule` registers `AuthGuard` as `APP_GUARD`, so **every route is authenticated by default**; a public route must carry `@Public()` (`auth/public.decorator.ts`), and `route-guard-audit.spec.ts` pins every `@Public()` handler against an explicit `PUBLIC_ROUTES` allowlist (a new `@Public()` without an allowlist entry fails the test). The two actor-scoping guards are **not** global, so the same spec also pins, by reflecting on each handler's real route path, that every `admin/*` route carries `RolesGuard` + `@Roles('admin')` and every `salons/mine*` route carries `SalonOwnerGuard` — with exactly one documented exception, `GET /salons/mine`, the provider-panel's "do I have a salon yet?" onboarding probe (which must answer 404 rather than be guard-rejected; `SalonsService.findMine` scopes by `ownerId` itself). It also asserts exact equality between the controllers it imports and a filesystem count of `@Controller(` decorators, so an unimported controller fails the audit rather than silently escaping it.

## Guard matrix by resource area

| Area | Guard(s) | Notes |
|---|---|---|
| Auth (login/OTP) | `@Public()` (request/verify) → global `AuthGuard` after | — |
| `salons/mine/*` (all provider sub-resources) | global `AuthGuard` + `SalonOwnerGuard` | ownership, not role-based; `GET /salons/mine` itself is the one route without `SalonOwnerGuard` |
| `admin/*` (everything) | global `AuthGuard` + `RolesGuard('admin')` | role-based |
| `bookings/*` (customer) | global `AuthGuard` | scoped by `userId` in queries, not a separate ownership guard |
| Public content (`salons/:slug/*`, `/search`, `/categories`, `/cities`, `/blog/*`, `/health`, `/liveness`, `/readiness`) | `@Public()` | approved/published-only filtering happens in the query itself |
| `payments/callback` | `@Public()` | intentionally public — it's Zarinpal's own browser redirect target |
| `internal/backup-report` | `@Public()` + `BackupReportSecretGuard` | shared-secret header, not a user session |
| `reports`, `reviews`, `wallet/mine`, `push/subscribe`, `favorites` | global `AuthGuard` | scoped by `req.user.id` |

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

## Booking approval routes

| Route | Guard | Note |
|---|---|---|
| `POST /salons/mine/bookings/:id/approve` | `SalonOwnerGuard` | service re-scopes the lookup by `req.salonId`, so a valid booking id from another salon 404s |
| `POST /salons/mine/bookings/:id/reject` | `SalonOwnerGuard` | reason required |
| `GET`/`PATCH /admin/salons/:id/booking-settings` | `RolesGuard` + `@Roles('admin')` | the only writer of the two per-salon timeout overrides |
| `GET /admin/bookings/:id/events` | `RolesGuard` + `@Roles('admin')` | crosses salon boundaries by design, hence admin-only |

The owner/admin split is load-bearing: the timeout columns are deliberately **absent** from
`UpdateSalonDto`, because `SalonsService.updateMine()` applies its DTO via a blanket
`Object.assign` and would otherwise let a provider set their own deadlines. See
[28-booking-approval-workflow.md](./28-booking-approval-workflow.md).

## What the route-guard spec actually pins (as of 2026-09-03)

`src/route-guard-audit.spec.ts` is the regression backstop for this whole document, and it
was weaker than its own comments claimed. It now asserts:

1. **Exact** equality between `ALL_CONTROLLERS` and the number of `@Controller(` decorators
   under `src/`. It previously asserted `>= <controller FILE count>`, which silently
   tolerated a whole missing controller whenever one file held two classes — and one was in
   fact missing (`AdminAnalyticsController`).
2. Every route whose full path is `admin` or starts with `admin/` carries **both**
   `RolesGuard` and `@Roles('admin')`. Neither is global, so an admin route that forgets one
   is authenticated-but-unauthorized: any logged-in customer could call it.
3. Every route under `salons/mine*` carries `SalonOwnerGuard`, with exactly one documented
   exception — `GET /salons/mine`, the provider panel's "do I have a salon yet?" probe,
   which must answer 404 for an owner-less user rather than being guard-rejected
   (`SalonsService.findMine` scopes by `ownerId` itself).
4. The `@Public()` allowlist, in both directions: every entry resolves to a real handler,
   and no route outside the list is marked public.

Paths are derived from the real `@Controller`/method route metadata, so the rules cannot
drift from the URL convention this document describes.

