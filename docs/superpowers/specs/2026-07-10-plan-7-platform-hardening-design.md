# Plan 7: Platform Hardening

**Date:** 2026-07-10
**Status:** Approved
**Depends on:** Plans 1–6 (all shipped)

## 1. Product Summary

Plan 7 closes the six trust-and-safety gaps carried in the "Known Gaps" list since Plans 5/6 shipped: admins act with no audit trail, the first admin is a manual DB update, users have no in-system way to report a salon or review, categories cannot be deleted, suspending a user leaves their salon publicly live, and nothing tells admins a rejected salon was resubmitted. No new product surface is added beyond these; this is a hardening plan over the existing API, admin-panel, and user-app.

### Decisions locked during brainstorming

- **Reports are verified-customer-only:** a user may report a salon (or one of its reviews) only if they have at least one `completed` booking at that salon.
- **Reports ship end-to-end:** user-app filing UI + API + admin-panel queue in this plan.
- **Cascade suspend records its cause:** reactivating a user auto-restores only salons the cascade suspended; a salon an admin suspended directly stays suspended.
- **Audit capture is declarative:** decorator + interceptor, no before/after value snapshots in v1. The log answers "who did what, to what, with what input, when" — not "what was the previous value."
- **Admin notifications are a persisted DB queue polled by the admin panel** — no Web Push (the admin panel has no service worker), no SMS (per-event cost). One shared queue for all admins; read = handled. Per-admin read state is a deliberate cut.
- **Category delete is restrict**, not cascade or reassign: Postgres already blocks deleting a referenced category (bare FK, NO ACTION); we translate that to a clean 409.

## 2. Schema (one migration)

One migration (`<unix-ts>-platform-hardening.ts`, raw SQL, hand-written up/down per repo convention) adds:

```sql
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users(id),
  action varchar(60) NOT NULL,          -- e.g. 'salon.status.set'
  target_type varchar(30) NOT NULL,     -- 'salon' | 'user' | 'review' | 'category' | 'config' | 'report'
  target_id varchar(64),                -- uuid or int id as text; NULL for config bulk updates
  payload jsonb,                        -- validated request body (+ route params)
  success boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES users(id),
  salon_id uuid NOT NULL REFERENCES salons(id),
  review_id uuid REFERENCES reviews(id),        -- NULL = the salon itself is the target
  reason text NOT NULL,                          -- 5–500 chars (DTO-enforced)
  status varchar(20) NOT NULL DEFAULT 'open',    -- 'open' | 'resolved' | 'dismissed'
  resolution_note text,
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_status_created_idx ON reports (status, created_at DESC);
-- spam guard: one OPEN report per reporter per target
CREATE UNIQUE INDEX reports_open_target_uidx
  ON reports (reporter_id, salon_id, COALESCE(review_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'open';

CREATE TABLE admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type varchar(40) NOT NULL,             -- 'salon_resubmitted' | 'report_created'
  title varchar(200) NOT NULL,           -- Farsi
  body varchar(500),                     -- Farsi
  link varchar(200),                     -- admin-panel route, e.g. '/salons/<id>'
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_notifications_unread_idx ON admin_notifications (created_at DESC) WHERE read_at IS NULL;

ALTER TABLE salons ADD COLUMN suspended_cause varchar(20);  -- 'admin' | 'owner_suspended' | NULL
```

Entities follow repo convention: plain FK-id columns with explicit snake_case `@Column({ name })`, no TypeORM relation decorators, FKs declared only in the migration SQL.

## 3. Backend, by vertical slice

### 3.1 Audit log (`src/audit/`)

New `AuditModule` (global-friendly: exports `AuditService`, imported by every module hosting an admin controller — salons, auth, reviews, catalog, platform-config, reports).

