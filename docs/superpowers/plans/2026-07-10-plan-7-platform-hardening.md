# Plan 7: Platform Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six documented trust-and-safety gaps: admin action audit log, first-admin bootstrap CLI, verified-customer report/flag system (end-to-end), restrict-style category delete, cause-tracked cascade suspend, and a polled admin notification queue.

**Architecture:** Backend-first vertical slices over the existing NestJS modular monolith — one migration for all schema (audit_log, reports, admin_notifications, salons.suspended_cause), a decorator+interceptor audit seam on the nine admin mutation handlers, a persisted admin-notification queue polled by the admin panel, and thin new modules (audit, reports, admin-notifications) following the repo's controller-per-actor + repo-direct conventions. Frontend work lands after its backend: admin-panel pages (audit log, reports queue, bell) cloned from the existing list-page recipes, and an eligibility-gated report form in the user-app.

**Tech Stack:** NestJS 11 + TypeORM 0.3 (raw-SQL migrations) + PostgreSQL/PostGIS, Jest + supertest e2e; Vue 3 + Vite admin-panel (Vitest + happy-dom); Nuxt 4 user-app (Vitest nuxt env). All commands run from the repo root (`~/projects/Arayeshgah`, WSL).

**Approved spec:** `docs/superpowers/specs/2026-07-10-plan-7-platform-hardening-design.md`

**Task order:** Tasks execute in numeric order: 1–5, 5b, 6–24. Dependency spine: Task 1 (schema) precedes everything; Task 4 (audit core) precedes 5, 5b, 6, 11, 14–16; Task 8 (notifications) precedes 9, 12; backend Tasks 1–16 precede admin-panel Tasks 17–21; Tasks 10–12 precede user-app Tasks 22–23; Task 24 (docs + full verification) is last.

**Standing warning:** the frontend e2e global-setups (`apps/provider-panel/e2e`, `apps/user-app/e2e`) run `DROP SCHEMA public CASCADE` against the shared dev database — reseed demo data after any frontend e2e run.

---

### Task 1: Platform-hardening migration + Salon.suspendedCause

**Files:**
- Create: `apps/api/src/migrations/1752500000000-platform-hardening.ts`
- Modify: `apps/api/src/salons/salon.entity.ts` (add `suspendedCause` after `rejectionReason`, ~line 35)

The single migration for the whole plan (no other task adds one), with the exact SQL from spec §2, plus the `salons.suspended_cause` column on the existing `Salon` entity. **This task owns the schema only** — the three new entity classes (`AuditLog`, `Report`, `AdminNotification`) are created by the tasks that build their modules (Tasks 4, 8, and 10 respectively), because `app.module.ts` uses `autoLoadEntities: true` and an entity only matters once a module calls `TypeOrmModule.forFeature(...)` on it. `Salon` is already registered via `SalonsModule`.

For reference, the entity property names the rest of the plan uses against these tables (defined in Tasks 4/8/10): `AuditLog { id, actorId, action, targetType, targetId, payload, success, createdAt }`, `Report { id, reporterId, salonId, reviewId, reason, status, resolutionNote, resolvedBy, resolvedAt, createdAt }`, `AdminNotification { id, type, title, body, link, readAt, createdAt }`.

There is no unit test for raw-SQL migrations in this repo; the verification is run → inspect → revert → inspect → re-run against the dev DB, plus a type-checking build for the entities.

- [ ] **Step 1: Write the migration**

```typescript
// apps/api/src/migrations/1752500000000-platform-hardening.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlatformHardening1752500000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE audit_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id uuid NOT NULL REFERENCES users(id),
        action varchar(60) NOT NULL,
        target_type varchar(30) NOT NULL,
        target_id varchar(64),
        payload jsonb,
        success boolean NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC)`);
    await q.query(`CREATE INDEX audit_log_actor_idx ON audit_log (actor_id)`);

    await q.query(`
      CREATE TABLE reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reporter_id uuid NOT NULL REFERENCES users(id),
        salon_id uuid NOT NULL REFERENCES salons(id),
        review_id uuid REFERENCES reviews(id),
        reason text NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'open',
        resolution_note text,
        resolved_by uuid REFERENCES users(id),
        resolved_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX reports_status_created_idx ON reports (status, created_at DESC)`);
    await q.query(`
      CREATE UNIQUE INDEX reports_open_target_uidx
        ON reports (reporter_id, salon_id, COALESCE(review_id, '00000000-0000-0000-0000-000000000000'::uuid))
        WHERE status = 'open'`);

    await q.query(`
      CREATE TABLE admin_notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type varchar(40) NOT NULL,
        title varchar(200) NOT NULL,
        body varchar(500),
        link varchar(200),
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      `CREATE INDEX admin_notifications_unread_idx ON admin_notifications (created_at DESC) WHERE read_at IS NULL`,
    );

    await q.query(`ALTER TABLE salons ADD COLUMN suspended_cause varchar(20)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE salons DROP COLUMN suspended_cause`);
    await q.query(`DROP TABLE admin_notifications`);
    await q.query(`DROP TABLE reports`);
    await q.query(`DROP TABLE audit_log`);
  }
}
```

- [ ] **Step 2: Run the migration against the dev DB**

Run (repo root, docker services up): `pnpm --filter @arayeshgah/api migration:run`
Expected: `Migration PlatformHardening1752500000000 has been executed successfully.`

- [ ] **Step 3: Verify the schema landed**

```bash
docker compose exec postgres psql -U arayeshgah -d arayeshgah -c '\d audit_log' -c '\d reports' -c '\d admin_notifications'
docker compose exec postgres psql -U arayeshgah -d arayeshgah -c "SELECT column_name FROM information_schema.columns WHERE table_name='salons' AND column_name='suspended_cause'"
```

Expected: three table definitions (with `audit_log_created_idx`/`audit_log_actor_idx`, `reports_status_created_idx`, the partial unique `reports_open_target_uidx`, and the partial `admin_notifications_unread_idx`), and one `suspended_cause` row.

- [ ] **Step 4: Revert-test the down migration, then re-apply**

Run: `pnpm --filter @arayeshgah/api migration:revert`
Expected: `Migration PlatformHardening1752500000000 has been reverted successfully.`

Run: `docker compose exec postgres psql -U arayeshgah -d arayeshgah -c '\d audit_log'`
Expected: `Did not find any relation named "audit_log".`

Run: `pnpm --filter @arayeshgah/api migration:run`
Expected: executed successfully again (leave the dev DB migrated).

The e2e test DB needs nothing manual — `test/utils/db.ts` `resetDatabase()` drops the schema and runs all migrations before each e2e suite.

- [ ] **Step 5: Add `suspendedCause` to the Salon entity**

In `apps/api/src/salons/salon.entity.ts`, directly below the `rejectionReason` column:

```typescript
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'suspended_cause', type: 'varchar', length: 20, nullable: true })
  suspendedCause: 'admin' | 'owner_suspended' | null;
```

- [ ] **Step 6: Type-check everything compiles**

Run: `pnpm --filter @arayeshgah/api build`
Expected: clean `nest build`, no TS errors.

Run: `pnpm --filter @arayeshgah/api test`
Expected: all existing unit suites still PASS (the column is additive; nothing consumes it yet).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/migrations/1752500000000-platform-hardening.ts apps/api/src/salons/salon.entity.ts
git commit -m "feat(api): platform-hardening schema — audit_log, reports, admin_notifications, salons.suspended_cause"
```

---

### Task 2: `isForeignKeyViolation` helper (23503)

**Files:**
- Test: `apps/api/src/common/postgres-error-codes.spec.ts` (create)
- Modify: `apps/api/src/common/postgres-error-codes.ts:4-8`

Category delete (§3.4) translates Postgres FK violations (`23503`) into a clean 409. Add `FOREIGN_KEY_VIOLATION` + `isForeignKeyViolation()` next to the existing `UNIQUE_VIOLATION`/`isUniqueViolation`, mirroring their shape exactly. The file currently has no spec — this creates it.

- [ ] **Step 1: Write the failing test**

TypeORM's `QueryFailedError` constructor `Object.assign`s the driver error's own enumerable properties (including pg's `code`) onto itself, which is exactly what the helpers read — the `pgError` factory below reproduces that.

```typescript
// apps/api/src/common/postgres-error-codes.spec.ts
import { QueryFailedError } from 'typeorm';
import {
  FOREIGN_KEY_VIOLATION,
  isForeignKeyViolation,
  isUniqueViolation,
  UNIQUE_VIOLATION,
} from './postgres-error-codes';

function pgError(code: string): QueryFailedError {
  const driverError = Object.assign(new Error('db error'), { code });
  return new QueryFailedError('DELETE FROM service_categories WHERE id = $1', [1], driverError);
}

describe('postgres-error-codes', () => {
  it('exports the foreign-key violation code 23503', () => {
    expect(FOREIGN_KEY_VIOLATION).toBe('23503');
  });

  it('detects a QueryFailedError carrying the FK violation code', () => {
    expect(isForeignKeyViolation(pgError('23503'))).toBe(true);
  });

  it('rejects a QueryFailedError with a different code', () => {
    expect(isForeignKeyViolation(pgError('23505'))).toBe(false);
  });

  it('rejects values that are not QueryFailedErrors', () => {
    expect(isForeignKeyViolation(new Error('boom'))).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
    expect(isForeignKeyViolation({ code: '23503' })).toBe(false);
  });

  it('keeps the existing unique-violation helper intact', () => {
    expect(UNIQUE_VIOLATION).toBe('23505');
    expect(isUniqueViolation(pgError('23505'))).toBe(true);
    expect(isUniqueViolation(pgError('23503'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test -- postgres-error-codes`
Expected: FAIL — TS compile error, `Module '"./postgres-error-codes"' has no exported member 'FOREIGN_KEY_VIOLATION'` (and `isForeignKeyViolation`).

- [ ] **Step 3: Write the minimal implementation**

`apps/api/src/common/postgres-error-codes.ts` becomes:

```typescript
import { QueryFailedError } from 'typeorm';

/** Postgres error codes referenced when translating `QueryFailedError`s into clean HTTP responses. */
export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as unknown as { code?: string }).code === UNIQUE_VIOLATION;
}

export const FOREIGN_KEY_VIOLATION = '23503';

export function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as unknown as { code?: string }).code === FOREIGN_KEY_VIOLATION;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test -- postgres-error-codes`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/postgres-error-codes.ts apps/api/src/common/postgres-error-codes.spec.ts
git commit -m "feat(api): add isForeignKeyViolation (23503) helper alongside isUniqueViolation"
```

---

### Task 3: First-admin bootstrap script (`create-admin`)

**Files:**
- Create: `apps/api/scripts/create-admin.ts`
- Test: `apps/api/scripts/create-admin.spec.ts`
- Modify: `apps/api/src/auth/dto/auth.dto.ts:3` (export `IRAN_MOBILE`)
- Modify: `apps/api/package.json:5-12` (add `create-admin` script) and `:52-58` (jest `roots`)

Replaces the manual-DB-update admin bootstrap with `pnpm --filter @arayeshgah/api create-admin -- 09121234567`. The core logic is an exported `createAdmin(dataSource, phone)` returning `'created' | 'promoted' | 'already-admin'`; the script file is a thin argv wrapper guarded by `require.main === module` so importing it from the spec doesn't execute anything. Idempotent, never demotes an existing admin.

- [ ] **Step 1: Export the existing `IRAN_MOBILE` regex**

In `apps/api/src/auth/dto/auth.dto.ts` line 3, the regex is module-private. Export it (no other change):

```typescript
export const IRAN_MOBILE = /^09\d{9}$/;
```

- [ ] **Step 2: Make jest discover specs under `scripts/`**

The jest block in `apps/api/package.json` currently pins `"rootDir": "src"`, so a colocated `scripts/*.spec.ts` would never run. Replace `rootDir` with explicit `roots` (equivalent coverage for `src`, plus `scripts`):

```json
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "roots": ["<rootDir>/src", "<rootDir>/scripts"],
    "testRegex": ".spec.ts$"
  }
```

- [ ] **Step 3: Write the failing test**

Mocking style copied from `src/salons/salons.service.spec.ts`: plain jest-mock repository objects — here handed out by a mocked `DataSource.getRepository`, since the core function takes a `DataSource` (spec §3.2: works outside Nest DI).

```typescript
// apps/api/scripts/create-admin.spec.ts
import { DataSource } from 'typeorm';
import { User } from '../src/users/user.entity';
import { createAdmin } from './create-admin';

describe('createAdmin', () => {
  let repo: { findOneBy: jest.Mock; create: jest.Mock; save: jest.Mock };
  let dataSource: DataSource;

  beforeEach(() => {
    repo = {
      findOneBy: jest.fn(),
      create: jest.fn((partial: Partial<User>) => partial as User),
      save: jest.fn(async (user: User) => user),
    };
    dataSource = { getRepository: jest.fn().mockReturnValue(repo) } as unknown as DataSource;
  });

  it('rejects an invalid phone without touching the database', async () => {
    await expect(createAdmin(dataSource, '12345')).rejects.toThrow('not a valid Iranian mobile number');
    expect(dataSource.getRepository).not.toHaveBeenCalled();
  });

  it('creates a brand-new active admin when the phone is unknown', async () => {
    repo.findOneBy.mockResolvedValue(null);
    await expect(createAdmin(dataSource, '09121234567')).resolves.toBe('created');
    expect(repo.create).toHaveBeenCalledWith({ phone: '09121234567', role: 'admin', status: 'active' });
    expect(repo.save).toHaveBeenCalled();
  });

  it('promotes an existing customer to active admin', async () => {
    repo.findOneBy.mockResolvedValue({ id: 'u1', phone: '09121234567', role: 'customer', status: 'active' } as User);
    await expect(createAdmin(dataSource, '09121234567')).resolves.toBe('promoted');
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin', status: 'active' }));
  });

  it('reactivates a suspended admin and reports promoted', async () => {
    repo.findOneBy.mockResolvedValue({ id: 'u2', phone: '09121234567', role: 'admin', status: 'suspended' } as User);
    await expect(createAdmin(dataSource, '09121234567')).resolves.toBe('promoted');
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin', status: 'active' }));
  });

  it('is a no-op for an already-active admin', async () => {
    repo.findOneBy.mockResolvedValue({ id: 'u3', phone: '09121234567', role: 'admin', status: 'active' } as User);
    await expect(createAdmin(dataSource, '09121234567')).resolves.toBe('already-admin');
    expect(repo.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test -- create-admin`
Expected: FAIL — `Cannot find module './create-admin'`.

- [ ] **Step 5: Write the implementation**

```typescript
// apps/api/scripts/create-admin.ts
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { IRAN_MOBILE } from '../src/auth/dto/auth.dto';
import { User } from '../src/users/user.entity';

export type CreateAdminResult = 'created' | 'promoted' | 'already-admin';

/**
 * Idempotent first-admin bootstrap: upserts the user by phone and guarantees
 * role='admin', status='active'. Never demotes anyone.
 */
export async function createAdmin(dataSource: DataSource, phone: string): Promise<CreateAdminResult> {
  if (!IRAN_MOBILE.test(phone)) {
    throw new Error(`"${phone}" is not a valid Iranian mobile number (expected 09xxxxxxxxx)`);
  }
  const users = dataSource.getRepository(User);
  const existing = await users.findOneBy({ phone });
  if (!existing) {
    await users.save(users.create({ phone, role: 'admin', status: 'active' }));
    return 'created';
  }
  if (existing.role === 'admin' && existing.status === 'active') {
    return 'already-admin';
  }
  existing.role = 'admin';
  existing.status = 'active';
  await users.save(existing);
  return 'promoted';
}

async function main(): Promise<void> {
  const phone = process.argv[2];
  if (!phone) {
    console.error('Usage: pnpm --filter @arayeshgah/api create-admin -- 09xxxxxxxxx');
    process.exit(1);
  }
  // Imported lazily so the unit spec never touches dotenv/DataSource construction.
  const { AppDataSource } = await import('../src/data-source');
  await AppDataSource.initialize();
  try {
    const result = await createAdmin(AppDataSource, phone);
    const messages: Record<CreateAdminResult, string> = {
      created: `created new admin user ${phone}`,
      promoted: `promoted existing user ${phone} to active admin`,
      'already-admin': `${phone} is already an active admin — nothing to do`,
    };
    console.log(messages[result]);
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    console.error('Usage: pnpm --filter @arayeshgah/api create-admin -- 09xxxxxxxxx');
    process.exit(1);
  });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test -- create-admin`
Expected: PASS (5 tests).

- [ ] **Step 7: Add the package.json script**

In `apps/api/package.json` `scripts`, after `"migration:revert"`:

```json
    "migration:revert": "typeorm-ts-node-commonjs migration:revert -d src/data-source.ts",
    "create-admin": "ts-node scripts/create-admin.ts"
```

- [ ] **Step 8: Verify against the real dev DB and run the full suite**

Run (docker services up, dev DB migrated): `pnpm --filter @arayeshgah/api create-admin -- 09121234567`
Expected: `created new admin user 09121234567` (or `promoted…`/`already an active admin…` if the phone already exists locally). Re-running the same command prints `09121234567 is already an active admin — nothing to do` and exits 0.

Run: `pnpm --filter @arayeshgah/api create-admin -- 12345`
Expected: prints the invalid-phone error + usage line, exits non-zero.

Run: `pnpm --filter @arayeshgah/api test`
Expected: all unit suites PASS — confirms the jest `roots` change still discovers every existing `src/**/*.spec.ts`.

- [ ] **Step 9: Commit**

```bash
git add apps/api/scripts/create-admin.ts apps/api/scripts/create-admin.spec.ts apps/api/src/auth/dto/auth.dto.ts apps/api/package.json
git commit -m "feat(api): idempotent create-admin bootstrap script (pnpm create-admin -- <phone>)"
```

---

### Task 4: Audit capture core — `@AuditAction` decorator, `AuditService`, `AuditInterceptor`, `AuditModule`

**Files:**
- Create: `apps/api/src/audit/audit-log.entity.ts`
- Create: `apps/api/src/audit/audit.decorator.ts`
- Create: `apps/api/src/audit/audit.service.ts`
- Create: `apps/api/src/audit/audit.interceptor.ts`
- Create: `apps/api/src/audit/audit.module.ts`
- Test: `apps/api/src/audit/audit.interceptor.spec.ts`

Declarative audit capture per spec §3.1: a `SetMetadata` decorator marks each admin mutation handler, and an interceptor writes one `audit_log` row per settled request (success or failure). The `audit_log` table itself was created by Task 1's migration (`1752500000000-platform-hardening.ts`) — this task owns everything else in `src/audit/`, including the entity file (Task 1 owns the migration ONLY). The entity registers through `TypeOrmModule.forFeature` + the existing `autoLoadEntities: true`, so no `app.module.ts` change is needed.

Two invariants under test: an audit-insert failure must never fail the admin's request (`AuditService.record` catches its own errors), and a handler failure must still produce a `success: false` row before the error is rethrown untouched.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/audit/audit.interceptor.spec.ts
import 'reflect-metadata';
import { ExecutionContext, Logger, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';
import { AUDIT_ACTION, AuditAction } from './audit.decorator';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';

function mockContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => function handler() {},
    getClass: () => class Host {},
  } as unknown as ExecutionContext;
}

describe('AuditAction decorator', () => {
  it('stores { action, targetType } under the AUDIT_ACTION key on the handler', () => {
    class Dummy {
      @AuditAction('salon.status.set', 'salon')
      handler() {
        return 1;
      }
    }
    expect(Reflect.getMetadata(AUDIT_ACTION, Dummy.prototype.handler)).toEqual({
      action: 'salon.status.set',
      targetType: 'salon',
    });
  });
});

describe('AuditInterceptor', () => {
  let record: jest.Mock;
  let audit: AuditService;

  beforeEach(() => {
    record = jest.fn().mockResolvedValue(undefined);
    audit = { record } as unknown as AuditService;
  });

  function reflectorReturning(meta: unknown): Reflector {
    return { getAllAndOverride: jest.fn().mockReturnValue(meta) } as unknown as Reflector;
  }

  it('passes through untouched and records nothing when the handler has no @AuditAction metadata', async () => {
    const interceptor = new AuditInterceptor(reflectorReturning(undefined), audit);

    const result = await lastValueFrom(
      interceptor.intercept(mockContext({}), { handle: () => of('unchanged') }),
    );

    expect(result).toBe('unchanged');
    expect(record).not.toHaveBeenCalled();
  });

  it('records a success row with actor, target and payload after the handler resolves', async () => {
    const interceptor = new AuditInterceptor(
      reflectorReturning({ action: 'salon.status.set', targetType: 'salon' }),
      audit,
    );
    const req = { user: { id: 'admin-1' }, params: { id: 'salon-9' }, body: { status: 'approved' } };

    const result = await lastValueFrom(
      interceptor.intercept(mockContext(req), { handle: () => of({ id: 'salon-9' }) }),
    );

    expect(result).toEqual({ id: 'salon-9' });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      actorId: 'admin-1',
      action: 'salon.status.set',
      targetType: 'salon',
      targetId: 'salon-9',
      payload: { status: 'approved' },
      success: true,
    });
  });

  it('records success: false and rethrows the original error when the handler rejects', async () => {
    const interceptor = new AuditInterceptor(
      reflectorReturning({ action: 'salon.status.set', targetType: 'salon' }),
      audit,
    );
    const req = { user: { id: 'admin-1' }, params: { id: 'missing' }, body: { status: 'approved' } };

    await expect(
      lastValueFrom(
        interceptor.intercept(mockContext(req), { handle: () => throwError(() => new NotFoundException()) }),
      ),
    ).rejects.toThrow(NotFoundException);

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      actorId: 'admin-1',
      action: 'salon.status.set',
      targetType: 'salon',
      targetId: 'missing',
      payload: { status: 'approved' },
      success: false,
    });
  });

  it('records targetId: null and the raw body as payload for routes without an :id param', async () => {
    const interceptor = new AuditInterceptor(
      reflectorReturning({ action: 'config.update', targetType: 'config' }),
      audit,
    );
    const req = {
      user: { id: 'admin-1' },
      params: {},
      body: { updates: [{ key: 'commission_percent', value: 12 }] },
    };

    await lastValueFrom(interceptor.intercept(mockContext(req), { handle: () => of([]) }));

    expect(record).toHaveBeenCalledWith({
      actorId: 'admin-1',
      action: 'config.update',
      targetType: 'config',
      targetId: null,
      payload: { updates: [{ key: 'commission_percent', value: 12 }] },
      success: true,
    });
  });
});

