# 05 — Authentication

## Mechanism: OTP over SMS, not passwords

There is no password anywhere in the system. Login is phone number + a 6-digit SMS code. Phone format is validated as `IRAN_MOBILE = /^09\d{9}$/` (`apps/api/src/auth/dto/auth.dto.ts`).

Files: `apps/api/src/auth/auth.controller.ts`, `auth.service.ts` (`OtpService`), `auth.guard.ts`, `roles.guard.ts`, `dto/auth.dto.ts`.

## Login sequence

```mermaid
sequenceDiagram
    participant U as Customer
    participant API as apps/api
    participant R as Redis
    participant SMS as SmsProvider
    participant DB as Postgres

    U->>API: POST /auth/request-otp {phone}
    API->>R: check otp:rl:{phone} (max 3/hour)
    API->>R: SET otp:{phone} <6-digit code> EX 120
    API->>R: DEL otp:att:{phone}
    API->>SMS: sendOtp(phone, code)
    API-->>U: { ok, expiresInSec, resendsRemaining }

    U->>API: POST /auth/verify-otp {phone, code, referralCode?}
    API->>R: check otp:att:{phone} (max 5 attempts)
    API->>R: compare against otp:{phone}
    alt wrong or expired
        API-->>U: 401
    else correct
        API->>DB: findOrCreateByPhone(phone)
        opt referralCode present AND user is new
            API->>DB: SAVEPOINT registration_referral
            API->>DB: apply referral code (see 13-financial-system.md)
            API->>DB: RELEASE or ROLLBACK TO SAVEPOINT (never fails registration)
        end
        alt user.status === 'suspended'
            API-->>U: 403
        else
            API->>API: jwt.signAsync({sub, role}) — 30 day expiry
            API-->>U: Set-Cookie: session=<jwt>, HttpOnly, SameSite=Lax, Secure(prod), 30d
            API-->>U: { user, isNewUser, referralStatus? }
        end
    end
```

## Token & cookie details

- **JWT claims**: `{ sub: userId, role: UserRole }` only — no other custom claims.
- **Expiry**: 30 days (`JwtModule.registerAsync`'s `expiresIn: '30d'`), matching the cookie's `maxAge`.
- **Secret**: `JWT_SECRET` env var, required (`getOrThrow`) — the API will not boot without it.
- **Cookie**: name `session`, `httpOnly: true` (never readable by JS on any frontend), `sameSite: 'lax'`, `secure: NODE_ENV === 'production'`.
- Tokens are **never** exposed to JavaScript on any frontend — every frontend's session state is populated by calling `GET /auth/me` and trusting the cookie to do its job silently on every subsequent request (`credentials: 'include'`/`credentials: include` on every `fetch`/`$fetch`).

## Rate limiting & abuse controls (Redis-backed)

| Control | Key | Limit |
|---|---|---|
| OTP requests | `otp:rl:{phone}` | 3 per hour |
| OTP verify attempts | `otp:att:{phone}` | 5 per 120s code lifetime |
| OTP code itself | `otp:{phone}` | expires after 120s |

Both counters live in Redis with a TTL matching their window — no cleanup job needed, they self-expire. Full Redis key inventory: [18-background-jobs.md](./18-background-jobs.md) (Redis section) / [19-third-party-services.md](./19-third-party-services.md).

## `AuthGuard` — the primary gate

`apps/api/src/auth/auth.guard.ts`:
1. Reads `req.cookies['session']`; **401** if absent.
2. `jwt.verifyAsync(token)` → **401** if invalid/expired.
3. Looks up `payload.sub` via `UsersService.findById` → **401** if the user no longer exists.
4. **403** if `user.status === 'suspended'` — re-checked on **every request**, not just at login, so a mid-session suspension takes effect immediately.
5. On success, attaches `req.user = user`.

## `RolesGuard` — role gate

`apps/api/src/auth/roles.guard.ts`. Reads `@Roles(...roles)` metadata off the handler/class via `Reflector`. **Must run after `AuthGuard`** (relies on `req.user`). If no `@Roles` metadata is present, it passes through. The only role actually used anywhere in the codebase is `'admin'` — `provider`/`customer` distinctions are enforced structurally (ownership checks), not via `@Roles`.

## `SalonOwnerGuard` — ownership gate

`apps/api/src/salons/salon-owner.guard.ts`. Also must run after `AuthGuard`. Calls `SalonsService.findMine(userId)` (`repo.findOneBy({ ownerId })`) and stashes the result's `id` on `req.salonId`. **404s if the caller owns no salon at all** — it does **not** check the salon's moderation status, so any salon owned by the caller (even `pending`/`rejected`/`suspended`) satisfies the guard; downstream handlers that need to gate on status do so themselves. Used by every `salons/mine/*` provider-facing controller. Full guard inventory: [17-permissions.md](./17-permissions.md).

## Registration & referral interaction

If `verify-otp` is called with a `referralCode` **and** the user is genuinely new, the referral is applied inside the *same* transaction that creates the user row, wrapped in its own `SAVEPOINT registration_referral` — any failure in referral resolution (invalid code, disabled reward type, capacity limit hit) rolls back only to that savepoint and is surfaced as `referralStatus` in the response, **never** failing the registration itself. Full detail: [13-financial-system.md](./13-financial-system.md).

## Logout

`POST /auth/logout` (`AuthGuard`) — `204`, clears the `session` cookie server-side (`res.clearCookie`). Each frontend additionally clears its own local session store (Pinia) and, in `user-app`'s case, unsubscribes push *before* clearing the cookie (`useLogout.ts` — order matters, the unsubscribe call is scoped by `{endpoint, userId}` and needs the cookie to still be valid).

## Frontend session handling (all three apps)

Each app follows the same shape independently (no shared code, per the cross-app isolation convention — see [02-system-architecture.md](./02-system-architecture.md)):

- A single Pinia store (`session.ts`) holding `{ user, checked }`.
- Session is **not** eagerly bootstrapped at app startup — it's lazily populated the first time a route guard/middleware runs `GET /auth/me`.
- A 401 from any API call (via each app's own `useApi.ts`) triggers a redirect to `/login` unless the call explicitly opts out (`redirectOn401: false`) — used for background/best-effort lookups (e.g. wallet balance) that shouldn't force-navigate a user away from what they were doing.
- **`admin-panel`** additionally enforces `role === 'admin'` client-side in its router guard (redirecting non-admins to `/forbidden`) — a defense-in-depth check layered on top of the backend's own `RolesGuard`.
- **`provider-panel`** has no client-side role check at all; its router guard instead branches entirely on whether `GET /salons/mine` resolves (no salon → onboarding; salon not approved → pending-approval screen with carve-outs).
- **`user-app`**'s route guard (`middleware/auth.global.ts`) additionally redirects to `/profile` if the logged-in user is missing `name`/`gender` (`needsProfileCompletion`) — because `gender` is a required parameter for search and there's no separate onboarding route.

## Related documents

- [17-permissions.md](./17-permissions.md) — full guard/role inventory across all four apps
- [13-financial-system.md](./13-financial-system.md) — referral redemption at registration
- [21-security.md](./21-security.md) — cookie/CORS security posture