- `@AuditAction(action: string, targetType: string)` — `SetMetadata` decorator on each admin **mutation** handler. Read endpoints are not audited.
- `AuditInterceptor` — `@UseInterceptors` on each admin controller (or per-handler). Reads the metadata via `Reflector`; on handler settle (resolve or reject) inserts a row: `actorId = req.user.id` (guaranteed — every admin controller runs `AuthGuard` first), `targetId = req.params.id ?? null`, `payload = req.body` (the raw parsed body — the `ValidationPipe` whitelists the handler's DTO argument, not `req.body`, so the log may contain extra keys a client sent; acceptable for an admin-only, body-parser-bounded surface), `success` per outcome. On rejection the row is still written (`success: false`) and the error is rethrown untouched.
- An audit-insert failure is `logger.error`'d and swallowed — it must never fail the admin's request.
- Handlers annotated (9 total): salon status, salon featured, user status, review moderate, category create, category update, **category delete (new)**, config update, **report resolve (new)**.
- `GET /api/admin/audit-log?actorId&action&targetType&from&to&page&pageSize` — `AuthGuard + RolesGuard @Roles('admin')`, standard `{items, total, page, pageSize}` envelope (pageSize default 20 max 100), items joined with actor phone/name. Paginated from day one (the unpaginated `GET /admin/users` is the anti-pattern here, not the template).

### 3.2 First-admin bootstrap (`scripts/create-admin.ts` in apps/api)

- package.json script: `"create-admin": "ts-node scripts/create-admin.ts"` → `pnpm --filter @gheychi/api create-admin -- 09121234567`.
- Imports `AppDataSource` from `src/data-source.ts` (same env/dotenv path the migration CLI uses — works outside Nest DI).
- Validates the phone against the existing `IRAN_MOBILE` regex (`/^09\d{9}$/`); exits non-zero with a usage message on bad/missing input.
- Idempotent upsert by phone: creates the user if missing, sets `role='admin'`, `status='active'` either way. Prints what it did. Never demotes anyone (an existing admin stays admin; the `promoteToProvider` conditional-update invariant is untouched).
- The core logic lives in an exported function so it gets a colocated unit spec; the script file is a thin argv wrapper.

### 3.3 Reports (`src/reports/`)

New `ReportsModule` — Report entity per the schema above; two controllers per the actor-split convention.

**Customer side (`reports.controller.ts`, AuthGuard):**
- `POST /api/reports` — body `{ salonId?, reviewId?, reason }` (exactly one of salonId/reviewId; `@ValidateIf` + DTO check; reason 5–500 chars). If `reviewId`: load the review, derive its `salonId` (404 if missing). Eligibility: at least one booking by the caller at that salon with `status='completed'` — else `ForbiddenException` with a clear Farsi message. Duplicate open report → the partial unique index fires; translate 23505 via `isUniqueViolation` to 409 «گزارش قبلی شما هنوز در حال بررسی است». On success, emit an `admin_notifications` row (`report_created`, link `/reports`) in the same transaction as the insert.
- `GET /api/reports/eligibility?salonId=` — returns `{ canReport: boolean }` (the completed-booking check only; used by the user-app to conditionally render report buttons).

**Admin side (`admin-reports.controller.ts`, AuthGuard + RolesGuard + @Roles('admin')):**
- `GET /api/admin/reports?status&salonId&page&pageSize` — standard envelope, default filter `status=open`, items joined with salon name/slug, reporter phone, and the reported review's rating/comment when `review_id` is set.
- `PATCH /api/admin/reports/:id` — body `{ status: 'resolved'|'dismissed', note? }`, conditional update `WHERE status='open'` (ConflictException on race, per repo pattern), stamps `resolved_by`/`resolved_at`. `@AuditAction('report.resolve', 'report')`.

Resolving a report does **not** itself moderate anything — the admin uses the queue's links to the existing salon-detail / review-moderation actions, which are already audited. One concern per endpoint.

### 3.4 Category delete (`src/catalog/`)

- Add `FOREIGN_KEY_VIOLATION = '23503'` + `isForeignKeyViolation()` to `src/common/postgres-error-codes.ts`, next to the existing 23505 helper.
- `DELETE /api/admin/categories/:id` (`ParseIntPipe`) on the existing `AdminCategoriesController` — attempt the delete, no pre-check (DB constraint is the source of truth, matching the repo's 23505 idiom); catch 23503 → 409 «این دسته‌بندی توسط خدمات سالن‌ها استفاده می‌شود و قابل حذف نیست». 404 when no row deleted. 204 on success. `@AuditAction('category.delete', 'category')`.
- `is_active=false` services still block deletion (the FK reference exists regardless) — intentional: reassign-or-cascade is deferred until someone actually needs it.

### 3.5 Cascade suspend (users ↔ salons)

- `AdminUsersController.setStatus` moves its logic into a new `AdminUsersService` (auth module) that injects `Repository<User>` **and** `Repository<Salon>` via `TypeOrmModule.forFeature([User, Salon])` in `AuthModule` — registering the repo token directly avoids the `UsersModule → SalonsModule → AuthModule → UsersModule` import cycle a service dependency would create.
- In one `dataSource.transaction`:
  - **Suspend:** `users.status='suspended'`; then conditional update on the owned salon `WHERE owner_id=:id AND status='approved'` → `status='suspended', suspended_cause='owner_suspended'`. Pending/rejected salons are untouched (not publicly visible anyway).
  - **Reactivate:** `users.status='active'`; then conditional update `WHERE owner_id=:id AND status='suspended' AND suspended_cause='owner_suspended'` → `status='approved', suspended_cause=NULL`.
- Admin direct salon suspension (`PATCH /admin/salons/:id/status` with `suspended`) now sets `suspended_cause='admin'`; approving any salon clears the cause.
- Existing behavior stands: the suspended user is already fully locked out (403 at login and on every `AuthGuard` request); this feature is purely about the salon's public visibility.
- **Adjacent fix 1:** `SalonStatusActions` (admin panel) gains a re-approve action for `suspended` salons (today there is no path back at all). Rejected salons keep the provider-resubmit-only flow.
- **Adjacent fix 2:** `GET /api/salons/:salonId/reviews` (public) additionally requires the salon to be `approved` — closes the leak where reviews of pending/suspended salons were publicly listable.

### 3.6 Admin notifications (`src/admin-notifications/`)

New `AdminNotificationsModule` — entity per schema; `AdminNotificationsService.emit(type, title, body, link)` inserts a row.

- **Emit points (2):** `SalonsService.resubmitMine()` after its conditional update succeeds (`salon_resubmitted`, link `/salons/<id>`), and report creation (§3.3). Resubmit's emit is fire-safe: failure is logged, never thrown (the notification-never-breaks-the-operation rule).
- Endpoints (all `AuthGuard + RolesGuard @Roles('admin')`):
  - `GET /api/admin/notifications?page&pageSize&unread` — standard envelope, newest first.
  - `GET /api/admin/notifications/unread-count` → `{ count }` (cheap: the partial index covers it).
  - `PATCH /api/admin/notifications/:id/read` and `POST /api/admin/notifications/read-all` — set `read_at`; idempotent; not audited (not a moderation action).

## 4. Frontend

### 4.1 Admin panel

All additions follow the existing recipes exactly (pages flat in `src/pages/`, route + `SidebarNav` LINKS entry + `labels.ts` maps + `AppIcon` names; lists = filter card → table/cards → shared `Pagination`; mutations = small colocated action components emitting `updated`).

- **Audit Log page** (`/audit-log`, icon `history`): SalonsView clone — action-type `AppSelect`, actor free-text (debounced), `JalaliDatePicker` range, paginated table (time, actor, action label, target link, success badge). `labels.ts` gains an `auditActionLabel` map (Farsi label + tone per action).
- **Reports queue** (`/reports`, icon `flag`): ReviewsView clone — status filter (default open), report cards showing reason, reporter, salon link, quoted review when present; per-card resolve/dismiss action component with the inline expand-for-note pattern. Dashboard gains an open-reports stat card + quick link.
- **Notification bell** in `AppLayout`'s header icon row: polls `unread-count` every 60s (`setInterval`, cleared on unmount, silent errors), badge when count > 0; click opens a dropdown of recent notifications; clicking one marks it read and routes to `link`; a "mark all read" affordance.
- **CategoriesView**: per-row delete with the inline expand-to-confirm pattern; a 409 surfaces through the standard toast.
- **SalonStatusActions**: re-approve for suspended salons; `SalonDetailView` shows the suspension cause when `suspended_cause='owner_suspended'` («به دلیل تعلیق حساب مالک»).
- **SuspendUserButton/UsersView**: toast after suspend/reactivate mentions the salon cascade when the target is a provider.

### 4.2 User app

- **Salon profile page** (`salons/[slug].vue`): for a logged-in user, fetch `/reports/eligibility?salonId=` (silent); when `canReport`, render a report affordance («گزارش این سالن») opening a small reason form (5–500 chars) that `POST /api/reports`s. Success/duplicate/ineligible states all surface as toasts.
- **Review cards** on the same page: when `canReport`, a small flag icon per review filing a review-targeted report with the same form.
- Logged-out or ineligible users see nothing — the button simply doesn't render.

## 5. Error Handling

- All new endpoints throw NestJS built-ins directly (no global filter), per convention: 403 ineligible reporter, 409 duplicate open report / in-use category / lost status race, 404 missing target.
- Audit and notification writes are strictly non-blocking side effects: failures are `logger.error`'d, never propagated — with one deliberate exception: the `report_created` emit shares the report insert's transaction (§3.3), so its failure rolls back and fails report creation. Report + notification are an atomic pair by design.
- The bootstrap script exits non-zero with a usage message on invalid input; DB errors print and exit non-zero (it's an operator tool, not an API).

## 6. Testing

- **Colocated unit specs (apps/api):** AuditInterceptor (metadata read, success/failure rows, swallow-on-insert-error), report eligibility + duplicate handling, cascade suspend/reactivate transitions (incl. `suspended_cause` matrix), category-delete 23503 translation, create-admin core function (new/existing/already-admin/bad-phone), notification emit.
- **e2e (apps/api/test):** report lifecycle (ineligible 403 → complete a booking → create → duplicate 409 → admin resolve); cascade suspend → salon hidden from public search/profile → reactivate → restored; direct-suspend salon NOT restored on user reactivation; category delete 204/409; resubmit → notification appears + unread count; audit rows exist for each admin mutation exercised.
- **Admin panel (Vitest):** bell badge/polling composable, reports queue actions, audit table rendering, category delete confirm flow.
- **User app (Vitest nuxt env):** report form component (eligibility-gated render, submit, error toasts).
- Playwright e2e additions only if an existing spec breaks; the report flow's cross-app nature is covered by the API e2e + component tests. **Reminder:** frontend e2e global-setups wipe the shared dev DB — reseed demo data after runs.

## 7. Out of Scope (this plan)

- Real payment refunds and alerting/paging on payment `logger.error`s (standing MVP cuts).
- Per-admin notification read state; notification types beyond the two emit points.
- Before/after value snapshots in the audit log; audit of non-admin actions.
- Category reassign-or-cascade delete; deleting categories in use.
- Pre-publish review moderation (reports are the designed complement to reactive moderation, not a replacement).
- Blog/content CMS (Plan 8) and deployment prep (Plan 9).

## 8. Open Risks

- **Interceptor + inline-repo controllers:** three admin controllers mutate repositories inline; the interceptor sees only request/response, so if a handler partially succeeds before throwing, the audit row records `success: false` for the whole action — acceptable at this granularity.
- **Shared notification queue:** with multiple concurrent admins, one admin's "read" hides the item from the others. Accepted for a small team; per-admin state is a clean later migration if it ever hurts.
- **Polling cadence:** 60s badge staleness is accepted; no realtime infra is introduced.
- **`AuthModule` grows:** it now hosts `AdminUsersService` with a Salon repo. If admin surface keeps growing, a dedicated `admin` module is the eventual refactor; not worth it for one service today.