describe('AuditService.record', () => {
  it('inserts the row as given on the happy path', async () => {
    const repo = { insert: jest.fn().mockResolvedValue(undefined) };
    const service = new AuditService(repo as unknown as Repository<AuditLog>);

    await service.record({
      actorId: 'admin-1',
      action: 'config.update',
      targetType: 'config',
      targetId: null,
      payload: { updates: [] },
      success: true,
    });

    expect(repo.insert).toHaveBeenCalledWith({
      actorId: 'admin-1',
      action: 'config.update',
      targetType: 'config',
      targetId: null,
      payload: { updates: [] },
      success: true,
    });
  });

  it('swallows insert failures (logger.error, no throw) so audit can never break the admin request', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const repo = { insert: jest.fn().mockRejectedValue(new Error('db down')) };
    const service = new AuditService(repo as unknown as Repository<AuditLog>);

    await expect(
      service.record({
        actorId: 'admin-1',
        action: 'salon.status.set',
        targetType: 'salon',
        targetId: 's1',
        payload: { status: 'approved' },
        success: true,
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test -- audit.interceptor`
Expected: FAIL with "Cannot find module './audit-log.entity'" (none of the audit files exist yet)

- [ ] **Step 3: Write the entity, decorator, service, interceptor, and module**

```typescript
// apps/api/src/audit/audit-log.entity.ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'actor_id' })
  actorId: string;

  @Column()
  action: string;

  @Column({ name: 'target_type' })
  targetType: string;

  @Column({ name: 'target_id', type: 'varchar', nullable: true })
  targetId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column()
  success: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

```typescript
// apps/api/src/audit/audit.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION = 'audit:action';

export interface AuditActionMetadata {
  action: string;
  targetType: string;
}

/**
 * Marks an admin mutation handler for audit capture. Read endpoints are never
 * annotated. Only takes effect on handlers whose controller/handler also applies
 * AuditInterceptor via @UseInterceptors.
 */
export const AuditAction = (action: string, targetType: string) =>
  SetMetadata(AUDIT_ACTION, { action, targetType });
```

```typescript
// apps/api/src/audit/audit.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

export interface AuditEntry {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  payload: unknown;
  success: boolean;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>) {}

  /**
   * Inserts one audit row. Catches its own failures -- an audit-log outage must
   * never fail the admin's request (spec §5: strictly non-blocking side effect).
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.auditLogs.insert({
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        payload: (entry.payload ?? null) as Record<string, unknown> | null,
        success: entry.success,
      });
    } catch (err) {
      this.logger.error(`Failed to write audit row for ${entry.action}: ${(err as Error).message}`);
    }
  }
}
```

```typescript
// apps/api/src/audit/audit.interceptor.ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, from, mergeMap, Observable, throwError } from 'rxjs';
import { AUDIT_ACTION, AuditActionMetadata } from './audit.decorator';
import { AuditService } from './audit.service';

/**
 * Writes one audit_log row per settled admin mutation carrying @AuditAction
 * metadata; passes through untouched otherwise. The insert is awaited on both
 * paths so the row is committed before the HTTP response goes out (keeps the
 * admin panel's follow-up reads and the e2e assertions deterministic), and
 * AuditService.record never throws, so the write can't fail the request.
 * On handler rejection the failure row is written first, then the original
 * error is rethrown untouched.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditActionMetadata | undefined>(AUDIT_ACTION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return next.handle();

    const req = context
      .switchToHttp()
      .getRequest<{ user: { id: string }; params?: Record<string, string>; body?: unknown }>();
    const base = {
      // Guards run before interceptors, and every audited route runs AuthGuard, so req.user is guaranteed.
      actorId: req.user.id,
      action: meta.action,
      targetType: meta.targetType,
      targetId: req.params?.id ?? null,
      // req.body is the raw parsed body: the global ValidationPipe whitelists the
      // handler's DTO argument, not req.body itself. Acceptable per spec §3.1 for
      // an admin-only, body-parser-bounded surface.
      payload: req.body ?? null,
    };

    return next.handle().pipe(
      mergeMap(async (result) => {
        await this.audit.record({ ...base, success: true });
        return result;
      }),
      catchError((err) =>
        from(this.audit.record({ ...base, success: false })).pipe(mergeMap(() => throwError(() => err))),
      ),
    );
  }
}
```

```typescript
// apps/api/src/audit/audit.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './audit-log.entity';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditService, AuditInterceptor],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test -- audit.interceptor`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/audit
git commit -m "feat(api): declarative audit capture — AuditAction decorator, AuditService, AuditInterceptor"
```

---

### Task 5: Wire audit capture onto the seven existing admin mutation handlers

**Files:**
- Test: `apps/api/src/audit/audit-wiring.spec.ts`
- Modify: `apps/api/src/salons/admin-salons.controller.ts:1,47-65`
- Modify: `apps/api/src/users/admin-users.controller.ts:1-13,45-51`
- Modify: `apps/api/src/reviews/admin-reviews.controller.ts:1,20-23`
- Modify: `apps/api/src/catalog/admin-categories.controller.ts:1,17-38`
- Modify: `apps/api/src/platform-config/admin-config.controller.ts:1,19-23`
- Modify: `apps/api/src/salons/salons.module.ts:1-25`
- Modify: `apps/api/src/auth/auth.module.ts:1-27`
- Modify: `apps/api/src/reviews/reviews.module.ts:1-14`
- Modify: `apps/api/src/catalog/catalog.module.ts:1-9`
- Modify: `apps/api/src/platform-config/platform-config.module.ts:1-10`

Annotates every admin mutation that exists today — the spec's nine-handler list (§3.1) minus `category.delete` and `report.resolve`, which are annotated in the tasks that create those endpoints (do NOT add them here). `@UseInterceptors(AuditInterceptor)` goes **per handler**, not on the controller class, so the tasks that later add new handlers to these controllers can annotate their own handlers without double-running the interceptor. Every hosting module imports `AuditModule` so Nest can resolve `AuditInterceptor` (and its `AuditService` dependency) in that module's context.

Exact action strings (shared contract — the admin-panel `auditActionLabel` map keys off these): `salon.status.set`, `salon.featured.set`, `user.status.set`, `review.moderate`, `category.create`, `category.update`, `config.update`.

- [ ] **Step 1: Write the failing wiring test**

`SetMetadata` and `UseInterceptors` both attach metadata directly to the handler function, so wiring is testable without booting Nest:

```typescript
// apps/api/src/audit/audit-wiring.spec.ts
import 'reflect-metadata';
import { AdminCategoriesController } from '../catalog/admin-categories.controller';
import { AdminConfigController } from '../platform-config/admin-config.controller';
import { AdminReviewsController } from '../reviews/admin-reviews.controller';
import { AdminSalonsController } from '../salons/admin-salons.controller';
import { AdminUsersController } from '../users/admin-users.controller';
import { AUDIT_ACTION } from './audit.decorator';
import { AuditInterceptor } from './audit.interceptor';

// Nest stores @UseInterceptors metadata under this key (INTERCEPTORS_METADATA in @nestjs/common/constants).
const INTERCEPTORS_METADATA = '__interceptors__';

describe('admin mutation audit wiring', () => {
  const cases = [
    {
      label: 'salon status',
      handler: AdminSalonsController.prototype.setStatus,
      action: 'salon.status.set',
      targetType: 'salon',
    },
    {
      label: 'salon featured',
      handler: AdminSalonsController.prototype.setFeatured,
      action: 'salon.featured.set',
      targetType: 'salon',
    },
    {
      label: 'user status',
      handler: AdminUsersController.prototype.setStatus,
      action: 'user.status.set',
      targetType: 'user',
    },
    {
      label: 'review moderate',
      handler: AdminReviewsController.prototype.moderate,
      action: 'review.moderate',
      targetType: 'review',
    },
    {
      label: 'category create',
      handler: AdminCategoriesController.prototype.create,
      action: 'category.create',
      targetType: 'category',
    },
    {
      label: 'category update',
      handler: AdminCategoriesController.prototype.update,
      action: 'category.update',
      targetType: 'category',
    },
    {
      label: 'config update',
      handler: AdminConfigController.prototype.update,
      action: 'config.update',
      targetType: 'config',
    },
  ];

  for (const { label, handler, action, targetType } of cases) {
    it(`${label} handler carries @AuditAction('${action}', '${targetType}')`, () => {
      expect(Reflect.getMetadata(AUDIT_ACTION, handler)).toEqual({ action, targetType });
    });

    it(`${label} handler runs through AuditInterceptor`, () => {
      expect(Reflect.getMetadata(INTERCEPTORS_METADATA, handler)).toContain(AuditInterceptor);
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test -- audit-wiring`
Expected: FAIL — all 14 tests, with `Expected: {"action": ..., "targetType": ...}` / `Received: undefined` (no controller carries the metadata yet)

- [ ] **Step 3: Annotate the five controllers**

Replace `apps/api/src/salons/admin-salons.controller.ts` with:

```typescript
import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminSalonQueryDto } from './dto/admin-salon-query.dto';
import { AdminSalonStatusDto } from './dto/admin-salon-status.dto';
import { SetFeaturedDto } from './dto/admin-salon.dto';
import { Salon } from './salon.entity';

@Controller('admin/salons')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminSalonsController {
  constructor(@InjectRepository(Salon) private readonly salons: Repository<Salon>) {}

  @Get()
  async list(@Query() query: AdminSalonQueryDto) {
    const qb = this.salons
      .createQueryBuilder('salon')
      .select(['salon.id', 'salon.name', 'salon.city', 'salon.status', 'salon.genderTarget', 'salon.isFeatured', 'salon.featuredUntil', 'salon.createdAt'])
      .orderBy('salon.name', 'ASC');

    const status = query.status ?? 'pending';
    if (status !== 'all') qb.andWhere('salon.status = :status', { status });

    if (query.city) qb.andWhere('salon.city ILIKE :city', { city: `%${query.city}%` });
    if (query.name) qb.andWhere('salon.name ILIKE :name', { name: `%${query.name}%` });
    if (query.genderTarget) qb.andWhere('salon.genderTarget = :genderTarget', { genderTarget: query.genderTarget });

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    qb.skip((page - 1) * pageSize).take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const salon = await this.salons.findOneBy({ id });
    if (!salon) throw new NotFoundException();
    return salon;
  }

  @Patch(':id/status')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('salon.status.set', 'salon')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminSalonStatusDto) {
    const result = await this.salons.update(
      { id },
      { status: dto.status, rejectionReason: dto.status === 'approved' ? null : (dto.reason ?? null) },
    );
    if (!result.affected) throw new NotFoundException();
    return this.salons.findOneBy({ id });
  }

  @Patch(':id/featured')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('salon.featured.set', 'salon')
  async setFeatured(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetFeaturedDto) {
    const result = await this.salons.update(
      { id },
      { isFeatured: dto.isFeatured, featuredUntil: dto.featuredUntil ? new Date(dto.featuredUntil) : null },
    );
    if (!result.affected) throw new NotFoundException();
    return this.salons.findOneBy({ id });
  }
}
```

Replace `apps/api/src/users/admin-users.controller.ts` with (note: the cascade-suspend task later moves `setStatus`'s body into `AdminUsersService` — it keeps these two decorators when it does):

```typescript
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Body,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminUserQueryDto, AdminUserStatusDto } from './dto/admin-user.dto';
import { User } from './user.entity';

@Controller('admin/users')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminUsersController {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  @Get()
  list(@Query() query: AdminUserQueryDto) {
    const qb = this.users
      .createQueryBuilder('user')
      .select(['user.id', 'user.phone', 'user.name', 'user.role', 'user.status', 'user.createdAt'])
      .orderBy('user.createdAt', 'DESC');

    if (query.phone) qb.andWhere('user.phone ILIKE :phone', { phone: `%${query.phone}%` });
    if (query.name) qb.andWhere('user.name ILIKE :name', { name: `%${query.name}%` });
    if (query.role) qb.andWhere('user.role = :role', { role: query.role });
    if (query.joinedFrom) qb.andWhere('user.createdAt >= :joinedFrom', { joinedFrom: query.joinedFrom });
    if (query.joinedTo) qb.andWhere('user.createdAt <= :joinedTo', { joinedTo: query.joinedTo });

    return qb.getMany();
  }

  @Patch(':id/status')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('user.status.set', 'user')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminUserStatusDto, @Req() req: Request) {
    if (id === (req.user as User).id) throw new BadRequestException('You cannot change your own account status');
    const result = await this.users.update({ id }, { status: dto.status });
    if (!result.affected) throw new NotFoundException();
    return this.users.findOneBy({ id });
  }
}
```

Replace `apps/api/src/reviews/admin-reviews.controller.ts` with:

```typescript
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminReviewQueryDto } from './dto/admin-review-query.dto';
import { ModerateReviewDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@Controller('admin/reviews')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@Query() query: AdminReviewQueryDto) {
    return this.reviews.listForAdmin(query);
  }

  @Patch(':id')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('review.moderate', 'review')
  moderate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerateReviewDto) {
    return this.reviews.moderate(id, dto.status);
  }
}
```

Replace `apps/api/src/catalog/admin-categories.controller.ts` with (Task 5b adds the `delete` handler with `@AuditAction('category.delete', 'category')` — not part of this task):

```typescript
import { Body, ConflictException, Controller, NotFoundException, Param, ParseIntPipe, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { ServiceCategory } from './service-category.entity';

@Controller('admin/categories')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminCategoriesController {
  constructor(@InjectRepository(ServiceCategory) private readonly categories: Repository<ServiceCategory>) {}

  @Post()
  @UseInterceptors(AuditInterceptor)
  @AuditAction('category.create', 'category')
  async create(@Body() dto: CreateCategoryDto) {
    try {
      return await this.categories.save(this.categories.create(dto));
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A category with this name already exists');
      throw err;
    }
  }

  @Patch(':id')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('category.update', 'category')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCategoryDto) {
    let result;
    try {
      result = await this.categories.update({ id }, dto);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A category with this name already exists');
      throw err;
    }
    if (!result.affected) throw new NotFoundException();
    return this.categories.findOneBy({ id });
  }
}
```

Replace `apps/api/src/platform-config/admin-config.controller.ts` with:

```typescript
import { Body, Controller, Get, Patch, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateConfigDto } from './dto/admin-config.dto';
import { PlatformConfigService } from './platform-config.service';

@Controller('admin/config')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminConfigController {
  constructor(private readonly config: PlatformConfigService) {}

  @Get()
  list() {
    return this.config.listAll();
  }

  @Patch()
  @UseInterceptors(AuditInterceptor)
  @AuditAction('config.update', 'config')
  async update(@Body() dto: UpdateConfigDto) {
    await this.config.setMany(dto.updates);
    return this.config.listAll();
  }
}
```

- [ ] **Step 4: Import `AuditModule` into the five hosting modules**

Replace `apps/api/src/salons/salons.module.ts` with:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { AdminSalonsController } from './admin-salons.controller';
import { PublicSalonContentController } from './public-salon-content.controller';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonPhoto } from './salon-photo.entity';
import { SalonPhotosController } from './salon-photos.controller';
import { SalonService } from './salon-service.entity';
import { Salon } from './salon.entity';
import { SalonServicesController } from './salon-services.controller';
import { SalonsController } from './salons.controller';
import { SalonsService } from './salons.service';
import { ScheduleController } from './schedule.controller';
import { ScheduleException } from './schedule-exception.entity';
import { SitemapSalonsController } from './sitemap-salons.controller';
import { WorkingHour } from './working-hour.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Salon, SalonService, WorkingHour, ScheduleException, SalonPhoto]),
    AuthModule,
    StorageModule,
    AuditModule,
  ],
  controllers: [
    SalonServicesController,
    ScheduleController,
    SalonPhotosController,
    SalonsController,
    AdminSalonsController,
    SitemapSalonsController,
    // PublicSalonContentController owns wildcard routes shaped `salons/:slug/...` (e.g. services, hours).
    // NestJS/Express matches routes in registration order, not by specificity, so it MUST stay registered
    // after any controller with a literal `salons/mine/...`-shaped route of the same depth (currently
    // SalonServicesController, ScheduleController, SalonPhotosController) or it will silently shadow them.
    PublicSalonContentController,
  ],
  providers: [SalonsService, SalonOwnerGuard],
  exports: [SalonsService, SalonOwnerGuard, TypeOrmModule],
})
export class SalonsModule {}
```

Replace `apps/api/src/auth/auth.module.ts` with (AuthModule hosts `AdminUsersController`; note `AuditModule` must never import `AuthModule` back, or this becomes a cycle — see Task 6):

```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { SmsModule } from '../sms/sms.module';
import { UsersModule } from '../users/users.module';
import { AdminUsersController } from '../users/admin-users.controller';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { OtpService } from './otp.service';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [
    UsersModule,
    SmsModule,
    AuditModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow('JWT_SECRET'),
        signOptions: { expiresIn: '30d' },
      }),
    }),
  ],
  controllers: [AuthController, AdminUsersController],
  providers: [OtpService, AuthGuard, RolesGuard],
  exports: [OtpService, AuthGuard, RolesGuard, UsersModule],
})
export class AuthModule {}
```

Replace `apps/api/src/reviews/reviews.module.ts` with:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminReviewsController } from './admin-reviews.controller';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { Booking } from '../booking/booking.entity';
import { SalonsModule } from '../salons/salons.module';
import { Review } from './review.entity';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { SalonReviewReplyController } from './salon-review-reply.controller';
import { SalonReviewsController } from './salon-reviews.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Review, Booking]), AuthModule, SalonsModule, AuditModule],
  controllers: [ReviewsController, SalonReviewsController, SalonReviewReplyController, AdminReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
```

Replace `apps/api/src/catalog/catalog.module.ts` with:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AdminCategoriesController } from './admin-categories.controller';
import { CatalogController } from './catalog.controller';
import { ServiceCategory } from './service-category.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ServiceCategory]), AuthModule, AuditModule],
  controllers: [CatalogController, AdminCategoriesController],
  exports: [TypeOrmModule],
})
export class CatalogModule {}
```

Replace `apps/api/src/platform-config/platform-config.module.ts` with:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AdminConfigController } from './admin-config.controller';
import { PlatformConfig } from './platform-config.entity';
import { PlatformConfigController } from './platform-config.controller';
import { PlatformConfigService } from './platform-config.service';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformConfig]), AuthModule, AuditModule],
  controllers: [PlatformConfigController, AdminConfigController],
  providers: [PlatformConfigService],
  exports: [PlatformConfigService],
})
export class PlatformConfigModule {}
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `pnpm --filter @arayeshgah/api test -- audit`
Expected: PASS — `audit-wiring.spec.ts` (14 tests) and `audit.interceptor.spec.ts` (7 tests) both green

- [ ] **Step 6: Smoke the existing admin e2e suites against the wired interceptor**

Requires docker services up (`docker compose up -d`); `resetDatabase()` re-runs all migrations including Task 1's, so the `audit_log` table exists.

Run: `pnpm --filter @arayeshgah/api test:e2e -- admin-salon-status admin-users admin-categories admin-config admin-reviews-list reviews`
Expected: PASS — proves `AuditInterceptor` resolves via DI in all five hosting modules, the app boots, and audit inserts change no existing response or status code (including the 404/400/409 failure paths, which now also write `success: false` rows)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/audit/audit-wiring.spec.ts apps/api/src/salons apps/api/src/users apps/api/src/reviews apps/api/src/catalog apps/api/src/platform-config apps/api/src/auth
git commit -m "feat(api): wire audit capture onto the seven existing admin mutation handlers"
```

---

### Task 5b: `DELETE /api/admin/categories/:id` — restrict-style category delete

**Files:**
- Modify: `apps/api/src/catalog/admin-categories.controller.ts` (add a `remove` handler after `update`)
- Modify: `apps/api/src/audit/audit-wiring.spec.ts` (add the `category.delete` case)
- Test: `apps/api/test/category-delete.e2e-spec.ts`

Spec §3.4: attempt the delete with **no pre-check** — the DB constraint is the source of truth (same idiom as the 23505 handling above). `salon_services.category_id` is a bare `REFERENCES service_categories(id)` (NO ACTION), so deleting a referenced category raises Postgres 23503, which Task 2's `isForeignKeyViolation` translates to a 409 with a Farsi message. 404 when no row was deleted, 204 on success. This is the endpoint the admin-panel's Task 20 delete button calls, and the 8th audited handler (Task 11's `report.resolve` is the 9th). Note: a service soft-deleted via `DELETE /api/salons/mine/services/:id` only sets `is_active=false` — its FK row still exists and still blocks the delete. That's intentional (spec §3.4).

- [ ] **Step 1: Extend the wiring spec with the failing `category.delete` case**

In `apps/api/src/audit/audit-wiring.spec.ts`, add to the `cases` array after the `category update` entry:

```typescript
    {
      label: 'category delete',
      handler: AdminCategoriesController.prototype.remove,
      action: 'category.delete',
      targetType: 'category',
    },
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @arayeshgah/api test -- audit-wiring`
Expected: FAIL — the two new tests error (`AdminCategoriesController.prototype.remove` is `undefined`); the original 14 still pass.

- [ ] **Step 3: Write the failing e2e spec**

```typescript
// apps/api/test/category-delete.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin category delete (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let ownerCookie: string;
  let unusedCategoryId: number;
  let usedCategoryId: number;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09127770001');

    // one deletable category, one that a salon service will reference
    const unused = await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Cookie', adminCookie)
      .send({ name: 'دسته بدون استفاده', icon: 'scissors' })
      .expect(201);
    unusedCategoryId = unused.body.id;

    const used = await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Cookie', adminCookie)
      .send({ name: 'دسته در حال استفاده', icon: 'scissors' })
      .expect(201);
    usedCategoryId = used.body.id;

    ownerCookie = await loginAs(app, '09127770002');
    await request(app.getHttpServer())
      .post('/api/salons')
      .set('Cookie', ownerCookie)
      .send({
        name: 'سالن تست دسته',
        genderTarget: 'women',
        address: 'خیابان ولیعصر، پلاک ۱۲',
        city: 'Tehran',
        lat: 35.7,
        lng: 51.4,
      })
      .expect(201);

    const service = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId: usedCategoryId, name: 'کوتاهی مو', price: 350000, durationMin: 45 })
      .expect(201);
    serviceId = service.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects non-admin callers', async () => {
    await request(app.getHttpServer())
      .delete(`/api/admin/categories/${unusedCategoryId}`)
      .set('Cookie', ownerCookie)
      .expect(403);
  });

  it('409s for a category referenced by a service, with the Farsi message', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/admin/categories/${usedCategoryId}`)
      .set('Cookie', adminCookie)
      .expect(409);
    expect(res.body.message).toBe('این دسته‌بندی توسط خدمات سالن‌ها استفاده می‌شود و قابل حذف نیست');
  });

  it('still 409s when the referencing service is only soft-deleted (is_active=false)', async () => {
    await request(app.getHttpServer())
      .delete(`/api/salons/mine/services/${serviceId}`)
      .set('Cookie', ownerCookie)
      .expect(204);

    await request(app.getHttpServer())
      .delete(`/api/admin/categories/${usedCategoryId}`)
      .set('Cookie', adminCookie)
      .expect(409);
  });

  it('204s for an unused category and removes it from the public list', async () => {
    await request(app.getHttpServer())
      .delete(`/api/admin/categories/${unusedCategoryId}`)
      .set('Cookie', adminCookie)
      .expect(204);

    const list = await request(app.getHttpServer()).get('/api/categories').expect(200);
    expect(list.body.some((c: { id: number }) => c.id === unusedCategoryId)).toBe(false);
  });

  it('404s for an already-deleted category', async () => {
    await request(app.getHttpServer())
      .delete(`/api/admin/categories/${unusedCategoryId}`)
      .set('Cookie', adminCookie)
      .expect(404);
  });

  it('wrote category.delete audit rows for every admin attempt above', async () => {
    // Task 6's read endpoint doesn't exist yet — query the table directly.
    // AuditInterceptor awaits the insert before the response, so no polling is needed.
    const ds = app.get(DataSource);
    const rows: Array<{ target_id: string; success: boolean }> = await ds.query(
      `SELECT target_id, success FROM audit_log WHERE action = 'category.delete' ORDER BY created_at`,
    );

    // 409, soft-deleted 409, 204, 404 — the non-admin 403 is rejected by the guard
    // before the interceptor runs, so it writes no row.
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.success)).toHaveLength(1);
    expect(rows.filter((r) => r.success)[0].target_id).toBe(String(unusedCategoryId));
  });
});
```

- [ ] **Step 4: Run the e2e to verify it fails**

Run (docker services up): `pnpm --filter @arayeshgah/api test:e2e -- category-delete`
Expected: FAIL — every admin `DELETE` returns 404 (`Cannot DELETE /api/admin/categories/...`): the route doesn't exist yet. (The non-admin test also sees 404 instead of 403 for the same reason.)

- [ ] **Step 5: Add the delete handler**

Replace `apps/api/src/catalog/admin-categories.controller.ts` with (this is the Task 5 version plus the `Delete`/`HttpCode` imports, the `isForeignKeyViolation` import, and the `remove` handler):

```typescript
import { Body, ConflictException, Controller, Delete, HttpCode, NotFoundException, Param, ParseIntPipe, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { isForeignKeyViolation, isUniqueViolation } from '../common/postgres-error-codes';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { ServiceCategory } from './service-category.entity';

@Controller('admin/categories')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminCategoriesController {
  constructor(@InjectRepository(ServiceCategory) private readonly categories: Repository<ServiceCategory>) {}

  @Post()
  @UseInterceptors(AuditInterceptor)
  @AuditAction('category.create', 'category')
  async create(@Body() dto: CreateCategoryDto) {
    try {
      return await this.categories.save(this.categories.create(dto));
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A category with this name already exists');
      throw err;
    }
  }

  @Patch(':id')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('category.update', 'category')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCategoryDto) {
    let result;
    try {
      result = await this.categories.update({ id }, dto);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A category with this name already exists');
      throw err;
    }
    if (!result.affected) throw new NotFoundException();
    return this.categories.findOneBy({ id });
  }

  @Delete(':id')
  @HttpCode(204)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('category.delete', 'category')
  async remove(@Param('id', ParseIntPipe) id: number) {
    let result;
    try {
      result = await this.categories.delete({ id });
    } catch (err) {
      // No pre-check by design: salon_services.category_id REFERENCES service_categories(id)
      // (NO ACTION) makes Postgres the source of truth for "in use".
      if (isForeignKeyViolation(err)) {
        throw new ConflictException('این دسته‌بندی توسط خدمات سالن‌ها استفاده می‌شود و قابل حذف نیست');
      }
      throw err;
    }
    if (!result.affected) throw new NotFoundException();
  }
}
```

- [ ] **Step 6: Run both suites to verify they pass**

Run: `pnpm --filter @arayeshgah/api test -- audit-wiring`
Expected: PASS (16 tests)

Run: `pnpm --filter @arayeshgah/api test:e2e -- category-delete`
Expected: PASS (6 tests)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/catalog/admin-categories.controller.ts apps/api/src/audit/audit-wiring.spec.ts apps/api/test/category-delete.e2e-spec.ts
git commit -m "feat(api): restrict-style DELETE /admin/categories/:id with audit capture"
```

---

### Task 6: `GET /api/admin/audit-log` — filtered, paginated, with actor identity

**Files:**
- Create: `apps/api/src/audit/dto/audit-log-query.dto.ts`
- Create: `apps/api/src/audit/admin-audit.controller.ts`
- Modify: `apps/api/src/audit/audit.service.ts:1-40` (add `Repository<User>` + `listForAdmin`)
- Modify: `apps/api/src/audit/audit.module.ts:1-13` (import `UsersModule`, register the controller)
- Modify: `apps/api/src/audit/audit.interceptor.spec.ts` (the two `new AuditService(...)` calls gain the new constructor arg)
- Test: `apps/api/src/audit/audit.service.spec.ts`

The admin read endpoint per spec §3.1: `{items, total, page, pageSize}` envelope, `pageSize` default 20 / max 100, filters `actorId`/`action`/`targetType`/`from`/`to`, items carry the actor's phone and name. The list query mirrors `ReviewsService.listForAdmin` (conditional `where` object → `findAndCount` → envelope); the actor join is a **second `IN` lookup** rather than a query-builder join, because entities in this repo carry no relation decorators and one `IN` query over at most 100 ids is cheap.

**Module-cycle note:** `AuthModule` already imports `AuditModule` (Task 5), so `AuditModule` must NOT import `AuthModule` for its guards. Instead it imports `UsersModule` directly — that provides `UsersService` (which `AuthGuard` needs) and the `User` repository token (`UsersModule` exports its `TypeOrmModule.forFeature([User])`). `AuthGuard`/`RolesGuard` are class references in `@UseGuards`, so Nest instantiates them in `AuditModule`'s context; their remaining deps (`JwtService`, `Reflector`) are global.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/audit/audit.service.spec.ts
import { Between, In, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { AuditLog } from './audit-log.entity';
import { AuditService } from './audit.service';

function makeService(overrides?: {
  logs?: { findAndCount: jest.Mock };
  users?: { find: jest.Mock };
}) {
  const logs = {
    insert: jest.fn(),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    ...overrides?.logs,
  };
  const users = overrides?.users ?? { find: jest.fn().mockResolvedValue([]) };
  const service = new AuditService(
    logs as unknown as Repository<AuditLog>,
    users as unknown as Repository<User>,
  );
  return { service, logs, users };
}

describe('AuditService.listForAdmin', () => {
  it('defaults to page 1 / pageSize 20, newest first, with no filters', async () => {
    const { service, logs, users } = makeService();

    const result = await service.listForAdmin({});

    expect(logs.findAndCount).toHaveBeenCalledWith({
      where: {},
      order: { createdAt: 'DESC' },
      skip: 0,
      take: 20,
    });
    expect(users.find).not.toHaveBeenCalled();
    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('applies actorId/action/targetType/from/to filters and explicit paging', async () => {
    const { service, logs } = makeService();

    await service.listForAdmin({
      actorId: 'u1',
      action: 'salon.status.set',
      targetType: 'salon',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
      page: 3,
      pageSize: 50,
    });

    expect(logs.findAndCount).toHaveBeenCalledWith({
      where: {
        actorId: 'u1',
        action: 'salon.status.set',
        targetType: 'salon',
        createdAt: Between(new Date('2026-01-01T00:00:00.000Z'), new Date('2026-02-01T00:00:00.000Z')),
      },
      order: { createdAt: 'DESC' },
      skip: 100,
      take: 50,
    });
  });

  it('joins actor phone/name onto each item via a second IN lookup', async () => {
    const row = {
      id: 'log-1',
      actorId: 'u1',
      action: 'salon.status.set',
      targetType: 'salon',
      targetId: 's1',
      payload: { status: 'approved' },
      success: true,
      createdAt: new Date('2026-07-10T10:00:00.000Z'),
    };
    const { service, users } = makeService({
      logs: { findAndCount: jest.fn().mockResolvedValue([[row], 1]) },
      users: { find: jest.fn().mockResolvedValue([{ id: 'u1', phone: '09121112233', name: 'مدیر سامانه' }]) },
    });

    const result = await service.listForAdmin({});

    expect(users.find).toHaveBeenCalledWith({ where: { id: In(['u1']) }, select: ['id', 'phone', 'name'] });
    expect(result.items[0]).toEqual({ ...row, actorPhone: '09121112233', actorName: 'مدیر سامانه' });
    expect(result.total).toBe(1);
  });

  it('returns null actor fields when the actor row cannot be found', async () => {
    const row = {
      id: 'log-2',
      actorId: 'ghost',
      action: 'config.update',
      targetType: 'config',
      targetId: null,
      payload: null,
      success: true,
      createdAt: new Date('2026-07-10T11:00:00.000Z'),
    };
    const { service } = makeService({
      logs: { findAndCount: jest.fn().mockResolvedValue([[row], 1]) },
    });

    const result = await service.listForAdmin({});

    expect(result.items[0].actorPhone).toBeNull();
    expect(result.items[0].actorName).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test -- audit.service`
Expected: FAIL — TypeScript compile errors: `Expected 1 arguments, but got 2` (constructor) and `Property 'listForAdmin' does not exist on type 'AuditService'`

- [ ] **Step 3: Extend `AuditService`**

Replace `apps/api/src/audit/audit.service.ts` with:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { AuditLog } from './audit-log.entity';

export interface AuditEntry {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  payload: unknown;
  success: boolean;
}

export interface AuditLogQuery {
  actorId?: string;
  action?: string;
  targetType?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export type AuditLogListItem = AuditLog & { actorPhone: string | null; actorName: string | null };

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /**
   * Inserts one audit row. Catches its own failures -- an audit-log outage must
   * never fail the admin's request (spec §5: strictly non-blocking side effect).
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.auditLogs.insert({
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        payload: (entry.payload ?? null) as Record<string, unknown> | null,
        success: entry.success,
      });
    } catch (err) {
      this.logger.error(`Failed to write audit row for ${entry.action}: ${(err as Error).message}`);
    }
  }

  async listForAdmin(
    query: AuditLogQuery,
  ): Promise<{ items: AuditLogListItem[]; total: number; page: number; pageSize: number }> {
    const where: Record<string, unknown> = {};
    if (query.actorId) where.actorId = query.actorId;
    if (query.action) where.action = query.action;
    if (query.targetType) where.targetType = query.targetType;
    if (query.from && query.to) where.createdAt = Between(new Date(query.from), new Date(query.to));
    else if (query.from) where.createdAt = MoreThanOrEqual(new Date(query.from));
    else if (query.to) where.createdAt = LessThanOrEqual(new Date(query.to));

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [logs, total] = await this.auditLogs.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // Second lookup instead of a QB join: entities carry no relation decorators
    // (repo convention), and one IN query over <=100 ids is cheap.
    const actorIds = [...new Set(logs.map((log) => log.actorId))];
    const actors = actorIds.length
      ? await this.users.find({ where: { id: In(actorIds) }, select: ['id', 'phone', 'name'] })
      : [];
    const actorById = new Map(actors.map((actor) => [actor.id, actor]));

    const items = logs.map((log) => ({
      ...log,
      actorPhone: actorById.get(log.actorId)?.phone ?? null,
      actorName: actorById.get(log.actorId)?.name ?? null,
    }));
    return { items, total, page, pageSize };
  }
}
```

- [ ] **Step 4: Update the Task 4 spec for the new constructor arg**

In `apps/api/src/audit/audit.interceptor.spec.ts`, add one import next to the existing `typeorm` import:

```typescript
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
```

Then in the `AuditService.record` describe block, replace **both** occurrences of:

```typescript
    const service = new AuditService(repo as unknown as Repository<AuditLog>);
```

with:

```typescript
    const service = new AuditService(
      repo as unknown as Repository<AuditLog>,
      { find: jest.fn() } as unknown as Repository<User>,
    );
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `pnpm --filter @arayeshgah/api test -- audit`
Expected: PASS — `audit.service.spec.ts` (4 tests), `audit.interceptor.spec.ts` (7 tests), `audit-wiring.spec.ts` (16 tests — includes Task 5b's `category.delete` case)

- [ ] **Step 6: Add the DTO, controller, and module wiring**

```typescript
// apps/api/src/audit/dto/audit-log-query.dto.ts
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class AuditLogQueryDto {
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  targetType?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
```

```typescript
// apps/api/src/audit/admin-audit.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuditService } from './audit.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

@Controller('admin/audit-log')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() query: AuditLogQueryDto) {
    return this.audit.listForAdmin(query);
  }
}
```

Replace `apps/api/src/audit/audit.module.ts` with:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AdminAuditController } from './admin-audit.controller';
import { AuditLog } from './audit-log.entity';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';

@Module({
  // UsersModule (NOT AuthModule -- AuthModule imports AuditModule, importing it back
  // would create a module cycle) supplies UsersService for AuthGuard and the User
  // repository token for AuditService's actor lookup.
  imports: [TypeOrmModule.forFeature([AuditLog]), UsersModule],
  controllers: [AdminAuditController],
  providers: [AuditService, AuditInterceptor],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}
```

- [ ] **Step 7: Verify the workspace still compiles**

Run: `pnpm --filter @arayeshgah/api build`
Expected: PASS (nest build exits 0). Full endpoint behavior is verified end-to-end in Task 7.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/audit
git commit -m "feat(api): GET /api/admin/audit-log with filters, pagination, and actor identity"
```

---

### Task 7: e2e — admin audit trail end to end

**Files:**
- Test: `apps/api/test/audit-log.e2e-spec.ts`

Exercises the whole pipeline against real Postgres: an admin mutation writes a row through the interceptor (success and failure paths, Farsi payload round-tripped through jsonb), and the new endpoint filters, paginates, joins actor identity, and enforces admin-only access. Because the interceptor awaits the insert before the response is sent (Task 4), the follow-up `GET` needs no polling or sleeps. Harness conventions follow `test/admin-salon-status.e2e-spec.ts`: `resetDatabase()` (re-runs all migrations) + `createTestApp()` + `loginAs`/`loginAsAdmin` from `test/utils/auth-helper.ts`.

Prerequisite: docker services up (`docker compose up -d`).

- [ ] **Step 1: Write the e2e spec**

```typescript
// apps/api/test/audit-log.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

describe('Admin audit log (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let adminId: string;
  let salonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09127770001');

    const me = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', adminCookie).expect(200);
    adminId = me.body.id;

    const ownerCookie = await loginAs(app, '09127770002');
    const createRes = await request(app.getHttpServer())
      .post('/api/salons')
      .set('Cookie', ownerCookie)
      .send({
        name: 'Audit Trail Salon',
        genderTarget: 'women',
        address: 'Valiasr St, No. 12',
        city: 'Tehran',
        lat: 35.7,
        lng: 51.4,
      })
      .expect(201);
    salonId = createRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('captures an admin salon approval as a success row with actor identity', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(200);

    const res = await request(app.getHttpServer()).get('/api/admin/audit-log').set('Cookie', adminCookie).expect(200);

    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(20);
    const row = res.body.items.find(
      (item: { action: string; targetId: string | null; success: boolean }) =>
        item.action === 'salon.status.set' && item.targetId === salonId && item.success === true,
    );
    expect(row).toBeDefined();
    expect(row.targetType).toBe('salon');
    expect(row.actorId).toBe(adminId);
    expect(row.actorPhone).toBe('09127770001');
    expect(row.payload).toEqual({ status: 'approved' });
  });

  it('captures the request body verbatim, including Farsi text', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'suspended', reason: 'شکایت مشتری از بهداشت سالن' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ action: 'salon.status.set' })
      .expect(200);

    const row = res.body.items.find(
      (item: { payload: { status?: string } | null }) => item.payload?.status === 'suspended',
    );
    expect(row).toBeDefined();
    expect(row.payload).toEqual({ status: 'suspended', reason: 'شکایت مشتری از بهداشت سالن' });
  });

  it('writes a success:false row when the mutation 404s, and still returns the 404', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${ZERO_UUID}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(404);

    const res = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ action: 'salon.status.set' })
      .expect(200);

    const row = res.body.items.find((item: { targetId: string | null }) => item.targetId === ZERO_UUID);
    expect(row).toBeDefined();
    expect(row.success).toBe(false);
  });

  it('filters by action', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/featured`)
      .set('Cookie', adminCookie)
      .send({ isFeatured: true })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ action: 'salon.featured.set' })
      .expect(200);

    expect(res.body.total).toBe(1);
    for (const item of res.body.items) expect(item.action).toBe('salon.featured.set');
    expect(res.body.items[0].targetId).toBe(salonId);
    expect(res.body.items[0].payload).toEqual({ isFeatured: true });
  });

  it('filters by actorId and targetType', async () => {
    // Rows so far: approve, suspend, failed 404 approve, set-featured -- all by this admin, all targeting salons.
    const mine = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ actorId: adminId })
      .expect(200);
    expect(mine.body.total).toBeGreaterThanOrEqual(4);

    const nobody = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ actorId: '11111111-1111-1111-1111-111111111111' })
      .expect(200);
    expect(nobody.body.total).toBe(0);

    const salons = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ targetType: 'salon' })
      .expect(200);
    expect(salons.body.total).toBeGreaterThanOrEqual(4);
    for (const item of salons.body.items) expect(item.targetType).toBe('salon');
  });

  it('filters by created-at window', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ from: '2000-01-01T00:00:00.000Z', to: '2000-01-02T00:00:00.000Z' })
      .expect(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  it('paginates newest-first', async () => {
    const pageOne = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ page: 1, pageSize: 1 })
      .expect(200);
    expect(pageOne.body.items).toHaveLength(1);
    expect(pageOne.body.pageSize).toBe(1);
    expect(pageOne.body.total).toBeGreaterThanOrEqual(4);

    const pageTwo = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ page: 2, pageSize: 1 })
      .expect(200);
    expect(pageTwo.body.items).toHaveLength(1);
    expect(pageTwo.body.items[0].id).not.toBe(pageOne.body.items[0].id);
    expect(new Date(pageOne.body.items[0].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(pageTwo.body.items[0].createdAt).getTime(),
    );
  });

  it('400s a pageSize over 100 and a malformed actorId', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ pageSize: 101 })
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ actorId: 'not-a-uuid' })
      .expect(400);
  });

  it('rejects non-admin callers with 403 and anonymous callers with 401', async () => {
    const customerCookie = await loginAs(app, '09127770099');
    await request(app.getHttpServer()).get('/api/admin/audit-log').set('Cookie', customerCookie).expect(403);
    await request(app.getHttpServer()).get('/api/admin/audit-log').expect(401);
  });
});
```

- [ ] **Step 2: Run the e2e spec**

Run: `pnpm --filter @arayeshgah/api test:e2e -- audit-log`
Expected: PASS (9 tests). This is a verification task over Tasks 4–6 (no new implementation), so it should pass first run. If anything fails, it points at a wiring gap: a DI error at boot means a hosting module is missing its `AuditModule` import (Task 5) or `AuditModule` accidentally imports `AuthModule` (cycle, Task 6); a missing-row failure means an interceptor/decorator didn't get applied to that handler; a `relation "audit_log" does not exist` error means Task 1's migration isn't in `src/migrations/`.

- [ ] **Step 3: Run the full backend unit suite to confirm nothing regressed**

Run: `pnpm --filter @arayeshgah/api test`
Expected: PASS — all suites, including the pre-existing ones untouched by this plan

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/audit-log.e2e-spec.ts
git commit -m "test(api): e2e coverage for the admin audit trail"
```

### Task 8: Admin notifications module — entity, service, and polled queue endpoints

**Files:**
- Create: `apps/api/src/admin-notifications/admin-notification.entity.ts`
- Create: `apps/api/src/admin-notifications/admin-notifications.service.ts`
- Create: `apps/api/src/admin-notifications/dto/admin-notification-query.dto.ts`
- Create: `apps/api/src/admin-notifications/admin-notifications.controller.ts`
- Create: `apps/api/src/admin-notifications/admin-notifications.module.ts`
- Test: `apps/api/src/admin-notifications/admin-notifications.service.spec.ts`
- Test: `apps/api/test/admin-notifications.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts` (imports array, lines 17–47)

The `admin_notifications` table already exists (Task 1's migration). This task builds the module over it per spec §3.6: a persisted queue the admin panel polls — `emit()` for producers (the resubmit hook in Task 9 and report creation), plus four admin read/ack endpoints. `emit()` **throws on failure** by design; each caller decides whether to swallow (resubmit does, report creation lets the transaction abort). Read state is shared across all admins (deliberate cut, spec §8).

- [ ] **Step 1: Write the failing service unit spec**

```typescript
// apps/api/src/admin-notifications/admin-notifications.service.spec.ts
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, IsNull } from 'typeorm';
import { AdminNotification } from './admin-notification.entity';
import { AdminNotificationsService } from './admin-notifications.service';

describe('AdminNotificationsService', () => {
  let service: AdminNotificationsService;
  let repo: {
    insert: jest.Mock;
    findAndCount: jest.Mock;
    countBy: jest.Mock;
    findOneBy: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      insert: jest.fn(),
      findAndCount: jest.fn(),
      countBy: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn((n) => n),
      update: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminNotificationsService,
        { provide: getRepositoryToken(AdminNotification), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(AdminNotificationsService);
  });

  describe('emit', () => {
    it('inserts via its own repository when no manager is given', async () => {
      await service.emit('salon_resubmitted', 'عنوان اعلان', 'متن اعلان', '/salons/s1');
      expect(repo.insert).toHaveBeenCalledWith({
        type: 'salon_resubmitted',
        title: 'عنوان اعلان',
        body: 'متن اعلان',
        link: '/salons/s1',
      });
    });

    it('inserts through the provided EntityManager instead of its own repository', async () => {
      const managerInsert = jest.fn();
      const manager = {
        getRepository: jest.fn().mockReturnValue({ insert: managerInsert }),
      } as unknown as EntityManager;

      await service.emit('report_created', 'گزارش جدید ثبت شد', null, '/reports', manager);

      expect(manager.getRepository).toHaveBeenCalledWith(AdminNotification);
      expect(managerInsert).toHaveBeenCalledWith({
        type: 'report_created',
        title: 'گزارش جدید ثبت شد',
        body: null,
        link: '/reports',
      });
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('propagates insert failures to the caller (callers decide whether to swallow)', async () => {
      repo.insert.mockRejectedValueOnce(new Error('db down'));
      await expect(service.emit('salon_resubmitted', 'عنوان اعلان', null, null)).rejects.toThrow('db down');
    });
  });

  describe('unreadCount', () => {
    it('counts only rows with no read_at', async () => {
      repo.countBy.mockResolvedValue(3);
      await expect(service.unreadCount()).resolves.toBe(3);
      expect(repo.countBy).toHaveBeenCalledWith({ readAt: IsNull() });
    });
  });

  describe('list', () => {
    it('returns the standard envelope with default paging', async () => {
      repo.findAndCount.mockResolvedValue([[{ id: 'n1' }], 1]);
      const result = await service.list({});
      expect(result).toEqual({ items: [{ id: 'n1' }], total: 1, page: 1, pageSize: 20 });
      expect(repo.findAndCount).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: 'DESC' },
        skip: 0,
        take: 20,
      });
    });

    it('filters to unread rows when unread=true and applies paging', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);
      await service.list({ unread: 'true', page: 2, pageSize: 10 });
      expect(repo.findAndCount).toHaveBeenCalledWith({
        where: { readAt: IsNull() },
        order: { createdAt: 'DESC' },
        skip: 10,
        take: 10,
      });
    });
  });

  describe('markRead', () => {
    it('stamps read_at on an unread notification', async () => {
      repo.findOneBy.mockResolvedValue({ id: 'n1', readAt: null });
      const result = await service.markRead('n1');
      expect(result.readAt).toBeInstanceOf(Date);
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('is idempotent: an already-read notification is returned unchanged without a write', async () => {
      const readAt = new Date('2026-07-10T10:00:00Z');
      repo.findOneBy.mockResolvedValue({ id: 'n1', readAt });
      const result = await service.markRead('n1');
      expect(result.readAt).toBe(readAt);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('404s on an unknown id', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.markRead('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('markAllRead', () => {
    it('stamps read_at on every unread row in one update', async () => {
      await service.markAllRead();
      expect(repo.update).toHaveBeenCalledWith({ readAt: IsNull() }, { readAt: expect.any(Date) });
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @arayeshgah/api test -- admin-notifications.service`
Expected: FAIL with "Cannot find module './admin-notification.entity'" (nothing under `src/admin-notifications/` exists yet).

- [ ] **Step 3: Write the entity, query DTO, and service**

Entity per repo convention — plain columns, explicit snake_case names, no relation decorators. Columns mirror the Task 1 migration exactly.

```typescript
// apps/api/src/admin-notifications/admin-notification.entity.ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('admin_notifications')
export class AdminNotification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40 })
  type: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  body: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  link: string | null;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

```typescript
// apps/api/src/admin-notifications/dto/admin-notification-query.dto.ts
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class AdminNotificationQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  unread?: 'true' | 'false';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
```

```typescript
// apps/api/src/admin-notifications/admin-notifications.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { AdminNotification } from './admin-notification.entity';
import { AdminNotificationQueryDto } from './dto/admin-notification-query.dto';

@Injectable()
export class AdminNotificationsService {
  constructor(
    @InjectRepository(AdminNotification) private readonly repo: Repository<AdminNotification>,
  ) {}

  /**
   * Insert a notification row. When a manager is provided the insert joins the
   * caller's transaction (report creation does this so the notification and the
   * report commit or roll back together); otherwise the service's own repository
   * is used. THROWS on failure — each caller decides whether to swallow.
   */
  async emit(
    type: string,
    title: string,
    body: string | null,
    link: string | null,
    manager?: EntityManager,
  ): Promise<void> {
    const row = { type, title, body, link };
    if (manager) {
      await manager.getRepository(AdminNotification).insert(row);
    } else {
      await this.repo.insert(row);
    }
  }

  async list(query: AdminNotificationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await this.repo.findAndCount({
      where: query.unread === 'true' ? { readAt: IsNull() } : {},
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  unreadCount(): Promise<number> {
    return this.repo.countBy({ readAt: IsNull() });
  }

  async markRead(id: string): Promise<AdminNotification> {
    const notification = await this.repo.findOneBy({ id });
    if (!notification) throw new NotFoundException();
    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.repo.save(notification);
    }
    return notification;
  }

  async markAllRead(): Promise<void> {
    await this.repo.update({ readAt: IsNull() }, { readAt: new Date() });
  }
}
```

- [ ] **Step 4: Run the unit spec to verify it passes**

Run: `pnpm --filter @arayeshgah/api test -- admin-notifications.service`
Expected: PASS (10 tests).

- [ ] **Step 5: Write the failing endpoint e2e**

Seeds two rows with distinct `created_at` values via raw SQL (deterministic newest-first ordering; two back-to-back inserts could land in the same millisecond), then exercises guards, the envelope, the unread filter, and read/read-all idempotency.

```typescript
// apps/api/test/admin-notifications.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin notifications endpoints (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let customerCookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122260001');
    customerCookie = await loginAs(app, '09122260002');

    const ds = app.get(DataSource);
    await ds.query(
      `INSERT INTO admin_notifications (type, title, created_at)
       VALUES ('report_created', 'اعلان قدیمی', now() - interval '1 hour')`,
    );
    await ds.query(
      `INSERT INTO admin_notifications (type, title, body, link)
       VALUES ('salon_resubmitted', 'اعلان جدید', 'متن اعلان', '/salons/abc')`,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated and non-admin callers', async () => {
    await request(app.getHttpServer()).get('/api/admin/notifications').expect(401);
    await request(app.getHttpServer())
      .get('/api/admin/notifications')
      .set('Cookie', customerCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/admin/notifications/unread-count')
      .set('Cookie', customerCookie)
      .expect(403);
  });

  it('lists notifications newest-first in the standard envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/notifications')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(20);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].title).toBe('اعلان جدید');
    expect(res.body.items[0].body).toBe('متن اعلان');
    expect(res.body.items[0].link).toBe('/salons/abc');
    expect(res.body.items[0].readAt).toBeNull();
    expect(res.body.items[1].title).toBe('اعلان قدیمی');
  });

  it('counts unread and supports the unread filter, read, and read-all idempotently', async () => {
    const count1 = await request(app.getHttpServer())
      .get('/api/admin/notifications/unread-count')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(count1.body).toEqual({ count: 2 });

    const unreadList = await request(app.getHttpServer())
      .get('/api/admin/notifications?unread=true')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(unreadList.body.total).toBe(2);
    const newestId = unreadList.body.items[0].id;

    const read = await request(app.getHttpServer())
      .patch(`/api/admin/notifications/${newestId}/read`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(read.body.readAt).not.toBeNull();

    // second read of the same row is a no-op, not an error
    await request(app.getHttpServer())
      .patch(`/api/admin/notifications/${newestId}/read`)
      .set('Cookie', adminCookie)
      .expect(200);

    const count2 = await request(app.getHttpServer())
      .get('/api/admin/notifications/unread-count')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(count2.body).toEqual({ count: 1 });

    const unreadAfter = await request(app.getHttpServer())
      .get('/api/admin/notifications?unread=true')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(unreadAfter.body.total).toBe(1);
    expect(unreadAfter.body.items[0].title).toBe('اعلان قدیمی');

    await request(app.getHttpServer())
      .patch('/api/admin/notifications/00000000-0000-0000-0000-000000000000/read')
      .set('Cookie', adminCookie)
      .expect(404);

    await request(app.getHttpServer())
      .post('/api/admin/notifications/read-all')
      .set('Cookie', adminCookie)
      .expect(201);
    const count3 = await request(app.getHttpServer())
      .get('/api/admin/notifications/unread-count')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(count3.body).toEqual({ count: 0 });

    // read-all with nothing unread is also a no-op
    await request(app.getHttpServer())
      .post('/api/admin/notifications/read-all')
      .set('Cookie', adminCookie)
      .expect(201);
  });
});
```

- [ ] **Step 6: Run the e2e to verify it fails**

Run: `pnpm --filter @arayeshgah/api test:e2e -- admin-notifications`
Expected: FAIL — first test gets 404 instead of 401 (`/api/admin/notifications` route does not exist yet; the guards never run).

- [ ] **Step 7: Write the controller and module, and register the module in AppModule**

The static `unread-count` route is declared before the parameterised `:id/read` route; they don't collide (different depths), but keeping statics first matches the ordering discipline documented in `salons.module.ts`.

```typescript
// apps/api/src/admin-notifications/admin-notifications.controller.ts
import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminNotificationsService } from './admin-notifications.service';
import { AdminNotificationQueryDto } from './dto/admin-notification-query.dto';

