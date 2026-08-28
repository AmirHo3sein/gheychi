# 21 — Security

## Authentication & session

Cookie-based, HttpOnly JWT session (`session` cookie), never exposed to JavaScript, never stored in localStorage on any frontend. Full detail: [05-authentication.md](./05-authentication.md). `sameSite:'lax'`, `secure` in production. **Load-bearing assumption**: CORS credentialed origins (`FRONTEND_BASE_URL`/`PROVIDER_APP_BASE_URL`/`ADMIN_APP_BASE_URL`) must stay same-site with the API's own host for the cookie to work at all — flagged directly in a `main.ts` code comment as something a future domain restructuring could silently break.

## Authorization

Three guards (`AuthGuard`, `RolesGuard`, `SalonOwnerGuard`), no global guard, applied per-route. Full matrix: [17-permissions.md](./17-permissions.md). **A new route without an explicit `@UseGuards(...)` is public by default** — the single biggest structural risk in the authorization model, mitigated only by developer discipline/code review, not by any automated check.

## CORS

`main.ts`: `app.enableCors({ origin: buildAllowedOrigins(config), credentials: true })`. Exactly three allowed origins, config-driven (`src/cors-origins.util.ts`) — no wildcard, no reflection of the request's `Origin` header.

## Input validation

Global `ValidationPipe({ whitelist: true, transform: true })` — every request body/query is validated against its DTO's `class-validator` decorators, and any field not declared on the DTO is silently stripped (not merely ignored — `whitelist` actively removes it before the handler sees it). **There is no schema validation for environment variables** — a missing required env var (`getOrThrow`) only surfaces the first time a code path that needs it actually runs.

## File upload security

Every upload endpoint (salon photos/stories/portfolio, blog cover) shares:
- Hard 5MB cap enforced by Multer before the handler runs.
- **Real magic-number MIME sniffing** via the `file-type` package (reads actual file bytes), not the client-supplied `Content-Type` header — restricted to `image/jpeg|png|webp`, `422` on mismatch.
- **Storage keys are server-generated** (`randomUUID()` + extension derived from the *validated* mimetype), never from `file.originalname` — explicitly to avoid path-traversal via a crafted client filename.

## XSS posture — the blog Markdown invariant

Blog posts store **raw Markdown**, never sanitized HTML, because nothing needs sanitizing: both frontends that render post bodies (`user-app`, `admin-panel`) instantiate `markdown-it` with **`html: false`** — raw HTML in the source is escaped to inert text and never parses into DOM. This is the entire XSS story for user-generated-adjacent content on the blog, and it is **pinned by an invariant test in both apps** (`markdown.spec.ts` in each) that explicitly asserts `<script>alert(1)</script>` and `<img src=x onerror=...>` render as escaped text. The two `v-html` bindings in the whole codebase (the admin editor's live preview, and the user-app article body) are commented as sanctioned *solely* by this invariant — **never enable `html:true` or add a third `v-html` site without re-deciding the whole model.**

Both Markdown utilities also force `rel="noopener noreferrer"` on every rendered link (including auto-linkified bare URLs) to prevent reverse-tabnabbing.

## Audit logging

`apps/api/src/audit/audit.service.ts` + `audit.decorator.ts` + `audit.interceptor.ts`. A declarative `@AuditAction(action, targetType)` decorator, combined with `@UseInterceptors(AuditInterceptor)`, on essentially every state-mutating admin route.

```mermaid
sequenceDiagram
    participant C as Admin client
    participant G as AuthGuard (sets req.user)
    participant I as AuditInterceptor
    participant H as Handler
    participant DB as audit_log

    C->>G: PATCH /admin/salons/:id/status
    G->>I: req.user set
    I->>I: read @AuditAction metadata via Reflector
    I->>H: invoke handler
    alt handler succeeds
        H-->>I: result
        I->>DB: INSERT {actorId, action, targetType, targetId: req.params.id, payload: req.body, success:true}
        I-->>C: result (after the audit row is confirmed written)
    else handler throws
        I->>DB: INSERT {..., success:false}
        I-->>C: rethrow original error
    end
```

- `targetId` is read from `req.params.id` — a route without an `:id` param records `targetId: null`.
- `payload` captures the **raw request body**, not filtered by the DTO's own field whitelist — explicitly accepted as fine for an "admin-only, body-parser-bounded surface," but worth knowing before adding a hypothetical future admin DTO that accepts something sensitive.
- **`audit.service.ts`'s `record()` swallows its own failures** — logged via `Logger.error`, never rethrown, by explicit design ("an audit-log outage must never fail the admin's request"). There is no alerting on a failed audit write and no retry — the log line is the only trace.
- No before/after value snapshots — the log answers "who did what, to what, with what input, when," not "what changed."
- No retention/rotation policy exists — `audit_log` grows unbounded.

## Secrets handling

Every third-party credential (JWT secret, Kavenegar key, Zarinpal access token, S3 keys, VAPID keys) is an env var, loaded via `@nestjs/config`. `docs/deployment/DEPLOY.md` explicitly warns that `docker compose config` inlines every `env_file` secret in its output and must be redacted before ever being shared/pasted anywhere.

## Request-correlation id — validated before it's ever logged or echoed

`requestLoggingMiddleware` (`common/request-logging.middleware.ts`) will reuse a client/proxy-supplied `X-Request-Id` instead of minting a fresh one, but only after checking it against a bounded, safe-charset pattern (`^[a-zA-Z0-9-]{1,64}$`) — an unvalidated value would be echoed back on the response header and interpolated into every log line for that request, a real log/header-injection surface. The request's own access-log line deliberately logs `req.path`, never `req.originalUrl`/the query string, for the same reason `GlobalExceptionFilter` does (see below) — `GET /payments/callback`'s `?Authority=...` is a real, currently-existing example of a query string that must never be logged verbatim.

## Error-tracking redaction

`ErrorTrackingService.captureException(error, context)` (`error-tracking/`) is the one place an exception's contextual metadata leaves the request-handling code and gets logged (today) / will eventually leave the process to a real APM. `ErrorTrackingContext` only exposes three explicitly-safe typed fields (`requestId`, `userId`, `route`) plus a free-form `extra` bag. **Never pass a JWT, session cookie, OTP code, card/payment credential, or password/secret into `context` or `extra`.** As a defense-in-depth backstop (not a substitute for call-site discipline), `extra` is recursively redacted by `redact-context.ts` before anything is logged: any key that normalizes to contain `password`, `token`, `jwt`, `cookie`, `session`, `secret`, `otp`, `cvv`, `card`, `authorization`, `apikey`, `privatekey`, or `authority` (Zarinpal's per-transaction `payments.authority`) — however deeply nested — is replaced with `'[redacted]'`. An `Error`'s own `.message`/`.stack` string is **not** scanned (same boundary `CronJobRunner`/`AlertsService` already rely on elsewhere — they log `err.message` directly); call sites must not construct an error message that embeds a raw secret.