@Controller('admin/notifications')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminNotificationsController {
  constructor(private readonly notifications: AdminNotificationsService) {}

  @Get()
  list(@Query() query: AdminNotificationQueryDto) {
    return this.notifications.list(query);
  }

  @Get('unread-count')
  async unreadCount() {
    return { count: await this.notifications.unreadCount() };
  }

  @Patch(':id/read')
  markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(id);
  }

  @Post('read-all')
  async readAll() {
    await this.notifications.markAllRead();
    return { ok: true };
  }
}
```

```typescript
// apps/api/src/admin-notifications/admin-notifications.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AdminNotification } from './admin-notification.entity';
import { AdminNotificationsController } from './admin-notifications.controller';
import { AdminNotificationsService } from './admin-notifications.service';

@Module({
  imports: [TypeOrmModule.forFeature([AdminNotification]), AuthModule],
  controllers: [AdminNotificationsController],
  providers: [AdminNotificationsService],
  exports: [AdminNotificationsService],
})
export class AdminNotificationsModule {}
```

In `apps/api/src/app.module.ts`, add the import (the import block currently runs `AuthModule` … `SearchModule`, lines 5–15):

```typescript
import { AdminNotificationsModule } from './admin-notifications/admin-notifications.module';
import { AuthModule } from './auth/auth.module';
```

and register it in the `imports` array (currently ends `FavoritesModule, PushModule,` at lines 45–46):

```typescript
    ReviewsModule,
    FavoritesModule,
    PushModule,
    AdminNotificationsModule,
```

- [ ] **Step 8: Run both suites to verify they pass**

Run: `pnpm --filter @arayeshgah/api test -- admin-notifications.service`
Expected: PASS (10 tests).

Run: `pnpm --filter @arayeshgah/api test:e2e -- admin-notifications`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/admin-notifications apps/api/src/app.module.ts apps/api/test/admin-notifications.e2e-spec.ts
git commit -m "feat(api): admin notifications module with polled queue endpoints"
```

---

### Task 9: `salon_resubmitted` emit hook in `SalonsService.resubmitMine`

**Files:**
- Modify: `apps/api/src/salons/salons.service.ts` (imports/constructor lines 1–14, `resubmitMine` lines 53–74)
- Modify: `apps/api/src/salons/salons.module.ts` (imports array, lines 20–25)
- Test: `apps/api/src/salons/salons.service.spec.ts` (extend the existing spec — its provider list must gain the new mock or the whole file stops compiling the moment the constructor grows)
- Test: `apps/api/test/salon-resubmit.e2e-spec.ts` (append one test after line 115)

Spec §3.6: after `resubmitMine`'s conditional update succeeds, emit `salon_resubmitted` so admins learn a rejected salon is back in the review queue. The emit is fire-safe — `AdminNotificationsService.emit` throws on failure (Task 8 contract), so this caller wraps it in try/catch and `logger.error`s: a notification failure must never fail the owner's resubmission. The 400 (not rejected) and 409 (lost race) paths must not emit.

- [ ] **Step 1: Write the failing unit spec**

Replace the full contents of `apps/api/src/salons/salons.service.spec.ts` (the existing file has one `updateMine` test, which is kept — regrouped under a nested `describe`):

```typescript
// apps/api/src/salons/salons.service.spec.ts
import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { UsersService } from '../users/users.service';
import { Salon } from './salon.entity';
import { SalonsService } from './salons.service';

describe('SalonsService', () => {
  let service: SalonsService;
  let repo: { findOneBy: jest.Mock; save: jest.Mock; update: jest.Mock };
  let notifications: { emit: jest.Mock };

  beforeEach(async () => {
    repo = { findOneBy: jest.fn(), save: jest.fn((s) => s), update: jest.fn() };
    notifications = { emit: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        SalonsService,
        { provide: getRepositoryToken(Salon), useValue: repo },
        { provide: UsersService, useValue: {} },
        { provide: AdminNotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(SalonsService);
  });

  describe('updateMine', () => {
    it('applies a genderTarget change', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', ownerId: 'u1', genderTarget: 'women' } as Salon);
      const result = await service.updateMine('u1', { genderTarget: 'men' });
      expect(result.genderTarget).toBe('men');
    });
  });

  describe('resubmitMine notification hook', () => {
    const rejected = { id: 's1', ownerId: 'u1', name: 'سالن نمونه', status: 'rejected' } as Salon;
    const pending = {
      id: 's1',
      ownerId: 'u1',
      name: 'سالن نمونه',
      status: 'pending',
      rejectionReason: null,
    } as Salon;

    it('emits salon_resubmitted after a successful resubmit', async () => {
      // resubmitMine reads the salon twice: once before the conditional update,
      // once after it to return the fresh row.
      repo.findOneBy.mockResolvedValueOnce(rejected).mockResolvedValueOnce(pending);
      repo.update.mockResolvedValue({ affected: 1 });

      const result = await service.resubmitMine('u1');

      expect(result.status).toBe('pending');
      expect(notifications.emit).toHaveBeenCalledTimes(1);
      expect(notifications.emit).toHaveBeenCalledWith(
        'salon_resubmitted',
        'سالن «سالن نمونه» دوباره برای بررسی ارسال شد',
        'مالک سالن پس از رد شدن، اطلاعات را ویرایش و درخواست بررسی مجدد ثبت کرده است.',
        '/salons/s1',
      );
    });

    it('does not emit when the conditional update loses the race (409)', async () => {
      repo.findOneBy.mockResolvedValueOnce(rejected);
      repo.update.mockResolvedValue({ affected: 0 });

      await expect(service.resubmitMine('u1')).rejects.toBeInstanceOf(ConflictException);
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('swallows an emit failure — the resubmission still succeeds', async () => {
      repo.findOneBy.mockResolvedValueOnce(rejected).mockResolvedValueOnce(pending);
      repo.update.mockResolvedValue({ affected: 1 });
      notifications.emit.mockRejectedValueOnce(new Error('notification insert failed'));

      const result = await service.resubmitMine('u1');
      expect(result.status).toBe('pending');
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @arayeshgah/api test -- salons.service`
Expected: FAIL — "emits salon_resubmitted after a successful resubmit" fails with `expect(notifications.emit).toHaveBeenCalledTimes(1)` receiving 0 calls (the extra `AdminNotificationsService` provider is simply unused by the current constructor, so the other tests still pass).

- [ ] **Step 3: Write the failing e2e assertion**

Append this test to `apps/api/test/salon-resubmit.e2e-spec.ts`, after the closing `});` of the `returns 409 when a concurrent admin action...` test (line 115), inside the top-level `describe`. Placement matters: Jest runs the `it`s in order, so by this point exactly one resubmit has succeeded (the "flips a rejected salon back to pending" test) and the 400/409 paths have run without emitting — the queue must hold exactly one notification.

```typescript
  it('created an admin notification for the one successful resubmit, visible via the admin endpoints', async () => {
    const countRes = await request(app.getHttpServer())
      .get('/api/admin/notifications/unread-count')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(countRes.body).toEqual({ count: 1 });

    const listRes = await request(app.getHttpServer())
      .get('/api/admin/notifications?unread=true')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(listRes.body.total).toBe(1);
    const item = listRes.body.items[0];
    expect(item.type).toBe('salon_resubmitted');
    expect(item.title).toBe('سالن «Resubmit Test Salon» دوباره برای بررسی ارسال شد');
    expect(item.link).toBe(`/salons/${salonId}`);

    await request(app.getHttpServer())
      .patch(`/api/admin/notifications/${item.id}/read`)
      .set('Cookie', adminCookie)
      .expect(200);
    const afterRead = await request(app.getHttpServer())
      .get('/api/admin/notifications/unread-count')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(afterRead.body).toEqual({ count: 0 });
  });
```

- [ ] **Step 4: Run the e2e to verify it fails**

Run: `pnpm --filter @arayeshgah/api test:e2e -- salon-resubmit`
Expected: FAIL — the new test's first assertion gets `{ count: 0 }` instead of `{ count: 1 }` (nothing emits yet). The four pre-existing tests still pass.

- [ ] **Step 5: Write the implementation**

Replace the full contents of `apps/api/src/salons/salons.service.ts` (changes relative to current file: `Logger` added to the `@nestjs/common` import, the `AdminNotificationsService` import and constructor parameter, the `logger` field, and the emit block inside `resubmitMine` — every other method is unchanged):

```typescript
// apps/api/src/salons/salons.service.ts
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { UsersService } from '../users/users.service';
import { CreateSalonDto, UpdateSalonDto } from './dto/salon.dto';
import { Salon } from './salon.entity';
import { makeSlug } from './slug.util';

@Injectable()
export class SalonsService {
  private readonly logger = new Logger(SalonsService.name);

  constructor(
    @InjectRepository(Salon) private readonly repo: Repository<Salon>,
    private readonly users: UsersService,
    private readonly adminNotifications: AdminNotificationsService,
  ) {}

  async createForOwner(ownerId: string, dto: CreateSalonDto): Promise<Salon> {
    const existing = await this.repo.findOneBy({ ownerId });
    if (existing) throw new ConflictException('You already have a salon');

    const salon = await this.repo.save(
      this.repo.create({
        ownerId,
        name: dto.name,
        slug: makeSlug(dto.name),
        description: dto.description ?? null,
        genderTarget: dto.genderTarget,
        address: dto.address,
        city: dto.city,
        capacity: dto.capacity ?? 1,
        location: { type: 'Point', coordinates: [dto.lng, dto.lat] },
      }),
    );
    await this.users.promoteToProvider(ownerId);
    return salon;
  }

  async findMine(ownerId: string): Promise<Salon> {
    const salon = await this.repo.findOneBy({ ownerId });
    if (!salon) throw new NotFoundException('No salon for this account');
    return salon;
  }

  async updateMine(ownerId: string, dto: UpdateSalonDto): Promise<Salon> {
    const salon = await this.findMine(ownerId);
    const { lat, lng, ...rest } = dto;
    Object.assign(salon, rest);
    if (lat !== undefined && lng !== undefined) {
      salon.location = { type: 'Point', coordinates: [lng, lat] };
    }
    return this.repo.save(salon);
  }

  async resubmitMine(ownerId: string): Promise<Salon> {
    const salon = await this.repo.findOneBy({ ownerId });
    if (!salon) throw new NotFoundException('Salon not found');
    if (salon.status !== 'rejected') {
      throw new BadRequestException('Only a rejected salon can be resubmitted');
    }
    // Guard against a concurrent admin action (approve or re-reject) on the same
    // salon landing between the read above and this write -- without conditioning
    // on the status still being 'rejected', an unconditional update({id}, ...) would
    // silently clobber whatever the admin just set, with no error to either caller.
    // Conditioning the update on the previously-read status (the same pattern used
    // by BookingsService's cancel()/updateStatus()) means only the winner's write
    // lands; a losing concurrent call gets a clear 409 instead of a misleading 200.
    const result = await this.repo.update(
      { id: salon.id, status: 'rejected' },
      { status: 'pending', rejectionReason: null },
    );
    if (!result.affected) {
      throw new ConflictException('Salon status changed before this resubmission could be applied');
    }
    const updated = (await this.repo.findOneBy({ id: salon.id }))!;

    // Tell admins a rejected salon is back in the review queue (spec 3.6). This is
    // a fire-safe side effect: emit() throws on failure by contract, but a lost
    // notification must never fail the owner's resubmission, so it is logged and
    // swallowed here.
    try {
      await this.adminNotifications.emit(
        'salon_resubmitted',
        `سالن «${updated.name}» دوباره برای بررسی ارسال شد`,
        'مالک سالن پس از رد شدن، اطلاعات را ویرایش و درخواست بررسی مجدد ثبت کرده است.',
        `/salons/${updated.id}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to emit salon_resubmitted notification for salon ${updated.id}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    return updated;
  }

  async findPublicBySlug(slug: string): Promise<Salon> {
    const salon = await this.repo.findOneBy({ slug, status: 'approved' });
    if (!salon) throw new NotFoundException();
    return salon;
  }

  findById(id: string): Promise<Salon | null> {
    return this.repo.findOneBy({ id });
  }
}
```

In `apps/api/src/salons/salons.module.ts`, add the module import next to the existing ones (line 3 area):

```typescript
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module';
import { AuthModule } from '../auth/auth.module';
```

and extend the `imports` array. **Careful:** by this point Task 5 has already added `AuditModule` to this array — keep it. The result must contain everything already there plus `AdminNotificationsModule`:

```typescript
  imports: [
    TypeOrmModule.forFeature([Salon, SalonService, WorkingHour, ScheduleException, SalonPhoto]),
    AuthModule,
    StorageModule,
    AuditModule,
    AdminNotificationsModule,
  ],
```

(No cycle: `AdminNotificationsModule` imports only `TypeOrmModule` and `AuthModule`, neither of which imports `SalonsModule`.)

- [ ] **Step 6: Run the unit spec to verify it passes**

Run: `pnpm --filter @arayeshgah/api test -- salons.service`
Expected: PASS (4 tests).

- [ ] **Step 7: Run the e2e to verify it passes**

Run: `pnpm --filter @arayeshgah/api test:e2e -- salon-resubmit`
Expected: PASS (5 tests) — including the pre-existing 400/409/401 tests, which confirm those paths still don't emit (the new test's `count: 1` assertion would fail otherwise).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/salons/salons.service.ts apps/api/src/salons/salons.service.spec.ts apps/api/src/salons/salons.module.ts apps/api/test/salon-resubmit.e2e-spec.ts
git commit -m "feat(api): emit salon_resubmitted admin notification on resubmit"
```

### Task 10: ReportsModule — entity, DTOs, service (create + eligibility), customer controller

**Files:**
- Create: `apps/api/src/reports/report.entity.ts`
- Create: `apps/api/src/reports/dto/report.dto.ts`
- Create: `apps/api/src/reports/reports.service.ts`
- Create: `apps/api/src/reports/reports.controller.ts`
- Create: `apps/api/src/reports/reports.module.ts`
- Test: `apps/api/src/reports/reports.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` (import block ~line 12, `imports` array ~line 44)

The `reports` table already exists (Task 1's `1752500000000-platform-hardening.ts` migration). This task adds the customer-facing vertical slice: `POST /api/reports` (report a salon or one of its reviews, verified-customer-only) and `GET /api/reports/eligibility?salonId=` → `{ canReport }`.

Eligibility rule from the spec: the caller must have **at least one booking with `status='completed'` at that salon**. `Booking` (`apps/api/src/booking/booking.entity.ts`) exposes `userId` / `salonId` / `status: BookingStatus` where `'completed'` is one of the literal statuses, and `ReviewsService.create()` already queries bookings the same way (`this.bookings.findOneBy({ id, userId })` then checks `booking.status !== 'completed'`) — we use `countBy({ userId, salonId, status: 'completed' })` on the same repository.

The insert runs inside `dataSource.transaction` from day one (mirroring `ReviewsService.create()`); Task 12 will add the admin-notification emit into that same transaction. The partial unique index `reports_open_target_uidx` (one **open** report per reporter per target) is the source of truth for duplicates — translate 23505 via the existing `isUniqueViolation` helper into a 409, exactly like `ReviewsService.create()` does.

- [ ] **Step 1: Write the failing unit spec**

```typescript
// apps/api/src/reports/reports.service.spec.ts
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, QueryFailedError } from 'typeorm';
import { Booking } from '../booking/booking.entity';
import { Review } from '../reviews/review.entity';
import { CreateReportDto } from './dto/report.dto';
import { Report } from './report.entity';
import { ReportsService } from './reports.service';

interface Mocks {
  reportsRepo: Record<string, jest.Mock>;
  reviewsRepo: { findOneBy: jest.Mock };
  bookingsRepo: { countBy: jest.Mock };
  em: { create: jest.Mock; save: jest.Mock };
  transaction: jest.Mock;
}

async function setup(): Promise<{ service: ReportsService; mocks: Mocks }> {
  const em = {
    create: jest.fn((_entity: unknown, values: Record<string, unknown>) => values),
    save: jest.fn(async (_entity: unknown, values: Record<string, unknown>) => ({
      id: 'report-1',
      createdAt: new Date(),
      ...values,
    })),
  };
  const mocks: Mocks = {
    reportsRepo: {},
    reviewsRepo: { findOneBy: jest.fn() },
    bookingsRepo: { countBy: jest.fn() },
    em,
    transaction: jest.fn(async (cb: (em: unknown) => Promise<unknown>) => cb(em)),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ReportsService,
      { provide: getRepositoryToken(Report), useValue: mocks.reportsRepo },
      { provide: getRepositoryToken(Review), useValue: mocks.reviewsRepo },
      { provide: getRepositoryToken(Booking), useValue: mocks.bookingsRepo },
      { provide: DataSource, useValue: { transaction: mocks.transaction } },
    ],
  }).compile();

  return { service: moduleRef.get(ReportsService), mocks };
}

describe('ReportsService.canReport', () => {
  it('is true when the caller has at least one completed booking at the salon', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(1);

    await expect(service.canReport('user-1', 'salon-1')).resolves.toBe(true);
    expect(mocks.bookingsRepo.countBy).toHaveBeenCalledWith({
      userId: 'user-1',
      salonId: 'salon-1',
      status: 'completed',
    });
  });

  it('is false when the caller has no completed booking there', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(0);

    await expect(service.canReport('user-1', 'salon-1')).resolves.toBe(false);
  });
});

describe('ReportsService.create', () => {
  it('creates an open salon-targeted report for an eligible customer', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(2);

    const report = await service.create('user-1', { salonId: 'salon-1', reason: 'سالن تمیز نبود و رزرو رعایت نشد' });

    expect(report.id).toBe('report-1');
    expect(mocks.em.save).toHaveBeenCalledWith(Report, {
      reporterId: 'user-1',
      salonId: 'salon-1',
      reviewId: null,
      reason: 'سالن تمیز نبود و رزرو رعایت نشد',
      status: 'open',
    });
  });

  it('derives the salon from the review when reviewId is the target', async () => {
    const { service, mocks } = await setup();
    mocks.reviewsRepo.findOneBy.mockResolvedValue({ id: 'review-9', salonId: 'salon-9' });
    mocks.bookingsRepo.countBy.mockResolvedValue(1);

    await service.create('user-1', { reviewId: 'review-9', reason: 'این دیدگاه توهین‌آمیز است' });

    expect(mocks.bookingsRepo.countBy).toHaveBeenCalledWith({
      userId: 'user-1',
      salonId: 'salon-9',
      status: 'completed',
    });
    expect(mocks.em.save).toHaveBeenCalledWith(
      Report,
      expect.objectContaining({ salonId: 'salon-9', reviewId: 'review-9' }),
    );
  });

  it('404s when the reported review does not exist', async () => {
    const { service, mocks } = await setup();
    mocks.reviewsRepo.findOneBy.mockResolvedValue(null);

    await expect(service.create('user-1', { reviewId: 'review-9', reason: 'این دیدگاه توهین‌آمیز است' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('403s an ineligible reporter with the Farsi eligibility message', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(0);

    await expect(service.create('user-1', { salonId: 'salon-1', reason: 'اطلاعات سالن نادرست است' })).rejects.toMatchObject({
      constructor: ForbiddenException,
      message: 'فقط مشتریانی که نوبت تکمیل‌شده در این سالن داشته‌اند می‌توانند گزارش ثبت کنند',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('400s when both salonId and reviewId are provided', async () => {
    const { service, mocks } = await setup();

    await expect(
      service.create('user-1', { salonId: 'salon-1', reviewId: 'review-9', reason: 'هر دو هدف با هم' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('400s when neither salonId nor reviewId is provided', async () => {
    const { service, mocks } = await setup();

    await expect(service.create('user-1', { reason: 'بدون هدف مشخص' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('translates the partial-unique-index violation into a Farsi 409', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(1);
    const dup = new QueryFailedError('INSERT', [], new Error('duplicate key'));
    Object.assign(dup, { code: '23505' });
    mocks.em.save.mockRejectedValue(dup);

    await expect(service.create('user-1', { salonId: 'salon-1', reason: 'گزارش تکراری برای همین سالن' })).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'گزارش قبلی شما هنوز در حال بررسی است',
    });
  });

  it('rethrows non-unique-violation errors untouched', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(1);
    mocks.em.save.mockRejectedValue(new Error('connection reset'));

    await expect(service.create('user-1', { salonId: 'salon-1', reason: 'اطلاعات سالن نادرست است' })).rejects.toThrow(
      'connection reset',
    );
  });
});

describe('CreateReportDto', () => {
  it('fails validation when neither target is provided', async () => {
    const dto = plainToInstance(CreateReportDto, { reason: 'اطلاعات سالن نادرست است' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(expect.arrayContaining(['salonId', 'reviewId']));
  });

  it('passes with only a salonId', async () => {
    const dto = plainToInstance(CreateReportDto, {
      salonId: '2c4b8f9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
      reason: 'اطلاعات سالن نادرست است',
    });
    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('passes with only a reviewId', async () => {
    const dto = plainToInstance(CreateReportDto, {
      reviewId: '2c4b8f9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
      reason: 'این دیدگاه توهین‌آمیز است',
    });
    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('fails on a reason shorter than 5 characters', async () => {
    const dto = plainToInstance(CreateReportDto, {
      salonId: '2c4b8f9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
      reason: 'کوتاه',  // 5 chars — boundary passes; test the real failure below
    });
    const short = plainToInstance(CreateReportDto, {
      salonId: '2c4b8f9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
      reason: 'بد',
    });
    await expect(validate(dto)).resolves.toEqual([]);
    const errors = await validate(short);
    expect(errors.map((e) => e.property)).toContain('reason');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from repo root): `pnpm --filter @arayeshgah/api test -- reports.service`
Expected: FAIL with `Cannot find module './reports.service'` (and `./report.entity` / `./dto/report.dto`).

- [ ] **Step 3: Write the entity, DTOs, and service**

```typescript
// apps/api/src/reports/report.entity.ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ReportStatus = 'open' | 'resolved' | 'dismissed';

@Entity('reports')
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'reporter_id' })
  reporterId: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ name: 'review_id', type: 'uuid', nullable: true })
  reviewId: string | null;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'varchar', default: 'open' })
  status: ReportStatus;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote: string | null;

  @Column({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

```typescript
// apps/api/src/reports/dto/report.dto.ts
import { IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class CreateReportDto {
  // Exactly one of salonId/reviewId identifies the target. Each is required (and must
  // be a UUID) whenever the other is absent — so "neither" fails validation on both
  // properties here. The "both provided" case skips both @ValidateIf branches and is
  // rejected in ReportsService.create() with a 400 instead.
  @ValidateIf((o: CreateReportDto) => o.reviewId === undefined)
  @IsUUID()
  salonId?: string;

  @ValidateIf((o: CreateReportDto) => o.salonId === undefined)
  @IsUUID()
  reviewId?: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class ReportEligibilityQueryDto {
  @IsUUID()
  salonId: string;
}
```

```typescript
// apps/api/src/reports/reports.service.ts
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Booking } from '../booking/booking.entity';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { Review } from '../reviews/review.entity';
import { CreateReportDto } from './dto/report.dto';
import { Report } from './report.entity';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly dataSource: DataSource,
  ) {}

  async create(reporterId: string, dto: CreateReportDto): Promise<Report> {
    // The DTO's @ValidateIf pair guarantees "at least one" target; "exactly one" is
    // completed here (both-provided skips both DTO branches by design).
    if ((dto.salonId ? 1 : 0) + (dto.reviewId ? 1 : 0) !== 1) {
      throw new BadRequestException('دقیقاً یکی از سالن یا دیدگاه باید به‌عنوان هدف گزارش مشخص شود');
    }

    let salonId = dto.salonId ?? null;
    const reviewId = dto.reviewId ?? null;
    if (reviewId) {
      const review = await this.reviews.findOneBy({ id: reviewId });
      if (!review) throw new NotFoundException('Review not found');
      salonId = review.salonId;
    }

    if (!(await this.canReport(reporterId, salonId!))) {
      throw new ForbiddenException('فقط مشتریانی که نوبت تکمیل‌شده در این سالن داشته‌اند می‌توانند گزارش ثبت کنند');
    }

    try {
      // A transaction for a single insert today — Task 12 adds the report_created
      // admin-notification emit into this same transaction, per the design spec §3.3.
      return await this.dataSource.transaction(async (em) => {
        return em.save(
          Report,
          em.create(Report, {
            reporterId,
            salonId: salonId!,
            reviewId,
            reason: dto.reason,
            status: 'open',
          }),
        );
      });
    } catch (err) {
      // The partial unique index reports_open_target_uidx (one OPEN report per reporter
      // per target) is the duplicate check's source of truth — same 23505-translation
      // idiom as ReviewsService.create().
      if (isUniqueViolation(err)) {
        throw new ConflictException('گزارش قبلی شما هنوز در حال بررسی است');
      }
      throw err;
    }
  }

  async canReport(userId: string, salonId: string): Promise<boolean> {
    const completed = await this.bookings.countBy({ userId, salonId, status: 'completed' });
    return completed > 0;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test -- reports.service`
Expected: PASS (14 tests).

- [ ] **Step 5: Wire the controller, module, and app registration**

```typescript
// apps/api/src/reports/reports.controller.ts
import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import { CreateReportDto, ReportEligibilityQueryDto } from './dto/report.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateReportDto) {
    return this.reports.create((req.user as User).id, dto);
  }

  @Get('eligibility')
  async eligibility(@Req() req: Request, @Query() query: ReportEligibilityQueryDto) {
    return { canReport: await this.reports.canReport((req.user as User).id, query.salonId) };
  }
}
```

```typescript
// apps/api/src/reports/reports.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Booking } from '../booking/booking.entity';
import { Review } from '../reviews/review.entity';
import { Report } from './report.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [TypeOrmModule.forFeature([Report, Review, Booking]), AuthModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
```

In `apps/api/src/app.module.ts`, add the import (alphabetically, between `RedisModule` and `ReviewsModule`):

```typescript
import { RedisModule } from './redis/redis.module';
import { ReportsModule } from './reports/reports.module';
import { ReviewsModule } from './reviews/reviews.module';
```

and register it in the `imports` array right after `ReviewsModule`:

```typescript
    SearchModule,
    ReviewsModule,
    ReportsModule,
    FavoritesModule,
    PushModule,
```

- [ ] **Step 6: Run the full unit suite to verify nothing regressed**

Run: `pnpm --filter @arayeshgah/api test`
Expected: PASS (all suites, including the new `reports.service.spec.ts`).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/reports apps/api/src/app.module.ts
git commit -m "feat(api): customer report filing with completed-booking eligibility gate"
```

---

### Task 11: Admin reports queue — list with joins + audited resolve/dismiss

**Files:**
- Create: `apps/api/src/reports/admin-reports.controller.ts`
- Modify: `apps/api/src/reports/dto/report.dto.ts` (append two DTOs at the end, after `ReportEligibilityQueryDto`)
- Modify: `apps/api/src/reports/reports.service.ts` (imports at top; append `listForAdmin` and `resolve` after `canReport`)
- Modify: `apps/api/src/reports/reports.module.ts` (add `AuditModule` import + `AdminReportsController`)
- Test: `apps/api/src/reports/reports.service.spec.ts` (extend `setup()`; append two `describe` blocks)

Adds `GET /api/admin/reports` (standard `{items, total, page, pageSize}` envelope, default `status=open`, each item joined with salon name/slug, reporter phone, and the reported review's rating/comment when `review_id` is set) and `PATCH /api/admin/reports/:id` (`resolved`/`dismissed` + optional note; conditional `WHERE status='open'` update → 409 on a lost race, same pattern as `SalonsService.resubmitMine()`; stamps `resolved_by`/`resolved_at`).

The PATCH is audited via Task 4's machinery: `@UseInterceptors(AuditInterceptor)` on the controller + `@AuditAction('report.resolve', 'report')` on the handler (the GET carries no metadata, so the interceptor passes through). `ReportsModule` gains an `AuditModule` import so the interceptor's `AuditService` dependency resolves.

Entities have no relation decorators in this repo, so the list joins use `leftJoin(EntityClass, alias, condition)` with raw per-column aliases and `getRawMany()` — the first raw-join list in the codebase, but the envelope and filter shape mirror `AdminSalonsController.list()` exactly (including the `'all'` status escape hatch).

- [ ] **Step 1: Extend the spec — update `setup()` and append the failing describes**

In `apps/api/src/reports/reports.service.spec.ts`, replace the `Mocks` interface and `setup()` function (written in Task 10) with this version — the only changes are the fully-stubbed `reportsRepo` and the new `qb` mock:

```typescript
interface QueryBuilderMock {
  leftJoin: jest.Mock;
  select: jest.Mock;
  addSelect: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  offset: jest.Mock;
  limit: jest.Mock;
  getRawMany: jest.Mock;
}

interface Mocks {
  reportsRepo: {
    findOneBy: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  reviewsRepo: { findOneBy: jest.Mock };
  bookingsRepo: { countBy: jest.Mock };
  em: { create: jest.Mock; save: jest.Mock };
  transaction: jest.Mock;
  qb: QueryBuilderMock;
}

async function setup(): Promise<{ service: ReportsService; mocks: Mocks }> {
  const em = {
    create: jest.fn((_entity: unknown, values: Record<string, unknown>) => values),
    save: jest.fn(async (_entity: unknown, values: Record<string, unknown>) => ({
      id: 'report-1',
      createdAt: new Date(),
      ...values,
    })),
  };
  const qb = {} as QueryBuilderMock;
  for (const method of ['leftJoin', 'select', 'addSelect', 'andWhere', 'orderBy', 'offset', 'limit'] as const) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getRawMany = jest.fn().mockResolvedValue([]);

  const mocks: Mocks = {
    reportsRepo: {
      findOneBy: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    },
    reviewsRepo: { findOneBy: jest.fn() },
    bookingsRepo: { countBy: jest.fn() },
    em,
    transaction: jest.fn(async (cb: (em: unknown) => Promise<unknown>) => cb(em)),
    qb,
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ReportsService,
      { provide: getRepositoryToken(Report), useValue: mocks.reportsRepo },
      { provide: getRepositoryToken(Review), useValue: mocks.reviewsRepo },
      { provide: getRepositoryToken(Booking), useValue: mocks.bookingsRepo },
      { provide: DataSource, useValue: { transaction: mocks.transaction } },
    ],
  }).compile();

  return { service: moduleRef.get(ReportsService), mocks };
}
```

Then append these two `describe` blocks at the end of the file:

```typescript
describe('ReportsService.listForAdmin', () => {
  it('defaults to the open queue with the standard envelope', async () => {
    const { service, mocks } = await setup();
    mocks.qb.getRawMany.mockResolvedValue([{ id: 'report-1', salonName: 'Salon A' }]);
    mocks.reportsRepo.count.mockResolvedValue(1);

    const result = await service.listForAdmin({});

    expect(result).toEqual({ items: [{ id: 'report-1', salonName: 'Salon A' }], total: 1, page: 1, pageSize: 20 });
    expect(mocks.qb.andWhere).toHaveBeenCalledWith('report.status = :status', { status: 'open' });
    expect(mocks.reportsRepo.count).toHaveBeenCalledWith({ where: { status: 'open' } });
    expect(mocks.qb.offset).toHaveBeenCalledWith(0);
    expect(mocks.qb.limit).toHaveBeenCalledWith(20);
  });

  it('skips the status filter for status=all and applies the salon filter', async () => {
    const { service, mocks } = await setup();

    await service.listForAdmin({ status: 'all', salonId: 'salon-1', page: 2, pageSize: 10 });

    expect(mocks.qb.andWhere).not.toHaveBeenCalledWith('report.status = :status', expect.anything());
    expect(mocks.qb.andWhere).toHaveBeenCalledWith('report.salonId = :salonId', { salonId: 'salon-1' });
    expect(mocks.reportsRepo.count).toHaveBeenCalledWith({ where: { salonId: 'salon-1' } });
    expect(mocks.qb.offset).toHaveBeenCalledWith(10);
    expect(mocks.qb.limit).toHaveBeenCalledWith(10);
  });
});

describe('ReportsService.resolve', () => {
  it('stamps resolver, note, and time via a conditional update on the open status', async () => {
    const { service, mocks } = await setup();
    mocks.reportsRepo.findOneBy
      .mockResolvedValueOnce({ id: 'report-1', status: 'open' })
      .mockResolvedValueOnce({ id: 'report-1', status: 'resolved', resolvedBy: 'admin-1' });
    mocks.reportsRepo.update.mockResolvedValue({ affected: 1 });

    const result = await service.resolve('admin-1', 'report-1', { status: 'resolved', note: 'بررسی شد' });

    expect(mocks.reportsRepo.update).toHaveBeenCalledWith(
      { id: 'report-1', status: 'open' },
      expect.objectContaining({
        status: 'resolved',
        resolutionNote: 'بررسی شد',
        resolvedBy: 'admin-1',
        resolvedAt: expect.any(Date),
      }),
    );
    expect(result.status).toBe('resolved');
  });

  it('stores a null note when none is given', async () => {
    const { service, mocks } = await setup();
    mocks.reportsRepo.findOneBy
      .mockResolvedValueOnce({ id: 'report-1', status: 'open' })
      .mockResolvedValueOnce({ id: 'report-1', status: 'dismissed' });
    mocks.reportsRepo.update.mockResolvedValue({ affected: 1 });

    await service.resolve('admin-1', 'report-1', { status: 'dismissed' });

    expect(mocks.reportsRepo.update).toHaveBeenCalledWith(
      { id: 'report-1', status: 'open' },
      expect.objectContaining({ resolutionNote: null }),
    );
  });

  it('404s when the report does not exist', async () => {
    const { service, mocks } = await setup();
    mocks.reportsRepo.findOneBy.mockResolvedValue(null);

    await expect(service.resolve('admin-1', 'missing', { status: 'resolved' })).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.reportsRepo.update).not.toHaveBeenCalled();
  });

  it('409s when a concurrent admin already closed the report', async () => {
    const { service, mocks } = await setup();
    mocks.reportsRepo.findOneBy.mockResolvedValue({ id: 'report-1', status: 'open' });
    mocks.reportsRepo.update.mockResolvedValue({ affected: 0 });

    await expect(service.resolve('admin-1', 'report-1', { status: 'resolved' })).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'این گزارش قبلاً بررسی شده است',
    });
  });
});
```

- [ ] **Step 2: Run test to verify the new describes fail**

Run: `pnpm --filter @arayeshgah/api test -- reports.service`
Expected: FAIL — the Task 10 tests still pass, the six new tests fail with `service.listForAdmin is not a function` / `service.resolve is not a function`.

- [ ] **Step 3: Implement the DTOs and service methods**

Append to `apps/api/src/reports/dto/report.dto.ts` (after `ReportEligibilityQueryDto`), and extend its import line to `import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';` plus a new `import { Type } from 'class-transformer';` at the top:

```typescript
export class AdminReportQueryDto {
  @IsOptional()
  @IsIn(['open', 'resolved', 'dismissed', 'all'])
  status?: 'open' | 'resolved' | 'dismissed' | 'all';

  @IsOptional()
  @IsUUID()
  salonId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ResolveReportDto {
  @IsIn(['resolved', 'dismissed'])
  status: 'resolved' | 'dismissed';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  note?: string;
}
```

In `apps/api/src/reports/reports.service.ts`, update the top of the file:

```typescript
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { Booking } from '../booking/booking.entity';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { Review } from '../reviews/review.entity';
import { Salon } from '../salons/salon.entity';
import { User } from '../users/user.entity';
import { AdminReportQueryDto, CreateReportDto, ResolveReportDto } from './dto/report.dto';
import { Report, ReportStatus } from './report.entity';

export interface AdminReportListItem {
  id: string;
  reporterId: string;
  salonId: string;
  reviewId: string | null;
  reason: string;
  status: ReportStatus;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  salonName: string;
  salonSlug: string;
  reporterPhone: string;
  reviewRating: number | null;
  reviewComment: string | null;
}
```

and append these two methods to `ReportsService`, after `canReport()`:

```typescript
  async listForAdmin(query: AdminReportQueryDto): Promise<{
    items: AdminReportListItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const status = query.status ?? 'open';
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    // No relation decorators anywhere in this repo (FKs live only in the migration SQL),
    // so context columns come from explicit entity-class joins + raw per-column aliases.
    const qb = this.reports
      .createQueryBuilder('report')
      .leftJoin(Salon, 'salon', 'salon.id = report.salonId')
      .leftJoin(User, 'reporter', 'reporter.id = report.reporterId')
      .leftJoin(Review, 'review', 'review.id = report.reviewId')
      .select('report.id', 'id')
      .addSelect('report.reporterId', 'reporterId')
      .addSelect('report.salonId', 'salonId')
      .addSelect('report.reviewId', 'reviewId')
      .addSelect('report.reason', 'reason')
      .addSelect('report.status', 'status')
      .addSelect('report.resolutionNote', 'resolutionNote')
      .addSelect('report.resolvedBy', 'resolvedBy')
      .addSelect('report.resolvedAt', 'resolvedAt')
      .addSelect('report.createdAt', 'createdAt')
      .addSelect('salon.name', 'salonName')
      .addSelect('salon.slug', 'salonSlug')
      .addSelect('reporter.phone', 'reporterPhone')
      .addSelect('review.rating', 'reviewRating')
      .addSelect('review.comment', 'reviewComment')
      .orderBy('report.createdAt', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize);

    if (status !== 'all') qb.andWhere('report.status = :status', { status });
    if (query.salonId) qb.andWhere('report.salonId = :salonId', { salonId: query.salonId });

    const countWhere: FindOptionsWhere<Report> = {};
    if (status !== 'all') countWhere.status = status;
    if (query.salonId) countWhere.salonId = query.salonId;

    const [items, total] = await Promise.all([
      qb.getRawMany<AdminReportListItem>(),
      this.reports.count({ where: countWhere }),
    ]);
    return { items, total, page, pageSize };
  }

  async resolve(adminId: string, reportId: string, dto: ResolveReportDto): Promise<Report> {
    const report = await this.reports.findOneBy({ id: reportId });
    if (!report) throw new NotFoundException('Report not found');

    // Conditional update on status='open' — the same lost-race guard as
    // SalonsService.resubmitMine(): a concurrent admin who closed this report first
    // means this write affects 0 rows and the loser gets a clear 409 instead of
    // silently clobbering the winner's resolution.
    const result = await this.reports.update(
      { id: reportId, status: 'open' },
      { status: dto.status, resolutionNote: dto.note ?? null, resolvedBy: adminId, resolvedAt: new Date() },
    );
    if (!result.affected) {
      throw new ConflictException('این گزارش قبلاً بررسی شده است');
    }
    return (await this.reports.findOneBy({ id: reportId }))!;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test -- reports.service`
Expected: PASS (20 tests).

- [ ] **Step 5: Add the admin controller and wire the module**

```typescript
// apps/api/src/reports/admin-reports.controller.ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { User } from '../users/user.entity';
import { AdminReportQueryDto, ResolveReportDto } from './dto/report.dto';
import { ReportsService } from './reports.service';

@Controller('admin/reports')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
@UseInterceptors(AuditInterceptor)
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(@Query() query: AdminReportQueryDto) {
    return this.reports.listForAdmin(query);
  }

  @Patch(':id')
  @AuditAction('report.resolve', 'report')
  resolve(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveReportDto) {
    return this.reports.resolve((req.user as User).id, id, dto);
  }
}
```

Replace `apps/api/src/reports/reports.module.ts` with:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { Booking } from '../booking/booking.entity';
import { Review } from '../reviews/review.entity';
import { AdminReportsController } from './admin-reports.controller';
import { Report } from './report.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [TypeOrmModule.forFeature([Report, Review, Booking]), AuthModule, AuditModule],
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
```

- [ ] **Step 6: Run the full unit suite**

Run: `pnpm --filter @arayeshgah/api test`
Expected: PASS (all suites).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/reports
git commit -m "feat(api): admin reports queue with audited resolve/dismiss"
```

---

### Task 12: Emit the `report_created` admin notification inside the report transaction

**Files:**
- Modify: `apps/api/src/reports/reports.service.ts` (imports + constructor at top; `create()` transaction body)
- Modify: `apps/api/src/reports/reports.module.ts` (add `AdminNotificationsModule` to `imports`)
- Test: `apps/api/src/reports/reports.service.spec.ts` (extend `setup()`; append one `describe`)

Per spec §3.3, report creation emits an `admin_notifications` row (`type='report_created'`, `link='/reports'`) **in the same transaction as the report insert** — Task 8's `AdminNotificationsService.emit(type, title, body, link, manager?)` writes through the provided `EntityManager` when one is passed, and throws on failure. Passing the transaction's manager means a failed notification insert rolls the report back too (and, symmetrically, a duplicate-report rollback never leaves a stray notification — the e2e in Task 13 asserts exactly that). This is deliberately different from the resubmit emit point, which is fire-safe: here the caller is the transaction, so atomicity is the correct contract.

Title/body are Farsi: title «گزارش جدید ثبت شد», body = the report's reason verbatim (DTO-capped at 500 chars, which exactly fits the `body varchar(500)` column).

- [ ] **Step 1: Extend the spec — add the emit mock and the failing describe**

In `apps/api/src/reports/reports.service.spec.ts`, add the import at the top of the file:

```typescript
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
```

In the `Mocks` interface (Task 11 version), add one field after `transaction: jest.Mock;`:

```typescript
  emit: jest.Mock;
```

In `setup()`, add `emit: jest.fn().mockResolvedValue(undefined),` to the `mocks` object literal (after the `transaction:` entry), and add one provider to the `Test.createTestingModule` providers array, after the `DataSource` entry:

```typescript
      { provide: AdminNotificationsService, useValue: { emit: mocks.emit } },
```

Then append this `describe` at the end of the file:

```typescript
describe('ReportsService.create — report_created notification', () => {
  it('emits report_created through the same transaction manager as the insert', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(1);

    await service.create('user-1', { salonId: 'salon-1', reason: 'سالن تمیز نبود و رزرو رعایت نشد' });

    expect(mocks.emit).toHaveBeenCalledWith(
      'report_created',
      'گزارش جدید ثبت شد',
      'سالن تمیز نبود و رزرو رعایت نشد',
      '/reports',
      mocks.em,
    );
  });

  it('propagates an emit failure so the transaction rolls the report back', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(1);
    mocks.emit.mockRejectedValue(new Error('notification insert failed'));

    await expect(service.create('user-1', { salonId: 'salon-1', reason: 'اطلاعات سالن نادرست است' })).rejects.toThrow(
      'notification insert failed',
    );
  });

  it('does not emit when the reporter is ineligible', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(0);

    await expect(service.create('user-1', { salonId: 'salon-1', reason: 'اطلاعات سالن نادرست است' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test -- reports.service`
Expected: FAIL — `emits report_created through the same transaction manager as the insert` fails with `Expected number of calls: >= 1, Received: 0` (the ineligible test passes trivially; the propagation test fails because `create` resolves). Note: the DI provider addition is backward-compatible, so all Task 10/11 tests still pass — until Step 3 adds the constructor dependency, at which point they would fail without this provider; that is why the spec edit lands first.

- [ ] **Step 3: Implement the transactional emit**

In `apps/api/src/reports/reports.service.ts`, add the import (alphabetically, before `../booking/booking.entity`):

```typescript
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
```

Extend the constructor with the service as its last parameter:

```typescript
  constructor(
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly dataSource: DataSource,
    private readonly adminNotifications: AdminNotificationsService,
  ) {}
```

and replace the `try` block inside `create()` with:

```typescript
    try {
      // Insert + notification are atomic: emit() writes through this transaction's
      // manager (spec §3.3), so a duplicate-report rollback never leaves a stray
      // notification, and a failed notification insert rolls the report back. This is
      // intentionally NOT the fire-safe pattern used for salon_resubmitted — here the
      // transaction boundary is the contract.
      return await this.dataSource.transaction(async (em) => {
        const report = await em.save(
          Report,
          em.create(Report, {
            reporterId,
            salonId: salonId!,
            reviewId,
            reason: dto.reason,
            status: 'open',
          }),
        );
        await this.adminNotifications.emit('report_created', 'گزارش جدید ثبت شد', dto.reason, '/reports', em);
        return report;
      });
    } catch (err) {
      // The partial unique index reports_open_target_uidx (one OPEN report per reporter
      // per target) is the duplicate check's source of truth — same 23505-translation
      // idiom as ReviewsService.create().
      if (isUniqueViolation(err)) {
        throw new ConflictException('گزارش قبلی شما هنوز در حال بررسی است');
      }
      throw err;
    }
```

In `apps/api/src/reports/reports.module.ts`, add the import:

```typescript
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module';
```

and extend the module imports array:

```typescript
  imports: [TypeOrmModule.forFeature([Report, Review, Booking]), AuthModule, AuditModule, AdminNotificationsModule],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test -- reports.service`
Expected: PASS (23 tests).

- [ ] **Step 5: Run the full unit suite**