## Test-coverage audits — IDOR, role escalation, upload spoofing, route-guard exposure

Four independent audits, run together as part of the same production-hardening pass: IDOR (cross-tenant "mine"-scoped mutations), role/ownership boundaries (every `@Roles('admin')` controller and every `SalonOwnerGuard` route against an authenticated-but-wrong-role/wrong-tenant caller), upload MIME-spoofing (all 4 upload endpoints against a real byte-spoofed file, not just a wrong `Content-Type` header), and a static route-guard audit (`route-guard-audit.spec.ts`, reflection-based — every route handler is either guarded or on an explicit `PUBLIC_ROUTES` allowlist).

**Zero real vulnerabilities were found by any of the four** — every ownership/role check and both upload-validation layers were already correctly implemented. The route-guard audit confirmed zero unintentional-exposure gaps across all 48 controllers (`/liveness`/`/readiness` are the only allowlist additions since — see [15-api-reference.md](./15-api-reference.md)). The gaps closed were entirely in *test coverage*, purely additive: cross-tenant mutation tests for coupon/portfolio/photo/story/review/schedule-exception routes, 9 of 16 admin-role controllers previously untested against an authenticated wrong-role caller, and true byte-spoofed uploads tested against 3 of 4 upload endpoints that weren't before. See `test/security.e2e-spec.ts` and the other `*.e2e-spec.ts` files it cross-references for the full case list.

## Rate limiting & abuse controls

Redis-backed, narrowly scoped to the two genuinely abusable surfaces: OTP request/verify (see [05-authentication.md](./05-authentication.md)) and the public referral-code-validation endpoint (20/hour per IP — a code-enumeration surface). No general-purpose rate limiting exists on any other endpoint.

## Known security-adjacent gaps

- **A salon's reply to a review has no audit trail and no moderation gate** — an owner can post an unmoderated, unaudited public reply to any of their published reviews at will (`SalonReviewReplyController` carries no `@AuditAction`).
- **No profanity/spam filtering** on review comments or salon replies beyond a `MaxLength` DTO constraint — moderation is 100% human/reactive.
- **`payment_authorities` has no entity/repository** — accessed only via raw SQL, which is fine functionally but means it's outside the normal TypeORM migration/entity review surface anyone auditing the schema would naturally check.

## Related documents

- [05-authentication.md](./05-authentication.md), [17-permissions.md](./17-permissions.md) — the mechanisms this document assumes
- [24-technical-debt.md](./24-technical-debt.md) — several findings above repeated with fuller context

## Booking approval workflow

- **Privilege boundary.** The salon owner may set `bookingConfirmationMode` and nothing else.
  The two per-salon timeout overrides are admin-only and are deliberately kept off
  `UpdateSalonDto` — `SalonsService.updateMine()` applies its DTO with a blanket `Object.assign`,
  so their mere presence there would be a privilege escalation. The global
  `ValidationPipe({whitelist: true})` strips them from a provider request that sends them anyway,
  and this is pinned by an e2e test that PATCHes them through the provider route and asserts the
  columns stayed NULL.
- **Ownership.** Approve/reject sit behind `SalonOwnerGuard` *and* re-scope their lookup by
  `req.salonId`, so a valid booking id belonging to another salon 404s rather than leaking that
  it exists.
- **Input bounds.** Timeout overrides are constrained `1..1440` at both the DTO and a DB CHECK;
  the rejection reason is `@Length(1, 300)` and is echoed to the customer, so it is bounded.
- **Event log hygiene.** `booking_events.metadata` must never carry a credential, payment
  authority, OTP, or PII — the same standing rule as `AnalyticsService`, enforced by review at
  each call site. Today it holds only timeout values, ISO deadlines, status names, and the
  owner-authored rejection reason.
- **Auditability.** A salon owner accepting or declining a request writes a real
  `audit_log` row (`booking.approval.approved` / `booking.approval.rejected`) — `audit_log`
  records "a real person did this", and a provider is a real person. The cron-driven
  transitions in the same state machine have no actor and cannot live there
  (`audit_log.actor_id` is NOT NULL), which is why `booking_events` carries the full
  lifecycle. The two are not duplicate records of one transition.
- **A route with no explicit guard is public by default in this codebase.** All four new routes
  declare guards explicitly and are covered by the `route-guard-audit.spec.ts` invariant test.