Run: `pnpm --filter @arayeshgah/api test`
Expected: PASS (all suites).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/reports
git commit -m "feat(api): emit report_created admin notification transactionally with the report insert"
```

---

### Task 13: Reports lifecycle e2e

**Files:**
- Test: `apps/api/test/reports.e2e-spec.ts`

Full lifecycle per spec §6, against the real Postgres/Redis docker services: ineligible 403 → complete a booking through the real book→pay→complete flow (the `bookPayAndComplete` recipe from `test/reports.e2e-spec.ts`'s neighbor `reviews.e2e-spec.ts`: `POST /api/bookings`, hit the mock payment callback with the `Authority` from `paymentUrl`, then owner `PATCH /api/salons/mine/bookings/:id` to `completed`) → create → duplicate 409 → admin list with joined context → resolve → race 409 — plus the notification-row and rollback assertions for Task 12 and an audit-row assertion for Task 11's `@AuditAction` wiring. Uses the existing `loginAs`/`loginAsAdmin`/`resetDatabase`/`createTestApp` helpers from `test/utils/`.

- [ ] **Step 1: Write the e2e spec**

```typescript
// apps/api/test/reports.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Reports — lifecycle (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let adminCookie: string;
  let salonId: string;
  let salonSlug: string;
  let serviceId: string;
  let reportId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09151110001');
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Report Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 5,
    });
    salonId = salonRes.body.id;
    salonSlug = salonRes.body.slug;

    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId: 1, name: 'Cut', price: 500000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );

    customerCookie = await loginAs(app, '09152220002');
    adminCookie = await loginAsAdmin(app, '09153330003');
  });

  afterAll(async () => {
    await app.close();
  });

  async function bookPayAndComplete(hoursFromNow: number): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString() })
      .expect(201);
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(302);
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${created.body.booking.id}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);
    return created.body.booking.id;
  }

  it('requires auth to file a report', () =>
    request(app.getHttpServer()).post('/api/reports').send({ salonId, reason: 'اطلاعات سالن نادرست است' }).expect(401));

  it('reports canReport=false before any completed booking', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/reports/eligibility')
      .query({ salonId })
      .set('Cookie', customerCookie)
      .expect(200);
    expect(res.body).toEqual({ canReport: false });
  });

  it('403s a report from a customer with no completed booking at the salon', () =>
    request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ salonId, reason: 'اطلاعات سالن نادرست است' })
      .expect(403));

  it('creates an open salon report once the customer has a completed booking', async () => {
    await bookPayAndComplete(24);

    const eligibility = await request(app.getHttpServer())
      .get('/api/reports/eligibility')
      .query({ salonId })
      .set('Cookie', customerCookie)
      .expect(200);
    expect(eligibility.body).toEqual({ canReport: true });

    const res = await request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ salonId, reason: 'اطلاعات سالن نادرست است' })
      .expect(201);
    expect(res.body.status).toBe('open');
    expect(res.body.salonId).toBe(salonId);
    expect(res.body.reviewId).toBeNull();
    reportId = res.body.id;
  });

  it('409s a duplicate open report for the same salon', () =>
    request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ salonId, reason: 'گزارش تکراری برای همین سالن' })
      .expect(409));

  it('400s a report naming both a salon and a review', () =>
    request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ salonId, reviewId: '00000000-0000-4000-8000-000000000099', reason: 'هر دو هدف با هم' })
      .expect(400));

  it('404s a report for a nonexistent review', () =>
    request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ reviewId: '00000000-0000-4000-8000-000000000099', reason: 'این دیدگاه توهین‌آمیز است' })
      .expect(404));

  it('wrote exactly one report_created notification — the duplicate rolled back with its report', async () => {
    const ds = app.get(DataSource);
    const rows = await ds.query(`SELECT type, title, body, link, read_at FROM admin_notifications WHERE type = 'report_created'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('گزارش جدید ثبت شد');
    expect(rows[0].body).toBe('اطلاعات سالن نادرست است');
    expect(rows[0].link).toBe('/reports');
    expect(rows[0].read_at).toBeNull();
  });

  it('403s the admin queue for a non-admin', () =>
    request(app.getHttpServer()).get('/api/admin/reports').set('Cookie', customerCookie).expect(403));

  it('lists the open report with salon and reporter context for an admin', async () => {
    const res = await request(app.getHttpServer()).get('/api/admin/reports').set('Cookie', adminCookie).expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(20);
    const [item] = res.body.items;
    expect(item.id).toBe(reportId);
    expect(item.reason).toBe('اطلاعات سالن نادرست است');
    expect(item.salonName).toBe('Report Test Salon');
    expect(item.salonSlug).toBe(salonSlug);
    expect(item.reporterPhone).toBe('09152220002');
    expect(item.reviewRating).toBeNull();
    expect(item.reviewComment).toBeNull();
  });

  it('resolves the report, stamping resolver and time', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/reports/${reportId}`)
      .set('Cookie', adminCookie)
      .send({ status: 'resolved', note: 'بررسی شد' })
      .expect(200);
    expect(res.body.status).toBe('resolved');
    expect(res.body.resolutionNote).toBe('بررسی شد');
    expect(res.body.resolvedBy).not.toBeNull();
    expect(res.body.resolvedAt).not.toBeNull();
  });

  it('wrote a report.resolve audit row for the admin action', async () => {
    const ds = app.get(DataSource);
    const rows = await ds.query(
      `SELECT action, target_type, target_id, success FROM audit_log WHERE action = 'report.resolve'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].target_type).toBe('report');
    expect(rows[0].target_id).toBe(reportId);
    expect(rows[0].success).toBe(true);
  });

  it('409s a second resolve of the same report (lost race)', () =>
    request(app.getHttpServer())
      .patch(`/api/admin/reports/${reportId}`)
      .set('Cookie', adminCookie)
      .send({ status: 'dismissed' })
      .expect(409));

  it('excludes resolved reports from the default queue but shows them under status=resolved', async () => {
    const open = await request(app.getHttpServer()).get('/api/admin/reports').set('Cookie', adminCookie).expect(200);
    expect(open.body.total).toBe(0);

    const resolved = await request(app.getHttpServer())
      .get('/api/admin/reports')
      .query({ status: 'resolved' })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(resolved.body.total).toBe(1);
    expect(resolved.body.items[0].id).toBe(reportId);
  });

  it('reports a review, deriving the salon and surfacing the review in the admin queue', async () => {
    const bookingId = await bookPayAndComplete(48);
    const reviewRes = await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId, rating: 1, comment: 'توهین‌آمیز' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ reviewId: reviewRes.body.id, reason: 'این دیدگاه توهین‌آمیز است' })
      .expect(201);
    expect(res.body.salonId).toBe(salonId);
    expect(res.body.reviewId).toBe(reviewRes.body.id);

    const list = await request(app.getHttpServer()).get('/api/admin/reports').set('Cookie', adminCookie).expect(200);
    const item = list.body.items.find((i: { id: string }) => i.id === res.body.id);
    expect(item).toBeDefined();
    expect(item.reviewRating).toBe(1);
    expect(item.reviewComment).toBe('توهین‌آمیز');
  });
});
```

- [ ] **Step 2: Run the e2e (docker services must be up: `docker compose up -d`)**

Run: `pnpm --filter @arayeshgah/api test:e2e -- reports.e2e-spec`
Expected: PASS (15 tests). If Tasks 1–12 landed correctly nothing new is being implemented here — this test only fails if a prior task's wiring is broken (e.g. the interceptor not writing the audit row, or the emit not sharing the report's transaction).

- [ ] **Step 3: Run the full e2e suite to verify nothing regressed**

Run: `pnpm --filter @arayeshgah/api test:e2e`
Expected: PASS (all e2e suites — serialized via `--runInBand` in the script, so no extra flags needed).

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/reports.e2e-spec.ts
git commit -m "test(api): reports lifecycle e2e — eligibility, duplicate rollback, admin resolve, audit + notification rows"
```

### Task 14: `AdminUsersService` — cascade suspend/reactivate in one transaction

**Files:**
- Create: `apps/api/src/users/admin-users.service.ts`
- Test: `apps/api/src/users/admin-users.service.spec.ts`
- Modify: `apps/api/src/auth/auth.module.ts` (imports + providers, currently lines 12–28)
- Modify: `apps/api/src/users/admin-users.controller.ts` (constructor + `setStatus`, currently lines 26–52)

Spec §3.5: suspending a user must also hide their approved salon (recording `suspended_cause='owner_suspended'`), and reactivating them must restore **only** a salon the cascade itself suspended — a salon an admin suspended directly stays down. Both writes happen in one `dataSource.transaction`. The service lives in `AuthModule` (which already hosts `AdminUsersController`) with `TypeOrmModule.forFeature([User, Salon])` registered there directly — injecting `SalonsService` instead would create a `UsersModule → SalonsModule → AuthModule → UsersModule` import cycle.

The `Salon.suspendedCause` column/property already exists (entity + migration from Task 1), and the audit slice already annotated `AdminUsersController.setStatus` with `@AuditAction('user.status.set', 'user')` and wired `AuditInterceptor` — **preserve that wiring untouched** when editing the controller.

- [ ] **Step 1: Write the failing unit spec (the full cause matrix)**

Mocking style matches `apps/api/src/booking/bookings.service.spec.ts` (Test.createTestingModule + plain jest.fn() provider stubs); the transaction is mocked as an immediate callback invocation handing back a fake `EntityManager`, so every assertion can pin the exact conditional-update WHERE clauses — those WHERE clauses *are* the cause matrix.

```typescript
// apps/api/src/users/admin-users.service.spec.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { Salon } from '../salons/salon.entity';
import { AdminUsersService } from './admin-users.service';
import { User } from './user.entity';

describe('AdminUsersService.setStatus', () => {
  let service: AdminUsersService;
  let em: { update: jest.Mock; findOneBy: jest.Mock };
  let transaction: jest.Mock;

  beforeEach(async () => {
    em = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOneBy: jest.fn().mockResolvedValue({ id: 'target-1', status: 'suspended' }),
    };
    // dataSource.transaction(cb) -> cb(fake EntityManager), so the service's writes
    // are observable while still proving they all go through the one transaction.
    transaction = jest.fn(async (cb: (manager: unknown) => Promise<unknown>) => cb(em));
    const moduleRef = await Test.createTestingModule({
      providers: [AdminUsersService, { provide: DataSource, useValue: { transaction } }],
    }).compile();
    service = moduleRef.get(AdminUsersService);
  });

  it('rejects an admin targeting their own account before opening a transaction', async () => {
    await expect(service.setStatus('admin-1', 'admin-1', 'suspended')).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('404s when the target user does not exist', async () => {
    em.update.mockResolvedValueOnce({ affected: 0 });
    await expect(service.setStatus('admin-1', 'missing-1', 'suspended')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('suspend cascades only onto an APPROVED salon, recording owner_suspended as the cause', async () => {
    await service.setStatus('admin-1', 'target-1', 'suspended');

    expect(em.update).toHaveBeenNthCalledWith(1, User, { id: 'target-1' }, { status: 'suspended' });
    // WHERE owner_id = :id AND status = 'approved' -- pending/rejected/already-suspended
    // salons are untouched (they are not publicly visible anyway).
    expect(em.update).toHaveBeenNthCalledWith(
      2,
      Salon,
      { ownerId: 'target-1', status: 'approved' },
      { status: 'suspended', suspendedCause: 'owner_suspended' },
    );
    expect(em.update).toHaveBeenCalledTimes(2);
  });

  it('reactivate restores ONLY a salon the cascade itself suspended', async () => {
    await service.setStatus('admin-1', 'target-1', 'active');

    expect(em.update).toHaveBeenNthCalledWith(1, User, { id: 'target-1' }, { status: 'active' });
    // WHERE ... AND suspended_cause = 'owner_suspended' -- a salon suspended directly by
    // an admin (suspended_cause='admin') does NOT match and stays suspended.
    expect(em.update).toHaveBeenNthCalledWith(
      2,
      Salon,
      { ownerId: 'target-1', status: 'suspended', suspendedCause: 'owner_suspended' },
      { status: 'approved', suspendedCause: null },
    );
    expect(em.update).toHaveBeenCalledTimes(2);
  });

  it('returns the reloaded user from inside the transaction', async () => {
    const result = await service.setStatus('admin-1', 'target-1', 'suspended');
    expect(em.findOneBy).toHaveBeenCalledWith(User, { id: 'target-1' });
    expect(result).toEqual({ id: 'target-1', status: 'suspended' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (repo root, WSL): `pnpm --filter @arayeshgah/api test -- admin-users.service`
Expected: FAIL — `Cannot find module './admin-users.service'`

- [ ] **Step 3: Implement the service**

```typescript
// apps/api/src/users/admin-users.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Salon } from '../salons/salon.entity';
import { User, UserStatus } from './user.entity';

@Injectable()
export class AdminUsersService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Sets a user's status and cascades onto their owned salon in ONE transaction
   * (Plan 7 spec 3.5):
   *  - suspend:    salon WHERE owner_id AND status='approved'
   *                  -> status='suspended', suspended_cause='owner_suspended'
   *  - reactivate: salon WHERE owner_id AND status='suspended' AND suspended_cause='owner_suspended'
   *                  -> status='approved', suspended_cause=NULL
   * A salon an admin suspended directly (suspended_cause='admin') never matches the
   * reactivate WHERE clause, so it stays suspended -- that is the whole point of the cause column.
   */
  async setStatus(actingAdminId: string, targetUserId: string, status: UserStatus): Promise<User> {
    if (targetUserId === actingAdminId) {
      throw new BadRequestException('You cannot change your own account status');
    }

    return this.dataSource.transaction(async (em) => {
      const result = await em.update(User, { id: targetUserId }, { status });
      if (!result.affected) throw new NotFoundException();

      if (status === 'suspended') {
        await em.update(
          Salon,
          { ownerId: targetUserId, status: 'approved' },
          { status: 'suspended', suspendedCause: 'owner_suspended' },
        );
      } else {
        await em.update(
          Salon,
          { ownerId: targetUserId, status: 'suspended', suspendedCause: 'owner_suspended' },
          { status: 'approved', suspendedCause: null },
        );
      }

      return (await em.findOneBy(User, { id: targetUserId }))!;
    });
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @arayeshgah/api test -- admin-users.service`
Expected: PASS (5 tests)

- [ ] **Step 5: Register the service in `AuthModule`**

In `apps/api/src/auth/auth.module.ts` (keep everything the audit tasks added — e.g. an `AuditModule` import — exactly where it is):

Add to the import statements at the top:

```typescript
import { TypeOrmModule } from '@nestjs/typeorm';
import { Salon } from '../salons/salon.entity';
import { User } from '../users/user.entity';
import { AdminUsersService } from '../users/admin-users.service';
```

In the `@Module` decorator, add `TypeOrmModule.forFeature([User, Salon])` to `imports` (registering the repo tokens directly in `AuthModule` — importing `SalonsModule` here would close a `UsersModule → SalonsModule → AuthModule` cycle) and `AdminUsersService` to `providers`:

```typescript
  imports: [
    UsersModule,
    SmsModule,
    AuditModule,
    TypeOrmModule.forFeature([User, Salon]),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow('JWT_SECRET'),
        signOptions: { expiresIn: '30d' },
      }),
    }),
  ],
  controllers: [AuthController, AdminUsersController],
  providers: [OtpService, AuthGuard, RolesGuard, AdminUsersService],
  exports: [OtpService, AuthGuard, RolesGuard, UsersModule],
```

(`AuditModule` was added to this array by Task 5 — it must stay, or Nest cannot resolve `AuditInterceptor` for `AdminUsersController` and the app fails to boot.)

- [ ] **Step 6: Delegate from the controller**

In `apps/api/src/users/admin-users.controller.ts`:

1. Add the import:

```typescript
import { AdminUsersService } from './admin-users.service';
```

2. Replace the constructor (the `User` repo stays — `list()` still uses it):

```typescript
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly adminUsers: AdminUsersService,
  ) {}
```

3. Replace the whole `setStatus` handler body — keep the `@AuditAction('user.status.set', 'user')` decorator and any `AuditInterceptor` wiring the audit task put on this handler/controller exactly as-is:

```typescript
  @Patch(':id/status')
  @AuditAction('user.status.set', 'user') // already present from the audit task -- keep
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminUserStatusDto, @Req() req: Request) {
    return this.adminUsers.setStatus((req.user as User).id, id, dto.status);
  }
```

4. Remove `BadRequestException` and `NotFoundException` from the `@nestjs/common` import — the inline logic that used them moved into the service (they are not used anywhere else in this file).

- [ ] **Step 7: Verify nothing regressed**

Run: `pnpm --filter @arayeshgah/api test`
Expected: PASS (full unit suite — a DI failure here means the `forFeature`/provider registration in Step 5 is wrong)

Run (docker services up): `pnpm --filter @arayeshgah/api test:e2e -- admin-users`
Expected: PASS — the pre-existing `admin-users.e2e-spec.ts` (self-target 400, 404, suspend/reactivate 200) proves the delegation preserved the old behavior.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/users/admin-users.service.ts apps/api/src/users/admin-users.service.spec.ts apps/api/src/users/admin-users.controller.ts apps/api/src/auth/auth.module.ts
git commit -m "feat(api): cascade user suspension onto the owned salon with cause tracking"
```

---

### Task 15: Adjacent fixes — `suspended_cause='admin'` on direct suspension; public reviews require an approved salon

**Files:**
- Modify: `apps/api/src/salons/admin-salons.controller.ts` (`setStatus`, currently lines 47–55)
- Test: `apps/api/src/salons/admin-salons.controller.spec.ts` (new)
- Modify: `apps/api/src/reviews/reviews.service.ts` (imports/constructor lines 1–15, `findForSalon` lines 57–59)
- Test: `apps/api/src/reviews/reviews.service.spec.ts` (new)

Two small backend fixes from spec §3.5:

**(a)** The cascade in Task 14 can only distinguish "suspended because the owner was suspended" from "suspended by an admin on purpose" if the direct admin path records its cause. `AdminSalonsController.setStatus` keeps its direct-`repo.update` style and additionally sets `suspendedCause: 'admin'` when suspending and `suspendedCause: null` when approving (rejection leaves it untouched — reject applies to pending salons and doesn't own the cause).

**(b)** `GET /api/salons/:salonId/reviews` (public, `SalonReviewsController` → `ReviewsService.findForSalon`) currently lists published reviews for **any** salon id, leaking reviews of pending/suspended salons. The fix requires the salon to be `approved` and **404s otherwise** — that is what this endpoint's neighbors do: `PublicSalonContentController.requireSalonId()` funnels every public `salons/:slug/*` sub-resource (services/hours/photos) through `SalonsService.findPublicBySlug()`, which throws `NotFoundException` for anything non-approved. Matching 404 (not an empty array) keeps "this salon does not publicly exist" consistent across all public salon sub-resources.

No module change is needed for (b): `ReviewsModule` already imports `SalonsModule`, and `SalonsModule` exports its `TypeOrmModule` feature (see `apps/api/src/salons/salons.module.ts` line 40), so the `Salon` repository token is already injectable in `ReviewsService`.

- [ ] **Step 1: Write the failing spec for (a)**

The controller has no service, so instantiate it directly with a mocked repository (guards/interceptors are request-time concerns and don't run on direct method calls):

```typescript
// apps/api/src/salons/admin-salons.controller.spec.ts
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AdminSalonsController } from './admin-salons.controller';
import { Salon } from './salon.entity';

describe('AdminSalonsController.setStatus suspended_cause handling', () => {
  let controller: AdminSalonsController;
  let repo: { update: jest.Mock; findOneBy: jest.Mock };

  beforeEach(() => {
    repo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOneBy: jest.fn().mockResolvedValue({ id: 's1' }),
    };
    controller = new AdminSalonsController(repo as unknown as Repository<Salon>);
  });

  it('records suspended_cause=admin on a direct suspension', async () => {
    await controller.setStatus('s1', { status: 'suspended', reason: 'تخلف از قوانین پلتفرم' });
    expect(repo.update).toHaveBeenCalledWith(
      { id: 's1' },
      { status: 'suspended', rejectionReason: 'تخلف از قوانین پلتفرم', suspendedCause: 'admin' },
    );
  });

  it('clears suspended_cause on approval', async () => {
    await controller.setStatus('s1', { status: 'approved' });
    expect(repo.update).toHaveBeenCalledWith(
      { id: 's1' },
      { status: 'approved', rejectionReason: null, suspendedCause: null },
    );
  });

  it('leaves suspended_cause untouched on rejection', async () => {
    await controller.setStatus('s1', { status: 'rejected', reason: 'مدارک ناقص است' });
    expect(repo.update).toHaveBeenCalledWith(
      { id: 's1' },
      { status: 'rejected', rejectionReason: 'مدارک ناقص است' },
    );
  });

  it('404s when the salon does not exist', async () => {
    repo.update.mockResolvedValueOnce({ affected: 0 });
    await expect(controller.setStatus('missing', { status: 'approved' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @arayeshgah/api test -- admin-salons.controller`
Expected: FAIL — the first two tests fail with `expect(jest.fn()).toHaveBeenCalledWith(...)` mismatches: the actual update payload has no `suspendedCause` key.

- [ ] **Step 3: Implement (a)**

In `apps/api/src/salons/admin-salons.controller.ts`, replace the `setStatus` handler (keep the `@AuditAction('salon.status.set', 'salon')` decorator the audit task added):

```typescript
  @Patch(':id/status')
  @AuditAction('salon.status.set', 'salon') // already present from the audit task -- keep
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminSalonStatusDto) {
    const patch: Partial<Salon> = {
      status: dto.status,
      rejectionReason: dto.status === 'approved' ? null : (dto.reason ?? null),
    };
    // suspended_cause bookkeeping (Plan 7 spec 3.5): a direct admin suspension is marked
    // 'admin' so a later owner reactivation will NOT auto-restore this salon; approving
    // (from any prior state) clears the cause. Rejection leaves it untouched.
    if (dto.status === 'suspended') patch.suspendedCause = 'admin';
    if (dto.status === 'approved') patch.suspendedCause = null;
    const result = await this.salons.update({ id }, patch);
    if (!result.affected) throw new NotFoundException();
    return this.salons.findOneBy({ id });
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @arayeshgah/api test -- admin-salons.controller`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit (a)**

```bash
git add apps/api/src/salons/admin-salons.controller.ts apps/api/src/salons/admin-salons.controller.spec.ts
git commit -m "feat(api): mark admin-suspended salons with suspended_cause=admin"
```

- [ ] **Step 6: Write the failing spec for (b)**

```typescript
// apps/api/src/reviews/reviews.service.spec.ts
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Booking } from '../booking/booking.entity';
import { Salon } from '../salons/salon.entity';
import { Review } from './review.entity';
import { ReviewsService } from './reviews.service';

describe('ReviewsService.findForSalon', () => {
  let service: ReviewsService;
  let reviewsFind: jest.Mock;
  let salonFindOneBy: jest.Mock;

  beforeEach(async () => {
    reviewsFind = jest.fn();
    salonFindOneBy = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: getRepositoryToken(Review), useValue: { find: reviewsFind } },
        { provide: getRepositoryToken(Booking), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: { findOneBy: salonFindOneBy } },
        { provide: DataSource, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(ReviewsService);
  });

  it('404s when the salon does not exist, without touching the reviews table', async () => {
    salonFindOneBy.mockResolvedValue(null);
    await expect(service.findForSalon('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(reviewsFind).not.toHaveBeenCalled();
  });

  it('404s for a non-approved salon (the lookup itself is scoped to status=approved)', async () => {
    salonFindOneBy.mockResolvedValue(null);
    await expect(service.findForSalon('suspended-salon')).rejects.toBeInstanceOf(NotFoundException);
    expect(salonFindOneBy).toHaveBeenCalledWith({ id: 'suspended-salon', status: 'approved' });
  });

  it('returns published reviews newest-first for an approved salon', async () => {
    salonFindOneBy.mockResolvedValue({ id: 's1', status: 'approved' });
    const rows = [{ id: 'r1' }];
    reviewsFind.mockResolvedValue(rows);
    await expect(service.findForSalon('s1')).resolves.toBe(rows);
    expect(reviewsFind).toHaveBeenCalledWith({
      where: { salonId: 's1', status: 'published' },
      order: { createdAt: 'DESC' },
    });
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm --filter @arayeshgah/api test -- reviews.service`
Expected: FAIL — the two 404 tests fail with "Received promise resolved instead of rejected" (current `findForSalon` never checks the salon).

- [ ] **Step 8: Implement (b)**

In `apps/api/src/reviews/reviews.service.ts`:

1. Add the entity import next to the existing ones:

```typescript
import { Salon } from '../salons/salon.entity';
```

2. Add the `Salon` repository to the constructor (after the existing `Booking` repo line):

```typescript
  constructor(
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    private readonly dataSource: DataSource,
  ) {}
```

3. Replace `findForSalon` (currently a one-liner at line 57):

```typescript
  async findForSalon(salonId: string): Promise<Review[]> {
    // Public sub-resources of a salon 404 when the salon is not approved -- the same
    // policy PublicSalonContentController.requireSalonId() applies to the public
    // services/hours/photos listings via SalonsService.findPublicBySlug(). Without
    // this check, reviews of pending/suspended salons were publicly listable by id.
    const salon = await this.salons.findOneBy({ id: salonId, status: 'approved' });
    if (!salon) throw new NotFoundException();
    return this.reviews.find({ where: { salonId, status: 'published' }, order: { createdAt: 'DESC' } });
  }
```

- [ ] **Step 9: Run it to verify it passes, and check the existing e2e still holds**

Run: `pnpm --filter @arayeshgah/api test -- reviews.service`
Expected: PASS (3 tests)

Run (docker services up): `pnpm --filter @arayeshgah/api test:e2e -- reviews`
Expected: PASS — every listing in `reviews.e2e-spec.ts` goes through salons it explicitly sets to `approved` first, so the new check changes nothing there.

- [ ] **Step 10: Commit (b)**

```bash
git add apps/api/src/reviews/reviews.service.ts apps/api/src/reviews/reviews.service.spec.ts
git commit -m "fix(api): require an approved salon for the public reviews listing"
```

---

### Task 16: e2e — cascade suspend lifecycle + `user.status.set` audit trail

**Files:**
- Test: `apps/api/test/cascade-suspend.e2e-spec.ts` (new)

Integration proof of Tasks 14–15 against a real database: suspending a provider makes their salon vanish from public search **and** 404s the public profile; reactivating restores it; a salon an admin suspended directly is NOT restored when its owner is reactivated; and every `PATCH /admin/users/:id/status` left a `user.status.set` row in `audit_log` (the audit slice's interceptor is already wired on `AdminUsersController`).

Seeding follows `search.e2e-spec.ts` exactly (fixed-uuid users/salons via raw SQL — seeded users need no OTP login because only the admin calls endpoints); auth follows `admin-users.e2e-spec.ts` (`loginAsAdmin`). This task is verification, not TDD — the production code already exists, so the spec is expected to pass on the first run; a failure localizes a defect in Task 1 (migration), 14, 15, or the audit slice.

- [ ] **Step 1: Write the e2e spec**

```typescript
// apps/api/test/cascade-suspend.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

const ANCHOR = { lat: 35.7219, lng: 51.3347 };
const OWNER_CASCADE = '00000000-0000-4000-8000-000000000021';
const OWNER_DIRECT = '00000000-0000-4000-8000-000000000022';
const SALON_CASCADE = '10000000-0000-4000-8000-000000000021';
const SALON_DIRECT = '10000000-0000-4000-8000-000000000022';

describe('Cascade suspend/reactivate (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminCookie: string;

  const searchSlugs = async (): Promise<string[]> => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women' })
      .expect(200);
    return res.body.map((s: { slug: string }) => s.slug);
  };

  const setUserStatus = (userId: string, status: 'active' | 'suspended') =>
    request(app.getHttpServer())
      .patch(`/api/admin/users/${userId}/status`)
      .set('Cookie', adminCookie)
      .send({ status })
      .expect(200);

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);
    adminCookie = await loginAsAdmin(app, '09122400001');

    // Two provider owners, seeded directly (they never log in; only the admin acts).
    await ds.query(`
      INSERT INTO users (id, phone, role) VALUES
        ('${OWNER_CASCADE}', '09122400002', 'provider'),
        ('${OWNER_DIRECT}', '09122400003', 'provider')`);

    // Two approved women salons near the anchor, one per owner.
    await ds.query(`
      INSERT INTO salons (id, owner_id, name, slug, gender_target, status, address, city, location) VALUES
        ('${SALON_CASCADE}', '${OWNER_CASCADE}',
         'Cascade Salon', 'cascade-salon', 'women', 'approved', 'A', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.3347, 35.7219), 4326)::geography),
        ('${SALON_DIRECT}', '${OWNER_DIRECT}',
         'Direct Salon', 'direct-salon', 'women', 'approved', 'B', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.3350, 35.7220), 4326)::geography)`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('shows both approved salons publicly before any suspension', async () => {
    expect(await searchSlugs()).toEqual(expect.arrayContaining(['cascade-salon', 'direct-salon']));
    await request(app.getHttpServer()).get('/api/salons/cascade-salon').expect(200);
  });

  it('suspending the owner hides the salon from search and 404s its public profile', async () => {
    await setUserStatus(OWNER_CASCADE, 'suspended');

    expect(await searchSlugs()).not.toContain('cascade-salon');
    await request(app.getHttpServer()).get('/api/salons/cascade-salon').expect(404);

    const [salon] = await ds.query(`SELECT status, suspended_cause FROM salons WHERE id = $1`, [SALON_CASCADE]);
    expect(salon).toEqual({ status: 'suspended', suspended_cause: 'owner_suspended' });
  });

  it('reactivating the owner restores the cascade-suspended salon', async () => {
    await setUserStatus(OWNER_CASCADE, 'active');

    expect(await searchSlugs()).toContain('cascade-salon');
    await request(app.getHttpServer()).get('/api/salons/cascade-salon').expect(200);

    const [salon] = await ds.query(`SELECT status, suspended_cause FROM salons WHERE id = $1`, [SALON_CASCADE]);
    expect(salon).toEqual({ status: 'approved', suspended_cause: null });
  });

  it('does NOT restore a directly-suspended salon when its owner is reactivated', async () => {
    // An admin suspends the salon itself (records suspended_cause='admin', Task 15a) ...
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${SALON_DIRECT}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'suspended', reason: 'تخلف از قوانین پلتفرم' })
      .expect(200);

    // ... then the owner is suspended and later reactivated.
    await setUserStatus(OWNER_DIRECT, 'suspended');
    await setUserStatus(OWNER_DIRECT, 'active');

    // The salon stays down: the reactivate cascade only matches suspended_cause='owner_suspended'.
    expect(await searchSlugs()).not.toContain('direct-salon');
    await request(app.getHttpServer()).get('/api/salons/direct-salon').expect(404);

    const [salon] = await ds.query(`SELECT status, suspended_cause FROM salons WHERE id = $1`, [SALON_DIRECT]);
    expect(salon).toEqual({ status: 'suspended', suspended_cause: 'admin' });
  });

  it('wrote a user.status.set audit row for every user-status change above', async () => {
    // AuditInterceptor awaits the insert before the HTTP response is sent (see Task 4),
    // so the rows are guaranteed to exist by now — no polling or sleeps needed.
    const rows: Array<{ target_id: string; success: boolean }> = await ds.query(
      `SELECT target_id, success FROM audit_log WHERE action = 'user.status.set' ORDER BY created_at`,
    );

    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.success)).toBe(true);
    expect(rows.map((r) => r.target_id)).toEqual([OWNER_CASCADE, OWNER_CASCADE, OWNER_DIRECT, OWNER_DIRECT]);
  });
});
```

- [ ] **Step 2: Run it**

Run (docker services up): `pnpm --filter @arayeshgah/api test:e2e -- cascade-suspend`
Expected: PASS (5 tests). If it fails, localize before touching anything: a failing salon-visibility assertion points at Task 14's transaction, a wrong `suspended_cause` at Task 14/15a's WHERE clauses, and a missing audit row at the audit slice's interceptor wiring on `AdminUsersController` — this spec is downstream verification, not the place to fix it.

- [ ] **Step 3: Run the full backend e2e suite to confirm no cross-suite fallout**

Run: `pnpm --filter @arayeshgah/api test:e2e`
Expected: PASS — in particular `admin-users.e2e-spec.ts`, `admin-salon-status.e2e-spec.ts`, `search.e2e-spec.ts`, and `reviews.e2e-spec.ts` (the suites closest to the code Tasks 14–15 touched).

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/cascade-suspend.e2e-spec.ts
git commit -m "test(api): e2e coverage for cascade suspend/reactivate and its audit trail"
```

### Task 17: Admin-panel label maps, new icons, and the notification bell

**Files:**
- Modify: `apps/admin-panel/src/utils/labels.ts` (:41-59 — append the new maps/getters after `userStatusLabel`/`userRoleLabel`/`genderTargetLabel`)
- Test: `apps/admin-panel/src/utils/labels.spec.ts` (create)
- Modify: `apps/admin-panel/src/components/ui/AppIcon.vue` (:7-55 — Lucide imports, `IconName` union, `ICONS` map)
- Create: `apps/admin-panel/src/components/layout/NotificationBell.vue`
- Test: `apps/admin-panel/src/components/layout/NotificationBell.spec.ts` (create)
- Modify: `apps/admin-panel/src/components/layout/AppLayout.vue` (:2-10 imports, :45-55 header icon row)

The bell polls `GET /admin/notifications/unread-count` every 60 seconds (silent — a failed poll must never toast), shows a badge when `count > 0`, and opens a dropdown of the 10 most recent notifications. Clicking one marks it read (`PATCH /admin/notifications/:id/read`) and routes to its `link`; a "mark all read" affordance calls `POST /admin/notifications/read-all`. All endpoints and the `{items,total,page,pageSize}` envelope come from the Admin Notifications backend task in this plan.

- [ ] **Step 1: Write the failing label-map test**

```typescript
// apps/admin-panel/src/utils/labels.spec.ts
import { describe, expect, it } from 'vitest'
import { auditActionLabel, reportStatusLabel } from './labels'

const AUDIT_ACTIONS = [
  'salon.status.set',
  'salon.featured.set',
  'user.status.set',
  'review.moderate',
  'category.create',
  'category.update',
  'category.delete',
  'config.update',
  'report.resolve',
]

describe('auditActionLabel', () => {
  it('maps every one of the nine audited actions to a Farsi label', () => {
    for (const action of AUDIT_ACTIONS) {
      const entry = auditActionLabel(action)
      // A mapped entry never falls back to the raw dotted action name.
      expect(entry.label).not.toBe(action)
      expect(entry.label.length).toBeGreaterThan(0)
    }
  })

  it('falls back to the raw value with a neutral tone for unknown actions', () => {
    expect(auditActionLabel('something.new')).toEqual({ label: 'something.new', tone: 'neutral' })
  })
})

describe('reportStatusLabel', () => {
  it('maps the three report statuses', () => {
    expect(reportStatusLabel('open')).toEqual({ label: 'باز', tone: 'warning' })
    expect(reportStatusLabel('resolved')).toEqual({ label: 'رسیدگی شده', tone: 'success' })
    expect(reportStatusLabel('dismissed')).toEqual({ label: 'رد شده', tone: 'neutral' })
  })

  it('falls back to the raw value for unknown statuses', () => {
    expect(reportStatusLabel('weird')).toEqual({ label: 'weird', tone: 'neutral' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run (from repo root): `pnpm --filter @arayeshgah/admin-panel test -- src/utils/labels.spec.ts`
Expected: FAIL — `labels.ts` does not export `auditActionLabel`/`reportStatusLabel` (SyntaxError: no export named `auditActionLabel`).

- [ ] **Step 3: Add the maps to `labels.ts`**

In `apps/admin-panel/src/utils/labels.ts`, after the existing `genderTargetLabel` function (line 57-59) and before the `ConfigMeta` interface, insert:

```typescript
// Keys must stay in sync with the backend's @AuditAction() names (audit.decorator.ts).
const AUDIT_ACTION: Record<string, LabelEntry> = {
  'salon.status.set': { label: 'تغییر وضعیت آرایشگاه', tone: 'warning' },
  'salon.featured.set': { label: 'تغییر نشان ویژه', tone: 'info' },
  'user.status.set': { label: 'تغییر وضعیت کاربر', tone: 'danger' },
  'review.moderate': { label: 'تعدیل نظر', tone: 'warning' },
  'category.create': { label: 'ایجاد دسته‌بندی', tone: 'success' },
  'category.update': { label: 'ویرایش دسته‌بندی', tone: 'info' },
  'category.delete': { label: 'حذف دسته‌بندی', tone: 'danger' },
  'config.update': { label: 'به‌روزرسانی تنظیمات', tone: 'info' },
  'report.resolve': { label: 'رسیدگی به گزارش', tone: 'success' },
}

const REPORT_STATUS: Record<string, LabelEntry> = {
  open: { label: 'باز', tone: 'warning' },
  resolved: { label: 'رسیدگی شده', tone: 'success' },
  dismissed: { label: 'رد شده', tone: 'neutral' },
}

export function auditActionLabel(action: string): LabelEntry {
  return AUDIT_ACTION[action] ?? { label: action, tone: 'neutral' }
}

export function reportStatusLabel(status: string): LabelEntry {
  return REPORT_STATUS[status] ?? { label: status, tone: 'neutral' }
}
```

- [ ] **Step 4: Run the label test to verify it passes**

Run: `pnpm --filter @arayeshgah/admin-panel test -- src/utils/labels.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the three new icons to `AppIcon.vue`**

In `apps/admin-panel/src/components/ui/AppIcon.vue`, extend the Lucide import (lines 7-12):

```typescript
import {
  LayoutDashboard, Store, Star, Grid2x2, Users, Settings2, LogOut,
  Check, X, ChevronLeft, ChevronRight, Search, CircleUser, Building2, TriangleAlert,
  Plus, Pencil, Scissors, Palette, Droplet, Gem, Sparkles, Paintbrush,
  Eye, Zap, Tag, Phone, Calendar, Lock, Sun, Moon, RotateCcw,
  History, Flag, Bell,
} from '@lucide/vue'
```

Extend the `IconName` union (lines 14-19) — change the last line of the union:

```typescript
export type IconName =
  | 'dashboard' | 'salons' | 'reviews' | 'categories' | 'users' | 'config' | 'logout'
  | 'check' | 'x' | 'chevron-left' | 'chevron-right' | 'search' | 'star' | 'user-circle' | 'building'
  | 'warning' | 'plus' | 'pencil' | 'scissors' | 'palette' | 'droplet' | 'nail'
  | 'sparkles' | 'brush' | 'eye' | 'razor' | 'tag' | 'phone' | 'calendar' | 'lock'
  | 'sun' | 'moon' | 'reset' | 'history' | 'flag' | 'bell'
```

And extend the `ICONS` map — after the existing `reset: RotateCcw,` entry (line 54), add:

```typescript
  history: History,
  flag: Flag,
  bell: Bell,
```

- [ ] **Step 6: Write the failing NotificationBell test**

`flushPromises` from `@vue/test-utils` schedules on real timers, so only interval timers are faked (`toFake: ['setInterval', 'clearInterval']`) — awaiting mocked fetches keeps working while `vi.advanceTimersByTime` drives the poll.

```typescript
// apps/admin-panel/src/components/layout/NotificationBell.spec.ts
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import NotificationBell from './NotificationBell.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/reports', component: { template: '<div />' } },
      { path: '/salons/:id', component: { template: '<div />' } },
    ],
  })
}

async function mountBell() {
  const router = makeRouter()
  router.push('/')
  await router.isReady()
  const wrapper = mount(NotificationBell, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

const notification = {
  id: 'n1',
  type: 'report_created',
  title: 'گزارش جدید ثبت شد',
  body: 'یک کاربر سالنی را گزارش کرد.',
  link: '/reports',
  readAt: null,
  createdAt: '2026-07-10T10:00:00.000Z',
}

describe('NotificationBell', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    // Only fake interval timers: flushPromises and Vue's scheduler keep real timers.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls the unread count on mount and every 60 seconds, and stops on unmount', async () => {
    fetchMock.mockResolvedValue({ data: { count: 0 }, error: null })
    const { wrapper } = await mountBell()

    expect(fetchMock).toHaveBeenCalledWith('/admin/notifications/unread-count', { silent: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(60_000)
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    wrapper.unmount()
    vi.advanceTimersByTime(180_000)
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shows a badge only when there are unread notifications', async () => {
    fetchMock.mockResolvedValueOnce({ data: { count: 3 }, error: null })
    const { wrapper } = await mountBell()

    expect(wrapper.find('[data-testid="unread-badge"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="unread-badge"]').text()).toBe('3')
  })

  it('hides the badge when the count is zero', async () => {
    fetchMock.mockResolvedValueOnce({ data: { count: 0 }, error: null })
    const { wrapper } = await mountBell()

    expect(wrapper.find('[data-testid="unread-badge"]').exists()).toBe(false)
  })

  it('opens a dropdown listing the ten most recent notifications', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: { count: 1 }, error: null }) // mount poll
      .mockResolvedValueOnce({ data: { items: [notification], total: 1, page: 1, pageSize: 10 }, error: null })
    const { wrapper } = await mountBell()

    await wrapper.get('[data-testid="notification-bell"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/notifications?page=1&pageSize=10', { silent: true })
    expect(wrapper.get('[data-testid="notification-dropdown"]').text()).toContain('گزارش جدید ثبت شد')
  })

  it('marks a clicked notification read and navigates to its link', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: { count: 1 }, error: null })
      .mockResolvedValueOnce({ data: { items: [{ ...notification }], total: 1, page: 1, pageSize: 10 }, error: null })
      .mockResolvedValueOnce({ data: null, error: null }) // PATCH .../read
    const { wrapper, router } = await mountBell()

    await wrapper.get('[data-testid="notification-bell"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="notification-item"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/notifications/n1/read', { method: 'PATCH', silent: true })
    expect(router.currentRoute.value.path).toBe('/reports')
    expect(wrapper.find('[data-testid="unread-badge"]').exists()).toBe(false)
  })

  it('marks everything read via the mark-all affordance', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: { count: 2 }, error: null })
      .mockResolvedValueOnce({ data: { items: [{ ...notification }], total: 1, page: 1, pageSize: 10 }, error: null })
      .mockResolvedValueOnce({ data: null, error: null }) // POST read-all
    const { wrapper } = await mountBell()

    await wrapper.get('[data-testid="notification-bell"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="mark-all-read"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/notifications/read-all', { method: 'POST', silent: true })
    expect(wrapper.find('[data-testid="unread-badge"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm --filter @arayeshgah/admin-panel test -- src/components/layout/NotificationBell.spec.ts`
Expected: FAIL — `Failed to resolve import "./NotificationBell.vue"`.

- [ ] **Step 8: Implement `NotificationBell.vue`**

```vue
<!-- apps/admin-panel/src/components/layout/NotificationBell.vue -->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import AppIcon from '@/components/ui/AppIcon.vue'

interface AdminNotification {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  readAt: string | null
  createdAt: string
}

interface NotificationListResponse {
  items: AdminNotification[]
  total: number
  page: number
  pageSize: number
}

const POLL_INTERVAL_MS = 60_000

const router = useRouter()
const { apiFetch } = useApi()

const root = ref<HTMLElement | null>(null)
const open = ref(false)
const count = ref(0)
const notifications = ref<AdminNotification[]>([])
const loadingList = ref(false)

let pollTimer: ReturnType<typeof setInterval> | undefined

async function loadCount() {
  // silent: a failed badge poll must never toast, and the next tick simply retries.
  const { data } = await apiFetch<{ count: number }>('/admin/notifications/unread-count', { silent: true })
  if (data) count.value = data.count
}

async function loadList() {
  loadingList.value = true
  const { data } = await apiFetch<NotificationListResponse>('/admin/notifications?page=1&pageSize=10', {
    silent: true,
  })
  notifications.value = data?.items ?? []
  loadingList.value = false
}

async function toggle() {
  open.value = !open.value
  if (open.value) await loadList()
}

async function openNotification(notification: AdminNotification) {
  if (!notification.readAt) {
    const { error } = await apiFetch(`/admin/notifications/${notification.id}/read`, {
      method: 'PATCH',
      silent: true,
    })
    if (!error) {
      notification.readAt = new Date().toISOString()
      count.value = Math.max(0, count.value - 1)
    }
  }
  open.value = false
  if (notification.link) await router.push(notification.link)
}

async function markAllRead() {
  const { error } = await apiFetch('/admin/notifications/read-all', { method: 'POST', silent: true })
  if (!error) {
    count.value = 0
    const now = new Date().toISOString()
    for (const notification of notifications.value) notification.readAt = notification.readAt ?? now
  }
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function onDocumentClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}

onMounted(() => {
  loadCount()
  pollTimer = setInterval(loadCount, POLL_INTERVAL_MS)
  document.addEventListener('mousedown', onDocumentClick)
})

onUnmounted(() => {
  if (pollTimer !== undefined) clearInterval(pollTimer)
  document.removeEventListener('mousedown', onDocumentClick)
})
</script>

<template>
  <div ref="root" class="relative">
    <button
      data-testid="notification-bell"
      type="button"
      title="اعلان‌ها"
      class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-(--color-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-text)"
      @click="toggle"
    >
      <AppIcon name="bell" :size="18" />
      <span
        v-if="count > 0"
        data-testid="unread-badge"
        class="tnum absolute -left-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-(--tone-danger-text) px-1 text-[10px] font-bold text-white"
      >
        {{ count > 99 ? '۹۹+' : count }}
      </span>
    </button>

    <div
      v-if="open"
      data-testid="notification-dropdown"
      class="absolute left-0 z-50 mt-1.5 w-80 rounded-2xl border border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-pop)"
    >
      <div class="flex items-center justify-between border-b border-(--color-border-soft) px-4 py-2.5">
        <p class="text-sm font-bold text-(--color-text)">اعلان‌ها</p>
        <button
          data-testid="mark-all-read"
          type="button"
          class="text-xs font-semibold text-(--color-accent) transition-opacity hover:opacity-80"
          @click="markAllRead"
        >
          خواندن همه
        </button>
      </div>

      <p v-if="!loadingList && notifications.length === 0" class="px-4 py-8 text-center text-sm text-(--color-muted)">
        اعلانی وجود ندارد.
      </p>

      <ul v-else class="max-h-96 overflow-y-auto py-1">
        <li v-for="notification in notifications" :key="notification.id">
          <button
            type="button"
            data-testid="notification-item"
            class="flex w-full flex-col gap-0.5 px-4 py-2.5 text-right transition-colors hover:bg-(--color-border-soft)"
            @click="openNotification(notification)"
          >
            <span class="flex items-center gap-2">
              <span v-if="!notification.readAt" class="h-1.5 w-1.5 shrink-0 rounded-full bg-(--color-accent)" />
              <span class="text-sm font-semibold text-(--color-text)">{{ notification.title }}</span>
            </span>
            <span v-if="notification.body" class="text-xs leading-5 text-(--color-muted)">{{ notification.body }}</span>
            <span class="tnum text-[11px] text-(--color-muted)">{{ formatTime(notification.createdAt) }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
```

- [ ] **Step 9: Run the bell test to verify it passes**

Run: `pnpm --filter @arayeshgah/admin-panel test -- src/components/layout/NotificationBell.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 10: Mount the bell in `AppLayout.vue`'s header icon row**

In `apps/admin-panel/src/components/layout/AppLayout.vue`, add the import next to the existing `SidebarNav` import (line 10):

```typescript
import { userRoleLabel } from '@/utils/labels'
import NotificationBell from './NotificationBell.vue'
import SidebarNav from './SidebarNav.vue'
```

And in the template, insert `<NotificationBell />` between the theme-toggle button and the divider (currently lines 46-55):

```html
          <button
            type="button"
            :title="isDark ? 'حالت روشن' : 'حالت تیره'"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-(--color-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-text)"
            @click="toggleTheme"
          >
            <AppIcon :name="isDark ? 'sun' : 'moon'" :size="18" />
          </button>

          <NotificationBell />

          <div class="mx-1 h-6 w-px bg-(--color-border)" />
```

- [ ] **Step 11: Full check and commit**

Run: `pnpm --filter @arayeshgah/admin-panel test` — expected: all suites pass.
Run: `pnpm --filter @arayeshgah/admin-panel typecheck` — expected: clean.

```bash
git add apps/admin-panel/src/utils/labels.ts apps/admin-panel/src/utils/labels.spec.ts apps/admin-panel/src/components/ui/AppIcon.vue apps/admin-panel/src/components/layout/NotificationBell.vue apps/admin-panel/src/components/layout/NotificationBell.spec.ts apps/admin-panel/src/components/layout/AppLayout.vue
git commit -m "feat(admin-panel): notification bell with unread polling, plus audit/report label maps"
```

---

### Task 18: Audit Log page

**Files:**
- Create: `apps/admin-panel/src/pages/AuditLogView.vue`
- Test: `apps/admin-panel/src/pages/AuditLogView.spec.ts` (create)
- Modify: `apps/admin-panel/src/router/index.ts` (:13-21 — the `AppLayout` children array)
- Modify: `apps/admin-panel/src/components/layout/SidebarNav.vue` (:6-13 — the `LINKS` const)

A SalonsView clone over `GET /admin/audit-log` (defined in this plan's audit backend task; envelope `{items,total,page,pageSize}`, pageSize default 20). Filters: an action `AppSelect` built from the nine contract action names, a debounced free-text actor filter (sent as `actorId`), and a `JalaliDatePicker` range sent as `from`/`to` ISO strings (same conversion as UsersView's `joinedFrom`/`joinedTo`). Items carry the joined actor identity as `actorPhone`/`actorName` — this matches the response shape defined in the audit backend task's admin read controller.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/admin-panel/src/pages/AuditLogView.spec.ts
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppSelect from '@/components/ui/AppSelect.vue'
import AuditLogView from './AuditLogView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const mountOptions = { global: { stubs: { RouterLink: RouterLinkStub } } }

const row = {
  id: 'a1',
  actorId: 'u9',
  actorPhone: '09121234567',
  actorName: 'مدیر کل',
  action: 'salon.status.set',
  targetType: 'salon',
  targetId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  success: true,
  createdAt: '2026-07-10T09:30:00.000Z',
}

describe('AuditLogView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads page 1 with the default page size and renders rows through the Farsi maps', async () => {
    fetchMock.mockResolvedValue({ data: { items: [row], total: 1, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(AuditLogView, mountOptions)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/audit-log?page=1&pageSize=20', { silent: true })
    // Action renders as its Farsi label, never the raw dotted enum.
    expect(wrapper.text()).toContain('تغییر وضعیت آرایشگاه')
    expect(wrapper.text()).not.toContain('salon.status.set')
    expect(wrapper.text()).toContain('مدیر کل')
    expect(wrapper.text()).toContain('09121234567')
    expect(wrapper.get('[data-testid="success-badge"]').text()).toBe('موفق')
  })

  it('renders a failure badge for success=false rows', async () => {
    fetchMock.mockResolvedValue({
      data: { items: [{ ...row, id: 'a2', success: false }], total: 1, page: 1, pageSize: 20 },
      error: null,
    })
    const wrapper = mount(AuditLogView, mountOptions)
    await flushPromises()

    expect(wrapper.get('[data-testid="success-badge"]').text()).toBe('ناموفق')
  })

  it('applies the action filter and re-queries from page 1', async () => {
    fetchMock.mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(AuditLogView, mountOptions)
    await flushPromises()

    wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'category.delete')
    await flushPromises()

    expect(fetchMock).toHaveBeenLastCalledWith('/admin/audit-log?page=1&pageSize=20&action=category.delete', {
      silent: true,
    })
  })

  it('shows an empty state when nothing matches', async () => {
    fetchMock.mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(AuditLogView, mountOptions)
    await flushPromises()

    expect(wrapper.text()).toContain('اقدامی با این فیلترها ثبت نشده است.')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @arayeshgah/admin-panel test -- src/pages/AuditLogView.spec.ts`
Expected: FAIL — `Failed to resolve import "./AuditLogView.vue"`.

- [ ] **Step 3: Implement `AuditLogView.vue`**

```vue
<!-- apps/admin-panel/src/pages/AuditLogView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { debounce } from '@/utils/debounce'
import { auditActionLabel } from '@/utils/labels'

// The nine audited admin mutations -- keep in sync with the backend's @AuditAction() names.
const AUDIT_ACTIONS = [
  'salon.status.set',
  'salon.featured.set',
  'user.status.set',
  'review.moderate',
  'category.create',
  'category.update',
  'category.delete',
  'config.update',
  'report.resolve',
]

const ACTION_OPTIONS = [
  { value: '', label: 'همه اقدامات' },
  ...AUDIT_ACTIONS.map((action) => ({ value: action, label: auditActionLabel(action).label })),
]

const TARGET_TYPE_FA: Record<string, string> = {
  salon: 'آرایشگاه',
  user: 'کاربر',
  review: 'نظر',
  category: 'دسته‌بندی',
  config: 'تنظیمات',
  report: 'گزارش',
}

interface AuditRow {
  id: string
  actorId: string
  actorPhone: string
  actorName: string | null
  action: string
  targetType: string
  targetId: string | null
  success: boolean
  createdAt: string
}

interface AuditListResponse {
  items: AuditRow[]
  total: number
  page: number
  pageSize: number
}

const { apiFetch } = useApi()
const rows = ref<AuditRow[]>([])
const loading = ref(true)
const page = ref(1)
const total = ref(0)
const pageSize = 20

const actionFilter = ref('')
const actorFilter = ref('')
const fromDate = ref('')
const toDate = ref('')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function load() {
  loading.value = true
  const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) })
  if (actionFilter.value) params.set('action', actionFilter.value)
  // The backend DTO validates actorId with @IsUUID() (400 otherwise), so only send it
  // once the input is a complete UUID; partial input just doesn't filter yet.
  if (UUID_RE.test(actorFilter.value.trim())) params.set('actorId', actorFilter.value.trim())
  if (fromDate.value) params.set('from', new Date(fromDate.value).toISOString())
  if (toDate.value) params.set('to', new Date(`${toDate.value}T23:59:59.999`).toISOString())

  const { data } = await apiFetch<AuditListResponse>(`/admin/audit-log?${params.toString()}`, { silent: true })
  rows.value = data?.items ?? []
  total.value = data?.total ?? 0
  loading.value = false
}

function loadFromFilterChange() {
  page.value = 1 // any filter change invalidates the current page position
  load()
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function targetLabel(row: AuditRow): string {
  return TARGET_TYPE_FA[row.targetType] ?? row.targetType
}

function clearFilters() {
  actionFilter.value = ''
  actorFilter.value = ''
  fromDate.value = ''
  toDate.value = ''
}

const hasActiveFilters = computed(
  () => !!actionFilter.value || !!actorFilter.value || !!fromDate.value || !!toDate.value,
)

onMounted(load)
// actorFilter is free-text (fires per keystroke) -- debounced like SalonsView's name filter.
watch(actorFilter, debounce(loadFromFilterChange, 350))
watch([actionFilter, fromDate, toDate], loadFromFilterChange)
watch(page, load)
</script>

<template>
  <div class="space-y-5 p-8">
    <AppCard :padded="false" class="p-4">
      <div class="flex flex-wrap items-end gap-3">
        <div data-testid="action-filter">
          <label class="mb-1.5 block text-xs font-semibold text-(--color-muted)">اقدام</label>
          <AppSelect v-model="actionFilter" :options="ACTION_OPTIONS" width="13rem" />
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-muted)">شناسه مدیر (UUID)</label>
          <div class="relative">
            <AppIcon name="search" :size="16" class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--color-muted)" />
            <input
              v-model="actorFilter"
              placeholder="شناسه کامل را وارد کنید"
              class="w-52 rounded-xl border border-(--color-border) py-2 ps-9 pe-3 text-sm"
              dir="ltr"
            />
          </div>
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-muted)">بازه زمانی</label>
          <div class="flex items-center gap-1.5">
            <JalaliDatePicker v-model="fromDate" placeholder="از تاریخ" class="w-32" />
            <span class="text-(--color-muted)">تا</span>
            <JalaliDatePicker v-model="toDate" placeholder="تا تاریخ" class="w-32" />
          </div>
        </div>
        <button
          v-if="hasActiveFilters"
          type="button"
          class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-(--color-muted) transition-colors hover:text-(--tone-danger-text)"
          @click="clearFilters"
        >
          <AppIcon name="reset" :size="15" />
          پاک کردن فیلترها
        </button>
      </div>
    </AppCard>

    <EmptyState v-if="!loading && rows.length === 0" icon="history" message="اقدامی با این فیلترها ثبت نشده است." />

    <AppCard v-else :padded="false" class="overflow-hidden">
      <table class="w-full text-right text-sm">
        <thead>
          <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-muted)">
            <th class="px-5 py-3 font-semibold">زمان</th>
            <th class="px-5 py-3 font-semibold">مدیر</th>
            <th class="px-5 py-3 font-semibold">اقدام</th>
            <th class="px-5 py-3 font-semibold">هدف</th>
            <th class="px-5 py-3 font-semibold">نتیجه</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
            class="border-b border-(--color-border-soft) transition-colors last:border-0 hover:bg-(--color-border-soft)"
          >
            <td class="tnum px-5 py-3.5 text-(--color-muted)">{{ formatDateTime(row.createdAt) }}</td>
            <td class="px-5 py-3.5">
              <p class="font-semibold text-(--color-text)">{{ row.actorName ?? '—' }}</p>
              <p class="tnum text-xs text-(--color-muted)">{{ row.actorPhone }}</p>
            </td>
            <td class="px-5 py-3.5">
              <StatusBadge :label="auditActionLabel(row.action).label" :tone="auditActionLabel(row.action).tone" />
            </td>
            <td class="px-5 py-3.5">
              <RouterLink
                v-if="row.targetType === 'salon' && row.targetId"
                :to="`/salons/${row.targetId}`"
                class="font-semibold text-(--color-text) hover:text-(--color-accent)"
              >
                {{ targetLabel(row) }}
              </RouterLink>
              <span v-else class="text-(--color-muted)">{{ targetLabel(row) }}</span>
              <p v-if="row.targetId" dir="ltr" class="tnum text-right text-xs text-(--color-muted)">
                {{ row.targetId.slice(0, 8) }}…
              </p>
            </td>
            <td class="px-5 py-3.5">
              <StatusBadge
                data-testid="success-badge"
                :label="row.success ? 'موفق' : 'ناموفق'"
                :tone="row.success ? 'success' : 'danger'"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
    </AppCard>
  </div>
</template>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @arayeshgah/admin-panel test -- src/pages/AuditLogView.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Register the route**

In `apps/admin-panel/src/router/index.ts`, add the audit-log child between `users` and `config` (currently lines 19-20):

```typescript
      { path: 'users', name: 'users', component: () => import('@/pages/UsersView.vue'), meta: { title: 'کاربران' } },
      { path: 'audit-log', name: 'audit-log', component: () => import('@/pages/AuditLogView.vue'), meta: { title: 'تاریخچه اقدامات' } },
      { path: 'config', name: 'config', component: () => import('@/pages/ConfigView.vue'), meta: { title: 'تنظیمات پلتفرم' } },
```

- [ ] **Step 6: Add the sidebar entry**

In `apps/admin-panel/src/components/layout/SidebarNav.vue`, extend `LINKS` (currently lines 6-13) — insert between the users and config entries:

```typescript
const LINKS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'داشبورد', icon: 'dashboard' },
  { to: '/salons', label: 'آرایشگاه‌ها', icon: 'salons' },
  { to: '/reviews', label: 'نظرات', icon: 'reviews' },
  { to: '/categories', label: 'دسته‌بندی‌ها', icon: 'categories' },
  { to: '/users', label: 'کاربران', icon: 'users' },
  { to: '/audit-log', label: 'تاریخچه اقدامات', icon: 'history' },
  { to: '/config', label: 'تنظیمات', icon: 'config' },
]
```

- [ ] **Step 7: Full check and commit**

Run: `pnpm --filter @arayeshgah/admin-panel test` — expected: all suites pass (the router spec asserts on existing routes only and is unaffected by an added child).
Run: `pnpm --filter @arayeshgah/admin-panel typecheck` — expected: clean.

```bash
git add apps/admin-panel/src/pages/AuditLogView.vue apps/admin-panel/src/pages/AuditLogView.spec.ts apps/admin-panel/src/router/index.ts apps/admin-panel/src/components/layout/SidebarNav.vue
git commit -m "feat(admin-panel): audit log page with action/actor/date filters and pagination"
```

---

### Task 19: Reports queue page + dashboard stat

**Files:**
- Create: `apps/admin-panel/src/components/reports/ResolveReportActions.vue`
- Test: `apps/admin-panel/src/components/reports/ResolveReportActions.spec.ts` (create)
- Create: `apps/admin-panel/src/pages/ReportsView.vue`
- Test: `apps/admin-panel/src/pages/ReportsView.spec.ts` (create)
- Modify: `apps/admin-panel/src/router/index.ts` (:17 — after the `reviews` child)
- Modify: `apps/admin-panel/src/components/layout/SidebarNav.vue` (:6-14 — `LINKS`)
- Modify: `apps/admin-panel/src/pages/DashboardView.vue` (:33-38 state, :79-92 stats/quick-links, :212-228 `onMounted`, :233 stat grid class)

A ReviewsView clone over `GET /admin/reports` (spec §3.3). List items carry joined display fields `salonName`, `reporterPhone`, and — when the report targets a review — `reviewRating`/`reviewComment`, matching the response shape defined in the reports backend task. `PATCH /admin/reports/:id` takes `{ status: 'resolved' | 'dismissed', note? }`; the note is optional, so the action component's inline expansion submits without a `note` key when the textarea is left empty. The status filter always sends an explicit `status` (default `open`) — no "all" option, since the backend treats an absent status as `open`.

DashboardView is intentionally left without a colocated spec: it mounts ECharts canvases, which happy-dom cannot render — the stat addition is covered by typecheck plus the ReportsView spec exercising the same endpoint.

- [ ] **Step 1: Write the failing action-component test**

```typescript
// apps/admin-panel/src/components/reports/ResolveReportActions.spec.ts
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ResolveReportActions from './ResolveReportActions.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

describe('ResolveReportActions', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('expands for an optional note and resolves with it', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'r1', status: 'resolved' }, error: null })
    const wrapper = mount(ResolveReportActions, { props: { reportId: 'r1' } })

    await wrapper.get('[data-testid="resolve-button"]').trigger('click')
    expect(fetchMock).not.toHaveBeenCalled() // expanding is not yet a mutation

    await wrapper.get('[data-testid="note-input"]').setValue('با مالک سالن تماس گرفته شد')
    await wrapper.get('[data-testid="submit-resolution"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/reports/r1', {
      method: 'PATCH',
      body: { status: 'resolved', note: 'با مالک سالن تماس گرفته شد' },
    })
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 'r1', status: 'resolved' }])
  })

  it('dismisses without a note, omitting the note key entirely', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'r1', status: 'dismissed' }, error: null })
    const wrapper = mount(ResolveReportActions, { props: { reportId: 'r1' } })

    await wrapper.get('[data-testid="dismiss-button"]').trigger('click')
    await wrapper.get('[data-testid="submit-resolution"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/reports/r1', {
      method: 'PATCH',
      body: { status: 'dismissed' },
    })
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 'r1', status: 'dismissed' }])
  })

  it('cancelling collapses back to the action buttons without a request', async () => {
    const wrapper = mount(ResolveReportActions, { props: { reportId: 'r1' } })

    await wrapper.get('[data-testid="resolve-button"]').trigger('click')
    await wrapper.get('[data-testid="cancel-resolution"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="resolve-button"]').exists()).toBe(true)
  })

  it('disables submit while the request is in flight', async () => {
    let resolveFetch!: (value: { data: { id: string; status: string }; error: null }) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const wrapper = mount(ResolveReportActions, { props: { reportId: 'r1' } })

    await wrapper.get('[data-testid="dismiss-button"]').trigger('click')
    const submit = wrapper.get('[data-testid="submit-resolution"]')
    await submit.trigger('click')

    expect((submit.element as HTMLButtonElement).disabled).toBe(true)

    // A second click while still in flight must not fire a duplicate request.
    await submit.trigger('click')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch({ data: { id: 'r1', status: 'dismissed' }, error: null })
    await flushPromises()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @arayeshgah/admin-panel test -- src/components/reports/ResolveReportActions.spec.ts`
Expected: FAIL — `Failed to resolve import "./ResolveReportActions.vue"`.

- [ ] **Step 3: Implement `ResolveReportActions.vue`**

Same inline expand pattern as `SalonStatusActions`, but the note is optional (spec §3.3: `note?`).

```vue
<!-- apps/admin-panel/src/components/reports/ResolveReportActions.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{ reportId: string }>()

const emit = defineEmits<{ updated: [report: { id: string; status: string }] }>()

const { apiFetch } = useApi()
const showNoteFor = ref<'resolved' | 'dismissed' | null>(null)
const note = ref('')
const submitting = ref(false)

function openNote(target: 'resolved' | 'dismissed') {
  showNoteFor.value = target
  note.value = ''
}

async function submit() {
  const target = showNoteFor.value!
  submitting.value = true
  const body: { status: 'resolved' | 'dismissed'; note?: string } = { status: target }
  if (note.value.trim()) body.note = note.value.trim()
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/reports/${props.reportId}`, {
    method: 'PATCH',
    body,
  })
  submitting.value = false
  if (data) {
    showNoteFor.value = null
    emit('updated', data)
  }
}
</script>

<template>
  <div>
    <div v-if="!showNoteFor" class="flex flex-wrap gap-2.5">
      <button
        data-testid="resolve-button"
        type="button"
        :disabled="submitting"
        class="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        @click="openNote('resolved')"
      >
        <AppIcon name="check" :size="16" />
        رسیدگی شد
      </button>
      <button
        data-testid="dismiss-button"
        type="button"
        :disabled="submitting"
        class="inline-flex items-center gap-2 rounded-xl border border-(--tone-danger-text) px-4 py-2.5 text-sm font-semibold text-(--tone-danger-text) transition-colors hover:bg-(--tone-danger-bg) disabled:opacity-40"
        @click="openNote('dismissed')"
      >
        <AppIcon name="x" :size="16" />
        رد گزارش
      </button>
    </div>

    <div v-else class="space-y-3">
      <label class="block text-sm font-semibold text-(--color-text)">
        یادداشت {{ showNoteFor === 'resolved' ? 'رسیدگی' : 'رد گزارش' }} (اختیاری)
      </label>
      <textarea
        v-model="note"
        data-testid="note-input"
        placeholder="در صورت نیاز، توضیح تصمیم را بنویسید…"
        rows="2"
        class="w-full rounded-xl border border-(--color-border) p-3 text-sm"
      />
      <div class="flex gap-2.5">
        <button
          data-testid="submit-resolution"
          type="button"
          :disabled="submitting"
          class="rounded-xl bg-(--color-accent) px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          @click="submit"
        >
          ثبت نهایی
        </button>
        <button
          data-testid="cancel-resolution"
          type="button"
          :disabled="submitting"
          class="rounded-xl border border-(--color-border) px-4 py-2.5 text-sm font-semibold text-(--color-muted) transition-colors hover:bg-(--color-border-soft)"
          @click="showNoteFor = null"
        >
          انصراف
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Run the action test to verify it passes**

Run: `pnpm --filter @arayeshgah/admin-panel test -- src/components/reports/ResolveReportActions.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing page test**

```typescript
// apps/admin-panel/src/pages/ReportsView.spec.ts
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReportsView from './ReportsView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const mountOptions = { global: { stubs: { RouterLink: RouterLinkStub } } }

const report = {
  id: 'r1',
  reason: 'اطلاعات این سالن واقعی نیست',
  status: 'open',
  salonId: 's1',
  salonName: 'سالن نمونه',
  reporterPhone: '09121234567',
  reviewId: null,
  reviewRating: null,
  reviewComment: null,
  resolutionNote: null,
  createdAt: '2026-07-10T08:00:00.000Z',
}

describe('ReportsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads open reports by default, rendering reason, reporter, and a salon link', async () => {
    fetchMock.mockResolvedValue({ data: { items: [{ ...report }], total: 1, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/reports?status=open&page=1&pageSize=10', { silent: true })
    expect(wrapper.text()).toContain('اطلاعات این سالن واقعی نیست')
    expect(wrapper.text()).toContain('09121234567')
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/salons/s1')
    // Status renders through the Farsi label map.
    expect(wrapper.text()).toContain('باز')
  })

  it('quotes the reported review when the report targets a review', async () => {
    fetchMock.mockResolvedValue({
      data: {
        items: [{ ...report, reviewId: 'rev1', reviewRating: 1, reviewComment: 'برخورد بسیار بد بود' }],
        total: 1,
        page: 1,
        pageSize: 10,
      },
      error: null,
    })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="quoted-review"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="quoted-review"]').text()).toContain('برخورد بسیار بد بود')
  })

  it('does not render a quoted review block for salon-targeted reports', async () => {
    fetchMock.mockResolvedValue({ data: { items: [{ ...report }], total: 1, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="quoted-review"]').exists()).toBe(false)
  })

  it('updates the card status in place after a resolve', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: { items: [{ ...report }], total: 1, page: 1, pageSize: 10 }, error: null })
      .mockResolvedValueOnce({ data: { id: 'r1', status: 'resolved' }, error: null })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    await wrapper.get('[data-testid="resolve-button"]').trigger('click')
    await wrapper.get('[data-testid="submit-resolution"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('رسیدگی شده')
    // A non-open report offers no further actions.
    expect(wrapper.find('[data-testid="resolve-button"]').exists()).toBe(false)
  })

  it('shows an empty state when the queue is clear', async () => {
    fetchMock.mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    expect(wrapper.text()).toContain('گزارشی با این وضعیت وجود ندارد.')
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @arayeshgah/admin-panel test -- src/pages/ReportsView.spec.ts`
Expected: FAIL — `Failed to resolve import "./ReportsView.vue"`.

- [ ] **Step 7: Implement `ReportsView.vue`**

```vue
<!-- apps/admin-panel/src/pages/ReportsView.vue -->
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import ResolveReportActions from '@/components/reports/ResolveReportActions.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { reportStatusLabel } from '@/utils/labels'

// Always an explicit status -- the backend defaults an absent status to 'open',
// so an "all" option would be a lie; the queue is worked one bucket at a time.
const STATUS_OPTIONS = [
  { value: 'open', label: 'باز' },
  { value: 'resolved', label: 'رسیدگی شده' },
  { value: 'dismissed', label: 'رد شده' },
]

interface ReportRow {
  id: string
  reason: string
  status: 'open' | 'resolved' | 'dismissed'
  salonId: string
  salonName: string
  reporterPhone: string
  reviewId: string | null
  reviewRating: number | null
  reviewComment: string | null
  resolutionNote: string | null
  createdAt: string
}

interface ReportListResponse {
  items: ReportRow[]
  total: number
  page: number
  pageSize: number
}

const { apiFetch } = useApi()
const reports = ref<ReportRow[]>([])
const loading = ref(true)
const page = ref(1)
const total = ref(0)
const pageSize = 10

const statusFilter = ref<'open' | 'resolved' | 'dismissed'>('open')

async function load() {
  loading.value = true
  const params = new URLSearchParams({
    status: statusFilter.value,
    page: String(page.value),
    pageSize: String(pageSize),
  })
  const { data } = await apiFetch<ReportListResponse>(`/admin/reports?${params.toString()}`, { silent: true })
  reports.value = data?.items ?? []
  total.value = data?.total ?? 0
  loading.value = false
}

function loadFromFilterChange() {
  page.value = 1
  load()
}

function onUpdated(reportId: string, status: string) {
  const report = reports.value.find((r) => r.id === reportId)
  if (report) report.status = status as ReportRow['status']
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
}

onMounted(load)
watch(statusFilter, loadFromFilterChange)
watch(page, load)
</script>

<template>
  <div class="space-y-5 p-8">
    <AppCard :padded="false" class="p-4">
      <div class="flex flex-wrap items-end gap-3">
        <div data-testid="status-filter">
          <label class="mb-1.5 block text-xs font-semibold text-(--color-muted)">وضعیت</label>
          <AppSelect v-model="statusFilter" :options="STATUS_OPTIONS" width="10rem" />
        </div>
      </div>
    </AppCard>

    <EmptyState v-if="!loading && reports.length === 0" icon="flag" message="گزارشی با این وضعیت وجود ندارد." />

    <div v-else class="space-y-3">
      <AppCard v-for="report in reports" :key="report.id" data-testid="report-card">
        <div class="flex items-start justify-between gap-4">
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="tnum font-semibold text-(--color-text)">{{ report.reporterPhone }}</span>
            <span class="text-(--color-muted)">درباره</span>
            <RouterLink :to="`/salons/${report.salonId}`" class="font-semibold text-(--color-accent) hover:opacity-80">
              {{ report.salonName }}
            </RouterLink>
          </div>
          <StatusBadge :label="reportStatusLabel(report.status).label" :tone="reportStatusLabel(report.status).tone" />
        </div>

        <p class="mt-3 text-sm leading-6 text-(--color-text)">{{ report.reason }}</p>

        <div v-if="report.reviewId" data-testid="quoted-review" class="mt-3 rounded-xl bg-(--color-border-soft) p-3">
          <p class="mb-1 flex items-center gap-1.5 text-xs font-semibold text-(--color-muted)">
            <AppIcon name="star" :size="13" />
            نظر گزارش‌شده — امتیاز {{ report.reviewRating }}
          </p>
          <p class="text-sm text-(--color-text)">{{ report.reviewComment ?? '(بدون متن)' }}</p>
        </div>

        <div v-if="report.resolutionNote" class="mt-3 rounded-xl bg-(--color-border-soft) p-3">
          <p class="mb-1 text-xs font-semibold text-(--color-muted)">یادداشت رسیدگی</p>
          <p class="text-sm text-(--color-text)">{{ report.resolutionNote }}</p>
        </div>

        <p class="tnum mt-3 text-xs text-(--color-muted)">{{ formatDate(report.createdAt) }}</p>

        <div v-if="report.status === 'open'" class="mt-4 border-t border-(--color-border-soft) pt-3.5">
          <ResolveReportActions :report-id="report.id" @updated="(r) => onUpdated(r.id, r.status)" />
        </div>
      </AppCard>
    </div>

    <AppCard v-if="!loading && reports.length > 0" :padded="false">
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
    </AppCard>
  </div>
</template>
```

- [ ] **Step 8: Run the page test to verify it passes**

Run: `pnpm --filter @arayeshgah/admin-panel test -- src/pages/ReportsView.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Register the route and sidebar entry**

In `apps/admin-panel/src/router/index.ts`, add the reports child right after the `reviews` line (currently line 17):

```typescript
      { path: 'reviews', name: 'reviews', component: () => import('@/pages/ReviewsView.vue'), meta: { title: 'نظرات' } },
      { path: 'reports', name: 'reports', component: () => import('@/pages/ReportsView.vue'), meta: { title: 'گزارش‌ها' } },
```

In `apps/admin-panel/src/components/layout/SidebarNav.vue`, `LINKS` becomes (audit-log entry present from Task 18):

```typescript
const LINKS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'داشبورد', icon: 'dashboard' },
  { to: '/salons', label: 'آرایشگاه‌ها', icon: 'salons' },
  { to: '/reviews', label: 'نظرات', icon: 'reviews' },
  { to: '/reports', label: 'گزارش‌ها', icon: 'flag' },
  { to: '/categories', label: 'دسته‌بندی‌ها', icon: 'categories' },
  { to: '/users', label: 'کاربران', icon: 'users' },
  { to: '/audit-log', label: 'تاریخچه اقدامات', icon: 'history' },
  { to: '/config', label: 'تنظیمات', icon: 'config' },
]
```

- [ ] **Step 10: Add the open-reports stat card and quick link to `DashboardView.vue`**

Four edits in `apps/admin-panel/src/pages/DashboardView.vue`:

**(a)** State — after `const categoryCount = ref(0)` (line 38), add:

```typescript
const openReportCount = ref(0)
```

**(b)** Stats — the `stats` computed (lines 79-84) gains a fifth entry:

```typescript
const stats = computed<Stat[]>(() => [
  { label: 'در انتظار بررسی', value: pendingSalons.value, icon: 'salons', tone: 'warning', to: '/salons' },
  { label: 'گزارش‌های باز', value: openReportCount.value, icon: 'flag', tone: 'danger', to: '/reports' },
  { label: 'کاربران معلق', value: suspendedUsers.value, icon: 'users', tone: 'danger', to: '/users' },
  { label: 'نظرات منتشر شده', value: publishedReviews.value, icon: 'reviews', tone: 'success', to: '/reviews' },
  { label: 'دسته‌بندی‌های خدمات', value: categoryCount.value, icon: 'categories', tone: 'info', to: '/categories' },
])
```

And `QUICK_LINKS` (lines 86-92) gains an entry after `/reviews`:

```typescript
const QUICK_LINKS: { to: string; label: string; icon: IconName; desc: string }[] = [
  { to: '/salons', label: 'آرایشگاه‌ها', icon: 'salons', desc: 'بررسی، تایید و رد درخواست‌ها' },
  { to: '/reviews', label: 'نظرات', icon: 'reviews', desc: 'مدیریت و تعدیل نظرات کاربران' },
  { to: '/reports', label: 'گزارش‌ها', icon: 'flag', desc: 'رسیدگی به گزارش‌های کاربران' },
  { to: '/categories', label: 'دسته‌بندی‌ها', icon: 'categories', desc: 'افزودن و ویرایش خدمات' },
  { to: '/users', label: 'کاربران', icon: 'users', desc: 'جست‌وجو و مدیریت وضعیت کاربران' },
  { to: '/config', label: 'تنظیمات پلتفرم', icon: 'config', desc: 'مقادیر پیش‌پرداخت، کمیسیون و...' },
]
```

**(c)** Loading — the `onMounted` `Promise.all` (lines 212-228) gains a fifth fetch; only the `total` is needed, so `pageSize=1` keeps it cheap:

```typescript
onMounted(async () => {
  // Salons/reviews are paginated endpoints (see SalonsView/ReviewsView) -- the dashboard
  // charts need the full distribution, not one page of it, so pageSize is set to the
  // backend's own max (100). Fine for this admin tool's scale; would need a dedicated
  // aggregate/stats endpoint if the dataset ever meaningfully exceeds that.
  const [salonsRes, usersRes, reviewsRes, categoriesRes, reportsRes] = await Promise.all([
    apiFetch<{ items: SalonRow[]; total: number }>('/admin/salons?status=all&pageSize=100', { silent: true }),
    apiFetch<UserRow[]>('/admin/users', { silent: true }),
    apiFetch<{ items: ReviewRow[]; total: number }>('/admin/reviews?pageSize=100', { silent: true }),
    apiFetch<CategoryRow[]>('/categories', { silent: true }),
    // Only the total matters for the stat card -- pageSize=1 keeps the payload minimal.
    apiFetch<{ items: unknown[]; total: number }>('/admin/reports?status=open&pageSize=1', { silent: true }),
  ])
  salons.value = salonsRes.data?.items ?? []
  users.value = usersRes.data ?? []
  reviews.value = reviewsRes.data?.items ?? []
  categoryCount.value = categoriesRes.data?.length ?? 0
  openReportCount.value = reportsRes.data?.total ?? 0
  loading.value = false
})
```

**(d)** Grid — the stat grid (line 233) grows to five columns on large screens:

```html
    <div class="grid grid-cols-2 gap-4 lg:grid-cols-5">
```

- [ ] **Step 11: Full check and commit**

Run: `pnpm --filter @arayeshgah/admin-panel test` — expected: all suites pass.
Run: `pnpm --filter @arayeshgah/admin-panel typecheck` — expected: clean.

```bash
git add apps/admin-panel/src/components/reports apps/admin-panel/src/pages/ReportsView.vue apps/admin-panel/src/pages/ReportsView.spec.ts apps/admin-panel/src/router/index.ts apps/admin-panel/src/components/layout/SidebarNav.vue apps/admin-panel/src/pages/DashboardView.vue
git commit -m "feat(admin-panel): reports queue with resolve/dismiss actions and dashboard open-reports stat"
```

---

### Task 20: Category delete with inline confirm

**Files:**
- Modify: `apps/admin-panel/src/pages/CategoriesView.vue` (:14-69 script, :103-143 card grid)
- Test: `apps/admin-panel/src/pages/CategoriesView.spec.ts` (create)

Per-row delete with the inline expand-to-confirm pattern (same shape as `SalonStatusActions`' reason expansion: the row's controls swap for a confirm strip, nothing is deleted until the second click). `DELETE /admin/categories/:id` is called **without** `silent`, so the backend's 409 «این دسته‌بندی توسط خدمات سالن‌ها استفاده می‌شود و قابل حذف نیست» surfaces through `useApi`'s standard toast; on a 204 (i.e. `error === null`) the row is removed locally.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/admin-panel/src/pages/CategoriesView.spec.ts
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CategoriesView from './CategoriesView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const categories = [
  { id: 1, name: 'اصلاح مو', icon: 'scissors' },
  { id: 2, name: 'رنگ مو', icon: 'palette' },
]

async function mountView() {
  const wrapper = mount(CategoriesView)
  await flushPromises()
  return wrapper
}

describe('CategoriesView delete', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    // Fresh copies per test -- the component mutates its local array on delete.
    fetchMock.mockResolvedValueOnce({ data: categories.map((c) => ({ ...c })), error: null })
  })

  it('expands to an inline confirm without deleting anything yet', async () => {
    const wrapper = await mountView()

    await wrapper.findAll('[data-testid="delete-category"]')[0].trigger('click')

    expect(wrapper.find('[data-testid="confirm-delete"]').exists()).toBe(true)
    // Only the initial GET /categories has fired.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await wrapper.get('[data-testid="cancel-delete"]').trigger('click')
    expect(wrapper.find('[data-testid="confirm-delete"]').exists()).toBe(false)
  })

  it('deletes on confirm and removes the row on success', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: null }) // 204
    const wrapper = await mountView()

    await wrapper.findAll('[data-testid="delete-category"]')[0].trigger('click')
    await wrapper.get('[data-testid="confirm-delete"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/categories/1', { method: 'DELETE' })
    expect(wrapper.text()).not.toContain('اصلاح مو')
    expect(wrapper.text()).toContain('رنگ مو')
  })

  it('keeps the row when the API answers 409 (category in use)', async () => {
    fetchMock.mockResolvedValueOnce({
      data: null,
      error: { status: 409, message: 'این دسته‌بندی توسط خدمات سالن‌ها استفاده می‌شود و قابل حذف نیست' },
    })
    const wrapper = await mountView()

    await wrapper.findAll('[data-testid="delete-category"]')[0].trigger('click')
    await wrapper.get('[data-testid="confirm-delete"]').trigger('click')
    await flushPromises()

    // The toast comes from the real useApi (not silent); here we only assert the row survives
    // and the confirm strip collapsed.
    expect(wrapper.text()).toContain('اصلاح مو')
    expect(wrapper.find('[data-testid="confirm-delete"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @arayeshgah/admin-panel test -- src/pages/CategoriesView.spec.ts`
Expected: FAIL — `Cannot call trigger on an empty DOMWrapper` (no `[data-testid="delete-category"]` exists yet).

- [ ] **Step 3: Add delete state and handler to the script**

In `apps/admin-panel/src/pages/CategoriesView.vue`, extend the state block (after `const submitting = ref(false)`, line 20):

```typescript
const submitting = ref(false)
const confirmingId = ref<number | null>(null)
```

Replace `startEdit` (lines 50-53) so opening an edit cancels any pending confirm, and add the delete pair after `saveEdit` (line 67):

```typescript
function startEdit(category: Category) {
  editingId.value = category.id
  editName.value = category.name
  confirmingId.value = null
}
```

```typescript
function askDelete(category: Category) {
  confirmingId.value = category.id
  editingId.value = null
}

async function confirmDelete() {
  const id = confirmingId.value
  if (id === null) return
  submitting.value = true
  // Deliberately NOT silent: a category still referenced by salon services comes back as a
  // 409 with a Farsi message, which useApi surfaces through the standard toast path.
  const { error } = await apiFetch(`/admin/categories/${id}`, { method: 'DELETE' })
  submitting.value = false
  confirmingId.value = null
  if (!error) categories.value = categories.value.filter((c) => c.id !== id)
}
```

- [ ] **Step 4: Rework the card row template**

Replace the per-category `AppCard` body (currently lines 106-141) with the confirm-aware version — the icon block stays, the name/actions swap for a confirm strip while `confirmingId` matches:

```html
        <AppCard
          v-for="category in categories"
          :key="category.id"
          :padded="false"
          class="flex items-center gap-3 p-3.5 transition-shadow hover:shadow-(--shadow-pop)"
        >
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--color-border-soft) text-(--color-accent)">
            <AppIcon :name="iconFor(category.icon)" :size="19" />
          </div>

          <template v-if="confirmingId === category.id">
            <span class="min-w-0 flex-1 truncate text-sm font-semibold text-(--tone-danger-text)">
              «{{ category.name }}» حذف شود؟
            </span>
            <button
              data-testid="confirm-delete"
              type="button"
              :disabled="submitting"
              class="shrink-0 text-sm font-semibold text-(--tone-danger-text) disabled:opacity-40"
              @click="confirmDelete"
            >
              حذف
            </button>
            <button
              data-testid="cancel-delete"
              type="button"
              :disabled="submitting"
              class="shrink-0 text-sm font-semibold text-(--color-muted) disabled:opacity-40"
              @click="confirmingId = null"
            >
              انصراف
            </button>
          </template>

          <template v-else>
            <input
              v-if="editingId === category.id"
              v-model="editName"
              maxlength="60"
              class="min-w-0 flex-1 rounded-lg border border-(--color-border) p-1.5 text-sm"
            />
            <span v-else class="min-w-0 flex-1 truncate text-sm font-semibold text-(--color-text)">{{ category.name }}</span>
            <button
              v-if="editingId === category.id"
              type="button"
              :disabled="submitting"
              class="shrink-0 text-sm font-semibold text-(--color-accent) disabled:opacity-40"
              @click="saveEdit"
            >
              ذخیره
            </button>
            <template v-else>
              <button
                type="button"
                :disabled="submitting"
                class="shrink-0 rounded-lg p-1.5 text-(--color-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-accent) disabled:opacity-40"
                title="ویرایش"
                @click="startEdit(category)"
              >
                <AppIcon name="pencil" :size="15" />
              </button>
              <button
                data-testid="delete-category"
                type="button"
                :disabled="submitting"
                class="shrink-0 rounded-lg p-1.5 text-(--color-muted) transition-colors hover:bg-(--tone-danger-bg) hover:text-(--tone-danger-text) disabled:opacity-40"
                title="حذف"
                @click="askDelete(category)"
              >
                <AppIcon name="x" :size="15" />
              </button>
            </template>
          </template>
        </AppCard>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @arayeshgah/admin-panel test -- src/pages/CategoriesView.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Full check and commit**

Run: `pnpm --filter @arayeshgah/admin-panel test` — expected: all suites pass.
Run: `pnpm --filter @arayeshgah/admin-panel typecheck` — expected: clean.

```bash
git add apps/admin-panel/src/pages/CategoriesView.vue apps/admin-panel/src/pages/CategoriesView.spec.ts
git commit -m "feat(admin-panel): category delete with inline confirm and standard 409 toast"
```

---

### Task 21: Re-approve suspended salons, cascade cause line, cascade-aware suspend toasts

**Files:**
- Modify: `apps/admin-panel/src/components/salons/SalonStatusActions.vue` (:57-94 — action buttons block)
- Test: `apps/admin-panel/src/components/salons/SalonStatusActions.spec.ts` (:78-98 — extend)
- Modify: `apps/admin-panel/src/pages/SalonDetailView.vue` (:13-23 interface, :85-88 template)
- Test: `apps/admin-panel/src/pages/SalonDetailView.spec.ts` (:12-22 fixture, extend)
- Modify: `apps/admin-panel/src/components/users/SuspendUserButton.vue` (full script rewrite)
- Test: `apps/admin-panel/src/components/users/SuspendUserButton.spec.ts` (full rewrite — new `role` prop + toast mock)
- Modify: `apps/admin-panel/src/pages/UsersView.vue` (:152 — pass `:role` to `SuspendUserButton`)

Spec §3.5's admin-panel adjacent fixes. Today a suspended salon has no path back at all («اقدامی برای این وضعیت لازم نیست.»); this adds a re-approve action (the backend clears `suspended_cause` on approval). Rejected salons keep the provider-resubmit-only flow. `SalonDetailView` explains a cascade suspension (`suspendedCause === 'owner_suspended'`, a field the admin salon detail response gains in the cascade backend task), and `SuspendUserButton` toasts the salon cascade when the target user is a provider.

- [ ] **Step 1: Extend the SalonStatusActions spec with failing tests**

In `apps/admin-panel/src/components/salons/SalonStatusActions.spec.ts`, append inside the `describe('SalonStatusActions', ...)` block, after the existing `'suspends with a reason'` test (line 86-98):

```typescript
  it('offers a re-approve action for suspended salons', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 's1', status: 'approved' }, error: null })
    const wrapper = mount(SalonStatusActions, { props: { salonId: 's1', status: 'suspended' } })

    await wrapper.get('[data-testid="reapprove-button"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/status', {
      method: 'PATCH',
      body: { status: 'approved' },
    })
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 's1', status: 'approved' }])
  })

  it('keeps rejected salons on the provider-resubmit-only flow (no admin action)', () => {
    const wrapper = mount(SalonStatusActions, { props: { salonId: 's1', status: 'rejected' } })

    expect(wrapper.find('[data-testid="reapprove-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="approve-button"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('اقدامی برای این وضعیت لازم نیست.')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @arayeshgah/admin-panel test -- src/components/salons/SalonStatusActions.spec.ts`
Expected: FAIL — `Unable to get [data-testid="reapprove-button"]` (1 new test fails; the rejected-flow test passes already, which is fine — it pins existing behavior against regression).

- [ ] **Step 3: Add the re-approve action to `SalonStatusActions.vue`**

In the template's action-buttons block, after the suspend button (lines 81-90) and replacing the no-action paragraph (lines 91-93), the tail of the `v-if="!showReasonFor"` div becomes:

```html
      <button
        v-if="status === 'approved'"
        data-testid="suspend-button"
        type="button"
        :disabled="submitting"
        class="inline-flex items-center gap-2 rounded-xl border border-(--tone-danger-text) px-4 py-2.5 text-sm font-semibold text-(--tone-danger-text) transition-colors hover:bg-(--tone-danger-bg) disabled:opacity-40"
        @click="openReason('suspended')"
      >
        <AppIcon name="warning" :size="16" />
        تعلیق آرایشگاه
      </button>
      <button
        v-if="status === 'suspended'"
        data-testid="reapprove-button"
        type="button"
        :disabled="submitting"
        class="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        @click="approve"
      >
        <AppIcon name="check" :size="16" />
        رفع تعلیق و تایید مجدد
      </button>
      <p v-if="status === 'rejected'" class="text-sm text-(--color-muted)">
        اقدامی برای این وضعیت لازم نیست.
      </p>
```

(The existing `approve()` function is reused unchanged — the backend clears `suspended_cause` whenever a salon is approved.)

- [ ] **Step 4: Run the spec to verify it passes**

Run: `pnpm --filter @arayeshgah/admin-panel test -- src/components/salons/SalonStatusActions.spec.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Extend the SalonDetailView spec with failing tests**

In `apps/admin-panel/src/pages/SalonDetailView.spec.ts`, add the new field to the fixture (lines 12-22):

```typescript
const salon = {
  id: 's1',
  name: 'سالن نمونه',
  description: null,
  status: 'pending',
  genderTarget: 'women',
  address: 'خیابان اصلی',
  city: 'تهران',
  capacity: 3,
  rejectionReason: null,
  suspendedCause: null,
}
```

And append inside the `describe` block, after the existing 404 test (line 63-69):

```typescript
  it('explains the cascade cause when the salon was suspended via its owner', async () => {
    fetchMock.mockResolvedValueOnce({
      data: { ...salon, status: 'suspended', suspendedCause: 'owner_suspended' },
      error: null,
    })

    const wrapper = await mountWithRouter()

    expect(wrapper.find('[data-testid="suspended-cause"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('به دلیل تعلیق حساب مالک')
  })

  it('shows no cause line for a direct admin suspension', async () => {
    fetchMock.mockResolvedValueOnce({
      data: { ...salon, status: 'suspended', suspendedCause: 'admin' },
      error: null,
    })

    const wrapper = await mountWithRouter()

    expect(wrapper.find('[data-testid="suspended-cause"]').exists()).toBe(false)
  })
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @arayeshgah/admin-panel test -- src/pages/SalonDetailView.spec.ts`
Expected: FAIL — the cascade-cause test: `expected false to be true` (no `[data-testid="suspended-cause"]` element yet).

- [ ] **Step 7: Show the cause line in `SalonDetailView.vue`**

Extend the `SalonDetail` interface (lines 13-23):

```typescript
interface SalonDetail {
  id: string
  name: string
  description: string | null
  status: 'pending' | 'approved' | 'rejected' | 'suspended'
  genderTarget: 'women' | 'men'
  address: string
  city: string
  capacity: number
  rejectionReason: string | null
  suspendedCause: 'admin' | 'owner_suspended' | null
}
```

And in the template, directly after the `rejectionReason` block (lines 85-88), add:

```html
        <div v-if="salon.rejectionReason" class="mt-5 flex gap-2.5 rounded-xl bg-(--tone-danger-bg) p-3.5">
          <AppIcon name="warning" :size="17" class="mt-0.5 shrink-0 text-(--tone-danger-text)" />
          <p class="text-sm text-(--tone-danger-text)">{{ salon.rejectionReason }}</p>
        </div>

        <div
          v-if="salon.status === 'suspended' && salon.suspendedCause === 'owner_suspended'"
          data-testid="suspended-cause"
          class="mt-5 flex gap-2.5 rounded-xl bg-(--tone-warning-bg) p-3.5"
        >
          <AppIcon name="warning" :size="17" class="mt-0.5 shrink-0 text-(--tone-warning-text)" />
          <p class="text-sm text-(--tone-warning-text)">
            این آرایشگاه به دلیل تعلیق حساب مالک آن معلق شده است و با رفع تعلیق مالک، به‌صورت خودکار به حالت تایید بازمی‌گردد.
          </p>
        </div>
```

- [ ] **Step 8: Run the spec to verify it passes**

Run: `pnpm --filter @arayeshgah/admin-panel test -- src/pages/SalonDetailView.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Rewrite the SuspendUserButton spec for the role prop and cascade toasts**

Replace `apps/admin-panel/src/components/users/SuspendUserButton.spec.ts` in full:

```typescript
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SuspendUserButton from './SuspendUserButton.vue'

const fetchMock = vi.fn()
const pushMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ push: pushMock }),
}))

describe('SuspendUserButton', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    pushMock.mockReset()
  })

  it('shows a suspend action for an active user and calls the status endpoint', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'u1', status: 'suspended' }, error: null })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'active', role: 'customer' } })

    expect(wrapper.find('[data-testid="suspend-user"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="unsuspend-user"]').exists()).toBe(false)

    await wrapper.get('[data-testid="suspend-user"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/users/u1/status', { method: 'PATCH', body: { status: 'suspended' } })
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 'u1', status: 'suspended' }])
  })

  it('shows an unsuspend action for a suspended user and calls the status endpoint', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'u1', status: 'active' }, error: null })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'suspended', role: 'customer' } })

    expect(wrapper.find('[data-testid="unsuspend-user"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="suspend-user"]').exists()).toBe(false)

    await wrapper.get('[data-testid="unsuspend-user"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/users/u1/status', { method: 'PATCH', body: { status: 'active' } })
  })

  it('toasts the salon cascade when suspending a provider', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'u1', status: 'suspended' }, error: null })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'active', role: 'provider' } })

    await wrapper.get('[data-testid="suspend-user"]').trigger('click')
    await flushPromises()

    expect(pushMock).toHaveBeenCalledWith('کاربر معلق شد؛ آرایشگاه او نیز از دسترس عموم خارج شد.')
  })

  it('toasts the salon restore when reactivating a provider', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'u1', status: 'active' }, error: null })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'suspended', role: 'provider' } })

    await wrapper.get('[data-testid="unsuspend-user"]').trigger('click')
    await flushPromises()

    expect(pushMock).toHaveBeenCalledWith('کاربر فعال شد؛ آرایشگاهی که به دلیل تعلیق او معلق شده بود بازگردانده شد.')
  })

  it('uses a plain toast without cascade wording for non-providers', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'u1', status: 'suspended' }, error: null })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'active', role: 'customer' } })

    await wrapper.get('[data-testid="suspend-user"]').trigger('click')
    await flushPromises()

    expect(pushMock).toHaveBeenCalledWith('کاربر معلق شد.')
  })

  it('resets submitting without emitting updated or toasting when the request fails', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 409, message: 'boom' } })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'active', role: 'provider' } })

    const suspendButton = wrapper.get('[data-testid="suspend-user"]')
    await suspendButton.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('updated')).toBeUndefined()
    expect(pushMock).not.toHaveBeenCalled()
    expect((suspendButton.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('disables the action button while a request is in flight', async () => {
    let resolveFetch!: (value: { data: { id: string; status: string }; error: null }) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'active', role: 'customer' } })

    const suspendButton = wrapper.get('[data-testid="suspend-user"]')
    await suspendButton.trigger('click')

    expect((suspendButton.element as HTMLButtonElement).disabled).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A second click while still in flight must not fire a duplicate request.
    await suspendButton.trigger('click')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch({ data: { id: 'u1', status: 'suspended' }, error: null })
    await flushPromises()

    expect((suspendButton.element as HTMLButtonElement).disabled).toBe(false)
  })
})
```

- [ ] **Step 10: Run it to verify it fails**

Run: `pnpm --filter @arayeshgah/admin-panel test -- src/components/users/SuspendUserButton.spec.ts`
Expected: FAIL — the three toast tests: `expected "spy" to be called with arguments: [...]` / `Number of calls: 0` (the component does not toast yet).

- [ ] **Step 11: Add the role prop and cascade toasts to `SuspendUserButton.vue`**

Replace the `<script setup>` block in full (template is unchanged):

```vue
<!-- apps/admin-panel/src/components/users/SuspendUserButton.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{
  userId: string
  status: 'active' | 'suspended'
  role: 'customer' | 'provider' | 'admin'
}>()
const emit = defineEmits<{ updated: [user: { id: string; status: string }] }>()

const { apiFetch } = useApi()
const { push } = useToast()
const submitting = ref(false)

async function toggle() {
  submitting.value = true
  const target = props.status === 'active' ? 'suspended' : 'active'
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/users/${props.userId}/status`, {
    method: 'PATCH',
    body: { status: target },
  })
  submitting.value = false
  if (data) {
    // Providers get the cascade spelled out: suspending them also pulls their salon from
    // public listings, and reactivating restores only what the cascade itself suspended
    // (a salon an admin suspended directly stays suspended) -- spec §3.5.
    if (props.role === 'provider') {
      push(
        target === 'suspended'
          ? 'کاربر معلق شد؛ آرایشگاه او نیز از دسترس عموم خارج شد.'
          : 'کاربر فعال شد؛ آرایشگاهی که به دلیل تعلیق او معلق شده بود بازگردانده شد.',
      )
    } else {
      push(target === 'suspended' ? 'کاربر معلق شد.' : 'کاربر فعال شد.')
    }
    emit('updated', data)
  }
}
</script>
```

- [ ] **Step 12: Pass the role from `UsersView.vue`**

In `apps/admin-panel/src/pages/UsersView.vue`, the `SuspendUserButton` usage (line 152) becomes:

```html
            <td class="px-5 py-3.5">
              <SuspendUserButton :user-id="user.id" :status="user.status" :role="user.role" @updated="(u) => onUpdated(u.id, u.status)" />
            </td>
```

- [ ] **Step 13: Run the spec to verify it passes**

Run: `pnpm --filter @arayeshgah/admin-panel test -- src/components/users/SuspendUserButton.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 14: Full check and commit**

Run: `pnpm --filter @arayeshgah/admin-panel test` — expected: every admin-panel suite passes.
Run: `pnpm --filter @arayeshgah/admin-panel typecheck` — expected: clean (this also catches any `UsersView`/`SuspendUserButton` prop mismatch).

```bash
git add apps/admin-panel/src/components/salons/SalonStatusActions.vue apps/admin-panel/src/components/salons/SalonStatusActions.spec.ts apps/admin-panel/src/pages/SalonDetailView.vue apps/admin-panel/src/pages/SalonDetailView.spec.ts apps/admin-panel/src/components/users/SuspendUserButton.vue apps/admin-panel/src/components/users/SuspendUserButton.spec.ts apps/admin-panel/src/pages/UsersView.vue
git commit -m "feat(admin-panel): re-approve suspended salons, cascade cause line, cascade-aware suspend toasts"
```

### Task 22: User-app report form + salon-level report affordance

**Files:**
- Create: `apps/user-app/app/components/salon/ReportForm.vue`
- Test: `apps/user-app/test/nuxt/ReportForm.spec.ts`
- Modify: `apps/user-app/app/pages/salons/[slug].vue` (:69-84 script — favorites `onMounted` block; :141-142 template — after the reviews `</section>`)

The customer-facing half of §4.2: a small modal form (reason textarea, 5–500 chars with a counter) that `POST /api/reports`s, plus a low-key «گزارش این سالن» affordance on the salon profile page that only renders when `GET /reports/eligibility?salonId=` says `canReport`.

**Why this is `ReportForm.vue` and not `ReportForm.client.vue`:** the `.client` suffix is for components that touch browser-only APIs at setup/render time (`SalonMap.client.vue` needs Leaflet/`window`). This form is a plain textarea + `apiFetch` — no browser-only APIs — and it's `v-if`-gated behind a click that can only happen client-side anyway. `ReviewPromptModal.vue`, the existing modal-form precedent in this app, is a plain component for the same reason.

The form accepts an optional `reviewId` prop from day one (exactly one of `salonId`/`reviewId` goes in the body, per the DTO in §3.3) so Task 23 only has to wire the review-flag UI, not touch this component again. Error policy: the request is `silent: true` and the component maps the three known outcomes to Farsi toasts itself (success, 409 duplicate, 403 ineligible — all close the form); anything else gets a generic retry toast and keeps the form open.

- [ ] **Step 1: Write the failing component spec**

```typescript
// apps/user-app/test/nuxt/ReportForm.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import ReportForm from '../../app/components/salon/ReportForm.vue'

// Same pattern as ReviewPromptModal.spec.ts / useApi.spec.ts: `$fetch` is a real
// globalThis binding, not an unimport-tracked auto-import, so it's stubbed directly.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const VALID_REASON = 'این سالن اطلاعات نادرستی درج کرده است'

describe('ReportForm', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps submit disabled until the reason is at least 5 characters, and shows a counter', async () => {
    const wrapper = await mountSuspended(ReportForm, { props: { salonId: 's1' } })

    expect(wrapper.find('[data-testid="submit-report-button"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-testid="report-reason-input"]').setValue('بد')
    expect(wrapper.find('[data-testid="submit-report-button"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="report-reason-counter"]').text()).toContain('۲')

    await wrapper.find('[data-testid="report-reason-input"]').setValue(VALID_REASON)
    expect(wrapper.find('[data-testid="submit-report-button"]').attributes('disabled')).toBeUndefined()
  })

  it('POSTs a salon-targeted report, toasts success, and emits close', async () => {
    fetchMock.mockResolvedValue({ id: 'rep1' })
    const wrapper = await mountSuspended(ReportForm, { props: { salonId: 's1' } })
    const { toasts } = useToast()
    const before = toasts.value.length

    await wrapper.find('[data-testid="report-reason-input"]').setValue(VALID_REASON)
    await wrapper.find('[data-testid="submit-report-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/reports',
      expect.objectContaining({ method: 'POST', body: { salonId: 's1', reason: VALID_REASON } }),
    )
    expect(toasts.value.length).toBe(before + 1)
    expect(toasts.value.at(-1)?.message).toBe('گزارش شما ثبت شد و توسط تیم پشتیبانی بررسی می‌شود')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('targets the review, not the salon, when reviewId is passed', async () => {
    fetchMock.mockResolvedValue({ id: 'rep1' })
    const wrapper = await mountSuspended(ReportForm, { props: { salonId: 's1', reviewId: 'rev1' } })

    await wrapper.find('[data-testid="report-reason-input"]').setValue(VALID_REASON)
    await wrapper.find('[data-testid="submit-report-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/reports',
      expect.objectContaining({ method: 'POST', body: { reviewId: 'rev1', reason: VALID_REASON } }),
    )
  })

  it('shows the duplicate-report toast on a 409 and closes', async () => {
    fetchMock.mockRejectedValue({ response: { status: 409 }, statusMessage: 'Conflict' })
    const wrapper = await mountSuspended(ReportForm, { props: { salonId: 's1' } })
    const { toasts } = useToast()

    await wrapper.find('[data-testid="report-reason-input"]').setValue(VALID_REASON)
    await wrapper.find('[data-testid="submit-report-button"]').trigger('click')
    await flushPromises()

    expect(toasts.value.at(-1)?.message).toBe('گزارش قبلی شما هنوز در حال بررسی است')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows the ineligible toast on a 403 and closes', async () => {
    fetchMock.mockRejectedValue({ response: { status: 403 }, statusMessage: 'Forbidden' })
    const wrapper = await mountSuspended(ReportForm, { props: { salonId: 's1' } })
    const { toasts } = useToast()

    await wrapper.find('[data-testid="report-reason-input"]').setValue(VALID_REASON)
    await wrapper.find('[data-testid="submit-report-button"]').trigger('click')
    await flushPromises()

    expect(toasts.value.at(-1)?.message).toBe('فقط مشتریانی با نوبت تکمیل‌شده در این سالن می‌توانند گزارش ثبت کنند')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('keeps the form open with a generic toast on other errors', async () => {
    fetchMock.mockRejectedValue({ response: { status: 500 }, statusMessage: 'Server error' })
    const wrapper = await mountSuspended(ReportForm, { props: { salonId: 's1' } })
    const { toasts } = useToast()

    await wrapper.find('[data-testid="report-reason-input"]').setValue(VALID_REASON)
    await wrapper.find('[data-testid="submit-report-button"]').trigger('click')
    await flushPromises()

    expect(toasts.value.at(-1)?.message).toBe('ثبت گزارش ناموفق بود؛ لطفا دوباره تلاش کنید')
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/user-app test -- test/nuxt/ReportForm.spec.ts`
Expected: FAIL — cannot resolve `../../app/components/salon/ReportForm.vue` (file does not exist yet).

- [ ] **Step 3: Write the component**

```vue
<!-- apps/user-app/app/components/salon/ReportForm.vue -->
<script setup lang="ts">
const props = defineProps<{ salonId: string; reviewId?: string | null }>()
const emit = defineEmits<{ close: [] }>()

const { apiFetch } = useApi()
const { push } = useToast()

const reason = ref('')
const submitting = ref(false)

const reasonLength = computed(() => reason.value.trim().length)
const isValid = computed(() => reasonLength.value >= 5 && reasonLength.value <= 500)

async function submit() {
  if (!isValid.value || submitting.value) return
  submitting.value = true
  // Exactly one of salonId/reviewId goes to the API (DTO enforces it) -- a reviewId
  // report derives its salon server-side.
  const body = props.reviewId
    ? { reviewId: props.reviewId, reason: reason.value.trim() }
    : { salonId: props.salonId, reason: reason.value.trim() }
  // silent: the three known outcomes get their own Farsi toasts below; only a 401
  // still triggers useApi's redirect-to-/login (fine -- the affordance only renders
  // for logged-in users, so that means the session just expired).
  const { error } = await apiFetch('/reports', { method: 'POST', body, silent: true })
  submitting.value = false
  if (!error) {
    push('گزارش شما ثبت شد و توسط تیم پشتیبانی بررسی می‌شود')
    emit('close')
    return
  }
  if (error.status === 409) {
    push('گزارش قبلی شما هنوز در حال بررسی است')
    emit('close')
    return
  }
  if (error.status === 403) {
    push('فقط مشتریانی با نوبت تکمیل‌شده در این سالن می‌توانند گزارش ثبت کنند')
    emit('close')
    return
  }
  push('ثبت گزارش ناموفق بود؛ لطفا دوباره تلاش کنید')
}

function close() {
  emit('close')
}
</script>

<template>
  <div class="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
    <div class="bg-(--color-surface-card) rounded-xl p-4 w-full max-w-sm space-y-3">
      <h2 class="font-bold">{{ reviewId ? 'گزارش این نظر' : 'گزارش این سالن' }}</h2>
      <textarea
        v-model="reason"
        data-testid="report-reason-input"
        placeholder="دلیل گزارش (حداقل ۵ کاراکتر)"
        maxlength="500"
        rows="4"
        class="w-full rounded-lg border p-2 text-sm"
      />
      <p data-testid="report-reason-counter" class="text-xs opacity-70">
        {{ reasonLength.toLocaleString('fa-IR') }} / ۵۰۰
      </p>
      <button
        type="button"
        data-testid="submit-report-button"
        :disabled="submitting || !isValid"
        class="w-full rounded-lg bg-(--color-accent) text-white p-2 font-semibold disabled:opacity-50"
        @click="submit"
      >
        ثبت گزارش
      </button>
      <button type="button" class="w-full text-sm" @click="close">بستن</button>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/user-app test -- test/nuxt/ReportForm.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Wire the eligibility probe + affordance into the salon profile page**

The page already knows session state via `const session = useSessionStore()` and already runs a logged-in-only `onMounted` probe for favorites — extend that same block so both client-only, user-specific fetches run in parallel (the page itself stays public/SSR-cacheable; eligibility is never fetched server-side).

In `apps/user-app/app/pages/salons/[slug].vue`, replace:

```typescript
const isFavorited = ref(false)
const favoriteBusy = ref(false)

onMounted(async () => {
  if (!session.isLoggedIn) return
  const { data } = await apiFetch<Salon[]>('/favorites', { silent: true })
  isFavorited.value = !!data?.some((s) => s.id === page.value!.salon.id)
})
```

with:

```typescript
const isFavorited = ref(false)
const favoriteBusy = ref(false)
const canReport = ref(false)
const reportOpen = ref(false)

onMounted(async () => {
  if (!session.isLoggedIn) return
  const [favoritesRes, eligibilityRes] = await Promise.all([
    apiFetch<Salon[]>('/favorites', { silent: true }),
    apiFetch<{ canReport: boolean }>('/reports/eligibility', {
      query: { salonId: page.value!.salon.id },
      silent: true,
    }),
  ])
  isFavorited.value = !!favoritesRes.data?.some((s) => s.id === page.value!.salon.id)
  canReport.value = !!eligibilityRes.data?.canReport
})

function openSalonReport() {
  reportOpen.value = true
}

function closeReport() {
  reportOpen.value = false
}
```

Then in the template, replace the closing of the reviews section:

```vue
        </li>
      </ul>
    </section>
  </div>
</template>
```

with:

```vue
        </li>
      </ul>
    </section>

    <button
      v-if="canReport"
      type="button"
      data-testid="report-salon-button"
      class="text-xs opacity-70 underline"
      @click="openSalonReport"
    >
      گزارش این سالن
    </button>

    <ReportForm v-if="reportOpen" :salon-id="page!.salon.id" @close="closeReport" />
  </div>
</template>
```

(`<ReportForm>` resolves via the global auto-import with `pathPrefix: false`, same as `<SalonGallery>` above it. Logged-out or ineligible users see nothing — `canReport` stays `false`.)

- [ ] **Step 6: Run the full user-app unit/component suite**

Run: `pnpm --filter @arayeshgah/user-app test`
Expected: PASS — all pre-existing specs plus the 6 new ReportForm tests; the page change is additive and touches no existing spec's surface.

- [ ] **Step 7: Commit**

```bash
git add apps/user-app/app/components/salon/ReportForm.vue apps/user-app/test/nuxt/ReportForm.spec.ts "apps/user-app/app/pages/salons/[slug].vue"
git commit -m "feat(user-app): salon report form with eligibility-gated affordance on the salon profile"
```

---

### Task 23: Per-review flag buttons on the salon profile

**Files:**
- Create: `apps/user-app/app/components/salon/SalonReviews.vue`
- Test: `apps/user-app/test/nuxt/SalonReviews.spec.ts`
- Modify: `apps/user-app/app/pages/salons/[slug].vue` (:script — the `canReport`/`reportOpen` block Task 22 added; :template — the reviews `<section>` and the `<ReportForm>` line)

The second half of §4.2: when the viewer `canReport`, each review card gains a small flag button that opens the same `ReportForm` targeted at that review (`reviewId` in the body instead of `salonId` — Task 22 already built that branch into the form). To keep this testable without mounting the whole `useAsyncData`-driven page, the reviews section moves into a dumb presentational component (`reviews` + `canReport` in, `report` event out) — the page keeps owning the modal state.

- [ ] **Step 1: Write the failing component spec**

```typescript
// apps/user-app/test/nuxt/SalonReviews.spec.ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SalonReviews from '../../app/components/salon/SalonReviews.vue'

const reviews = [
  { id: 'r1', rating: 5, comment: 'عالی بود', salonReply: null, createdAt: '2026-07-01T10:00:00Z' },
  { id: 'r2', rating: 2, comment: 'راضی نبودم', salonReply: 'متاسفیم، جبران می‌کنیم', createdAt: '2026-07-02T10:00:00Z' },
]

describe('SalonReviews', () => {
  it('renders the empty state when there are no reviews', async () => {
    const wrapper = await mountSuspended(SalonReviews, { props: { reviews: [], canReport: false } })
    expect(wrapper.text()).toContain('هنوز نظری ثبت نشده است')
  })

  it('renders reviews and salon replies', async () => {
    const wrapper = await mountSuspended(SalonReviews, { props: { reviews, canReport: false } })
    expect(wrapper.text()).toContain('عالی بود')
    expect(wrapper.text()).toContain('پاسخ سالن: متاسفیم، جبران می‌کنیم')
  })

  it('hides flag buttons when the viewer cannot report', async () => {
    const wrapper = await mountSuspended(SalonReviews, { props: { reviews, canReport: false } })
    expect(wrapper.findAll('[data-testid="flag-review-button"]')).toHaveLength(0)
  })

  it('shows one flag button per review when the viewer can report', async () => {
    const wrapper = await mountSuspended(SalonReviews, { props: { reviews, canReport: true } })
    expect(wrapper.findAll('[data-testid="flag-review-button"]')).toHaveLength(2)
  })

  it('emits report with the review id when a flag is clicked', async () => {
    const wrapper = await mountSuspended(SalonReviews, { props: { reviews, canReport: true } })

    await wrapper.findAll('[data-testid="flag-review-button"]')[1]!.trigger('click')

    expect(wrapper.emitted('report')).toHaveLength(1)
    expect(wrapper.emitted('report')![0]).toEqual(['r2'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/user-app test -- test/nuxt/SalonReviews.spec.ts`
Expected: FAIL — cannot resolve `../../app/components/salon/SalonReviews.vue` (file does not exist yet).

- [ ] **Step 3: Write the component**

Markup is lifted verbatim from the page's current reviews `<section>`, plus the flag button:

```vue
<!-- apps/user-app/app/components/salon/SalonReviews.vue -->
<script setup lang="ts">
interface ReviewItem { id: string; rating: number; comment: string | null; salonReply: string | null; createdAt: string }

defineProps<{ reviews: ReviewItem[]; canReport: boolean }>()
const emit = defineEmits<{ report: [reviewId: string] }>()

function flagReview(reviewId: string) {
  emit('report', reviewId)
}
</script>

<template>
  <section>
    <h2 class="font-bold mb-2">نظرات</h2>
    <p v-if="!reviews.length" class="text-sm">هنوز نظری ثبت نشده است</p>
    <ul v-else class="space-y-3">
      <li v-for="review in reviews" :key="review.id" class="rounded-lg bg-(--color-surface-card) p-3 text-sm">
        <div class="flex items-start justify-between gap-2">
          <p>⭐ {{ review.rating }} — {{ review.comment }}</p>
          <button
            v-if="canReport"
            type="button"
            data-testid="flag-review-button"
            title="گزارش این نظر"
            class="shrink-0 text-xs opacity-60"
            @click="flagReview(review.id)"
          >
            🚩
          </button>
        </div>
        <p v-if="review.salonReply" class="mt-1 ps-3 border-s-2 text-(--color-text)">
          پاسخ سالن: {{ review.salonReply }}
        </p>
      </li>
    </ul>
  </section>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/user-app test -- test/nuxt/SalonReviews.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Swap the page's inline reviews section for the component and wire the review target**

In `apps/user-app/app/pages/salons/[slug].vue`, three edits.

First, extend the report state Task 22 added — replace:

```typescript
const canReport = ref(false)
const reportOpen = ref(false)
```

with:

```typescript
const canReport = ref(false)
const reportOpen = ref(false)
const reportReviewId = ref<string | null>(null)
```

and replace:

```typescript
function openSalonReport() {
  reportOpen.value = true
}

function closeReport() {
  reportOpen.value = false
}
```

with:

```typescript
function openSalonReport() {
  reportReviewId.value = null
  reportOpen.value = true
}

function openReviewReport(reviewId: string) {
  reportReviewId.value = reviewId
  reportOpen.value = true
}

function closeReport() {
  reportOpen.value = false
  reportReviewId.value = null
}
```

Second, replace the entire inline reviews section in the template:

```vue
    <section>
      <h2 class="font-bold mb-2">نظرات</h2>
      <p v-if="!page!.reviews.length" class="text-sm">هنوز نظری ثبت نشده است</p>
      <ul v-else class="space-y-3">
        <li v-for="review in page!.reviews" :key="review.id" class="rounded-lg bg-(--color-surface-card) p-3 text-sm">
          <p>⭐ {{ review.rating }} — {{ review.comment }}</p>
          <p v-if="review.salonReply" class="mt-1 ps-3 border-s-2 text-(--color-text)">
            پاسخ سالن: {{ review.salonReply }}
          </p>
        </li>
      </ul>
    </section>
```

with:

```vue
    <SalonReviews :reviews="page!.reviews" :can-report="canReport" @report="openReviewReport" />
```

Third, pass the review target through to the form — replace:

```vue
    <ReportForm v-if="reportOpen" :salon-id="page!.salon.id" @close="closeReport" />
```

with:

```vue
    <ReportForm v-if="reportOpen" :salon-id="page!.salon.id" :review-id="reportReviewId" @close="closeReport" />
```

(The page's local `ReviewItem` interface at the top of the script stays — it still types the `useAsyncData` payload.)

- [ ] **Step 6: Run the full user-app unit/component suite**

Run: `pnpm --filter @arayeshgah/user-app test`
Expected: PASS — including the Task 22 `ReportForm.spec.ts` review-target test, which already covers the `{ reviewId, reason }` body this wiring now exercises.

- [ ] **Step 7: Commit**

```bash
git add apps/user-app/app/components/salon/SalonReviews.vue apps/user-app/test/nuxt/SalonReviews.spec.ts "apps/user-app/app/pages/salons/[slug].vue"
git commit -m "feat(user-app): per-review flag buttons filing review-targeted reports"
```

---

### Task 24: Docs update + final plan verification

**Files:**
- Modify: `CLAUDE.md` (:252 plans list; :258-272 "Known Gaps / Future Plans" section)
- Modify: `README.md` (:61 Plan 3 out-of-band-reports sentence; :114-120 Plan 6 out-of-scope list; new "Platform hardening (Plan 7)" section appended)

Plan 7 exists precisely to close six of the gaps `CLAUDE.md` and `README.md` carry — leaving those lists stale would actively mislead the next session (both files instruct readers to trust them). Update both, then run the full verification pass.

- [ ] **Step 1: Update `CLAUDE.md`'s plans list**

In the "Docs, Specs & Planning Workflow" section, replace:

```markdown
- `docs/superpowers/plans/` — the executed implementation plans, one per numbered plan (`plan-1-foundation-backend-core.md`, `plan-2-booking-payments.md`, `plan-3-reviews-moderation.md`, `plan-4-user-app-frontend.md`). These record what was actually built, including task-by-task completion notes and any deviations from the design doc.
```

with:

```markdown
- `docs/superpowers/plans/` — the executed implementation plans, one per numbered plan (`plan-1-foundation-backend-core.md` through `plan-7-platform-hardening.md`, dated filenames like `2026-07-10-plan-7-platform-hardening.md`). These record what was actually built, including task-by-task completion notes and any deviations from the design doc.
```

- [ ] **Step 2: Rewrite `CLAUDE.md`'s "Known Gaps / Future Plans" section**

The six trailing bullets (audit log, first-admin bootstrap, report mechanism, category delete, cascade suspend, resubmit notification) are the exact gaps Plan 7 closed — remove them and record the closure; keep the still-true cuts (blog CMS, refunds/alerting) and the earlier closure notes. Replace the entire section body (everything after the `## Known Gaps / Future Plans` heading, i.e. the intro line and all eleven bullets) with:

```markdown
Carried forward across every plan shipped so far — check these are still accurate before assuming otherwise:

- **Provider Panel (Plan 5) and Admin Panel (Plan 6) are both built.** `apps/provider-panel` (port 3004) covers onboarding, bookings, services, hours, photos, reviews, earnings, and a Salon Settings/resubmit flow. `apps/admin-panel` (port 3005) covers salon approvals, review moderation, categories, users/salons search+suspend, and platform config editing.
- **Salon approval no longer requires a manual DB update.** `PATCH /api/admin/salons/:id/status` (approve/reject/suspend, reason required for reject/suspend) plus `POST /api/salons/mine/resubmit` (provider side, flips `rejected` back to `pending`) close this gap — see the README's "Admin panel (Plan 6)" section for the full endpoint list.
- **No salon photo upload path** was the old gap here — it's closed: `POST /api/salons/mine/photos` (Plan 5) lets a provider upload/manage photos via a swappable `StorageProvider` (`local`/`s3`).
- **Plan 7 (platform hardening) closed the six trust-and-safety gaps** previously listed here: an admin audit log (declarative `@AuditAction` decorator + interceptor on every admin mutation, browsable via `GET /api/admin/audit-log` and the admin-panel's Audit Log page), a first-admin bootstrap script (`pnpm --filter @arayeshgah/api create-admin -- <phone>`, idempotent), a verified-customer report flow end-to-end (user-app salon/review report form → `POST /api/reports` → admin-panel queue at `/reports`), category delete with restrict semantics (`DELETE /api/admin/categories/:id`, 409 when any salon service references it), user-suspend → salon cascade (`salons.suspended_cause` distinguishes `admin` suspensions from `owner_suspended` cascades so reactivation only restores the latter), and a polled admin notification queue (`salon_resubmitted` / `report_created`, bell badge in the admin-panel header). See `docs/superpowers/plans/2026-07-10-plan-7-platform-hardening.md`.
- **Blog/content-marketing CMS** is a separate, not-yet-started future plan (backend module + admin editor + public pages) — out of scope for every plan so far.
- **No real payment refunds**, and no real alerting/paging on the `logger.error(...)` calls that flag payments needing manual review — both are explicit MVP scope cuts, not bugs.
```

- [ ] **Step 3: Update `README.md`**

Three edits.

First, the Plan 3 "Reviews & moderation" section still says reports reach admins out-of-band — replace:

```markdown
**Moderation is reactive, not pre-publish**: a review is `published` the instant it's created; there's no queue to clear before it's visible. An admin can later flip it to `rejected` (or back) if a report is upheld — how a report reaches an admin (support ticket, phone call) is outside this system for MVP, same as Zarinpal refund settlement in Plan 2.
```

with:

```markdown
**Moderation is reactive, not pre-publish**: a review is `published` the instant it's created; there's no queue to clear before it's visible. An admin can later flip it to `rejected` (or back) if a report is upheld — reports originally arrived out-of-band (support ticket, phone call), but Plan 7 added an in-system report flow (see "Platform hardening (Plan 7)" below). Zarinpal refund settlement remains outside the system, same as Plan 2.
```

Second, strike through the Plan 6 out-of-scope list (same `~~…~~ Closed by Plan N` convention the "User app (Plan 4)" section already uses) — replace:

```markdown
**Out of scope, not built by this plan:**
- No report/flag mechanism — reports about a salon or review still arrive out-of-band (support ticket, phone call), same as before.
- No category delete.
- No auto-suspend of a user's salon when the user is suspended.
- No first-admin bootstrap script — the first admin account is still a manual DB update.
- No audit log of admin actions (who approved/rejected/suspended what, when).
- No notification to an admin when a provider resubmits a rejected salon.
```

with:

```markdown
**Out of scope at the time — all six closed by Plan 7 (see "Platform hardening (Plan 7)" below):**
- ~~No report/flag mechanism — reports about a salon or review still arrive out-of-band (support ticket, phone call), same as before.~~
- ~~No category delete.~~
- ~~No auto-suspend of a user's salon when the user is suspended.~~
- ~~No first-admin bootstrap script — the first admin account is still a manual DB update.~~
- ~~No audit log of admin actions (who approved/rejected/suspended what, when).~~
- ~~No notification to an admin when a provider resubmits a rejected salon.~~
```

Third, append a new section at the end of `README.md` (after the Plan 6 section):

```markdown
## Platform hardening (Plan 7)

Closes the six trust-and-safety gaps carried since Plans 5/6 — no new product surface beyond these. Spec: `docs/superpowers/specs/2026-07-10-plan-7-platform-hardening-design.md`.

- **Admin audit log** — every admin mutation (salon status/featured, user status, review moderation, category create/update/delete, config update, report resolve) writes an `audit_log` row via a declarative `@AuditAction` decorator + interceptor; audit-insert failures are logged and swallowed, never failing the admin's request. Browse via `GET /api/admin/audit-log` (filterable by actor/action/target-type/date, paginated) or the admin-panel's Audit Log page. No before/after value snapshots in v1 — the log answers "who did what, to what, with what input, when."
- **First-admin bootstrap** — `pnpm --filter @arayeshgah/api create-admin -- 09121234567` idempotently creates the user if missing and sets `role='admin'`, `status='active'`; the first admin is no longer a manual DB update.
- **Reports** — a verified customer (at least one `completed` booking at the salon) can report a salon or one of its reviews from the salon profile page: `POST /api/reports` (one *open* report per reporter per target, enforced by a partial unique index → 409), `GET /api/reports/eligibility?salonId=` gates the UI. Admins work the queue via `GET/PATCH /api/admin/reports` and the admin-panel Reports page. Resolving a report doesn't itself moderate anything — the queue links to the existing, already-audited moderation actions.
- **Category delete** — `DELETE /api/admin/categories/:id` with restrict semantics: a category referenced by any salon service (active or not) 409s, mirroring the DB's FK. Reassign-or-cascade is deferred until someone actually needs it.
- **Cascade suspend** — suspending a user now also suspends their `approved` salon in the same transaction, recording `suspended_cause='owner_suspended'`; reactivating the user restores only cascade-suspended salons — a salon an admin suspended directly stays suspended. Public review listing (`GET /api/salons/:salonId/reviews`) now also requires the salon to be `approved`.
- **Admin notifications** — a persisted queue (`admin_notifications`) polled by the admin panel (bell badge, 60s cadence), fed by two emit points: provider resubmits (`salon_resubmitted`) and new reports (`report_created`). One shared read-state for all admins is a deliberate cut.
```

- [ ] **Step 4: Full verification — unit/component suites across all apps**

Run: `pnpm test`
Expected: PASS — turbo runs every package's `test` script (api Jest units incl. all Plan 7 colocated specs; admin-panel, provider-panel, and user-app Vitest suites incl. the new ReportForm/SalonReviews specs).

- [ ] **Step 5: Full verification — API e2e**

Requires docker services (`docker compose up -d`) and migrations applied (`pnpm --filter @arayeshgah/api migration:run`).

Run: `pnpm --filter @arayeshgah/api test:e2e`
Expected: PASS — including Plan 7's report-lifecycle, cascade-suspend, category-delete, resubmit-notification, and audit-row e2e specs.

- [ ] **Step 6: Full verification — build**

Run: `pnpm build`
Expected: PASS — all four apps build cleanly (this also runs `vue-tsc`/`nuxt typecheck`-equivalent compilation for the frontends' build paths, catching any type drift from the new components).

> **⚠️ Standing warning — frontend e2e wipes the shared dev DB.** The Playwright suites (`pnpm --filter @arayeshgah/user-app test:e2e`, `pnpm --filter @arayeshgah/admin-panel test:e2e`) have global-setups that **wipe and reseed the shared dev database**. They are not part of this task's required verification (per the design doc §6, Playwright additions only happen if an existing spec breaks) — but if you do run them, **reseed your demo data afterwards** before doing any manual testing against the dev DB.

- [ ] **Step 7: Final commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: record Plan 7 closing the six hardening gaps in CLAUDE.md and README"
```

