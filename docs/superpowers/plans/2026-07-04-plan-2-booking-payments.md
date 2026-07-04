# Plan 2: Booking Engine & Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in customer find an available time slot at an approved salon, hold it, pay a Zarinpal deposit, get a confirmed booking with SMS notifications, and let either side cancel/complete it under the spec's refund policy — with background jobs that clean up abandoned holds and reconcile payments Zarinpal's callback never reached.

**Architecture:** One new NestJS module, `BookingModule` (mirroring the existing `salons/` directory-per-module convention), holding both booking and payment concerns since they're a single 1:1 transactional unit. A small `PlatformConfigModule` exposes the already-seeded `platform_config` table as typed getters. A `PaymentGateway` interface (mirroring the existing `SmsProvider` pattern from Plan 1) gets a `MockPaymentGateway` for dev/test and a `ZarinpalGateway` for production, selected by config the same way `SmsModule` already picks Console vs Kavenegar. Availability is computed by a pure, exhaustively unit-tested function separate from its DB-fetching orchestrator — the spec calls this "the hardest part," so it gets the most isolated testing.

**Tech Stack:** Builds entirely on Plan 1's stack (NestJS 11, TypeORM 0.3, PostgreSQL+PostGIS, Redis via `ioredis`, Jest+Supertest). Adds `@nestjs/schedule` for the two background jobs (expiry, reconciliation). Uses Node 22's built-in `fetch` for Zarinpal, same as Plan 1's Kavenegar integration.

**Scope (confirmed with the user):** Plan 2 covers the full booking transaction — availability, holds, Zarinpal deposits, confirm, notify, cancel, complete/no-show, expiry, reconciliation. **Reviews are explicitly out of scope** and will be a separate Plan 3, since they're a bounded, lower-risk feature that only needs a `completed` booking to exist.

**A note on Zarinpal's exact API contract:** the field names and status codes below (`merchant_id`, `callback_url`, `authority`, code `100`/`101`, the `pg/v4/payment/request.json` and `verify.json` endpoints, the `pg/StartPay/{authority}` redirect URL) are Zarinpal's well-established, stable v4 REST contract, cross-referenced against multiple independent SDK implementations during planning. Live fetches to zarinpal.com's own docs pages failed repeatedly during planning (network/socket errors, not a documentation gap). **Before this ever takes real payments, verify the exact contract against Zarinpal's sandbox** (`sandbox.zarinpal.com` mirrors the same endpoints) — the whole integration is isolated behind the `PaymentGateway` interface in one file (`zarinpal-payment.gateway.ts`) specifically so a field-name correction is a contained, one-file fix. All automated tests use `MockPaymentGateway` and never call the real API.

**What Plan 2 deliberately does NOT do** (matching the spec's own "Open Risks" section, which says refund settlement mechanics need separate validation before automating): it never calls a real Zarinpal refund API. "Refunded" in this plan means the database record of *our intent* to refund — the actual money movement is a manual/future concern. Forfeiture is likewise just a `payment.status` staying `'paid'` combined with the booking's terminal status recording *why* — there is no separate "forfeited" payment state, because the money genuinely was captured either way; only the business outcome (who keeps it) differs, and that's the booking's job to record, not the payment's.

---

## File Structure

```
apps/api/src/
├── platform-config/
│   ├── platform-config.entity.ts
│   ├── platform-config.service.ts
│   └── platform-config.module.ts
├── salons/
│   ├── salon-owner.guard.ts          # NEW — extracted shared "resolve caller's own salon" guard
│   ├── salon-services.controller.ts  # MODIFIED — uses SalonOwnerGuard instead of its own mySalonId()
│   ├── schedule.controller.ts        # MODIFIED — same
│   └── salons.service.ts             # MODIFIED — adds findById()
├── sms/
│   ├── sms.provider.ts               # MODIFIED — adds send() to the interface
│   ├── console-sms.provider.ts       # MODIFIED — implements send()
│   └── kavenegar-sms.provider.ts     # MODIFIED — implements send()
├── booking/
│   ├── booking.entity.ts
│   ├── payment.entity.ts
│   ├── deposit.util.ts               # pure function: calculateDeposit()
│   ├── availability.util.ts          # pure function: computeAvailableSlots() — the "hardest" logic, isolated
│   ├── availability.service.ts       # orchestrator: fetches data, calls the pure function
│   ├── payment-gateway.ts            # PaymentGateway interface + token
│   ├── mock-payment.gateway.ts
│   ├── zarinpal-payment.gateway.ts
│   ├── bookings.service.ts           # create/cancel/get — the customer-facing half
│   ├── bookings.controller.ts        # /bookings, /bookings/mine, /bookings/:id, /bookings/:id/cancel
│   ├── salon-bookings.controller.ts  # /salons/mine/bookings — the provider-facing half
│   ├── payments.service.ts           # callback handling — the money-critical half
│   ├── payments.controller.ts        # /payments/callback
│   ├── booking-expiry.job.ts
│   ├── payment-reconciliation.job.ts
│   ├── booking.module.ts
│   └── dto/
│       └── booking.dto.ts
└── app.module.ts                     # MODIFIED — registers ScheduleModule, PlatformConfigModule, BookingModule
```

Each file has one job: entities are pure data shape, the two `.util.ts` files are pure functions with zero DB/HTTP dependencies (fast, exhaustive unit tests), the two gateway files are the only places that know Zarinpal's/mock's specifics, and the two `.service.ts` files split cleanly along "the customer-initiated half" vs "the money-confirmation half" rather than one giant booking service.

---

### Task 1: Add `@nestjs/schedule` and register it

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Add the dependency**

In `apps/api/package.json`'s `dependencies` object, add (keep alphabetical order among the `@nestjs/*` entries):

```json
    "@nestjs/schedule": "^5.0.0",
```

- [ ] **Step 2: Install**

Run (from repo root): `pnpm install`
Expected: `@nestjs/schedule` resolves and installs with no errors.

- [ ] **Step 3: Register `ScheduleModule.forRoot()`** in `apps/api/src/app.module.ts`

Add the import and add it to the `imports` array, right after `TypeOrmModule.forRootAsync`:

```typescript
import { ScheduleModule } from '@nestjs/schedule';
```

```typescript
    TypeOrmModule.forRootAsync({
      // ... unchanged ...
    }),
    ScheduleModule.forRoot(),
    RedisModule,
```

- [ ] **Step 4: Verify nothing broke**

Run: `pnpm --filter @arayeshgah/api test:e2e`
Expected: all 30 existing e2e tests still pass — this proves `ScheduleModule.forRoot()` boots cleanly alongside everything else and doesn't hang the process (it registers a cron scheduler that must shut down cleanly with the app, same concern as Task 5's Redis module in Plan 1).

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/app.module.ts
git commit -m "chore(api): add @nestjs/schedule for booking background jobs"
```

---

### Task 2: Extract `SalonOwnerGuard` — resolve the "3rd occurrence" flagged in Plan 1's final review

**Files:**
- Create: `apps/api/src/salons/salon-owner.guard.ts`
- Modify: `apps/api/src/salons/salon-services.controller.ts`
- Modify: `apps/api/src/salons/schedule.controller.ts`
- Modify: `apps/api/src/salons/salons.module.ts`
- Modify: `apps/api/src/types/express.d.ts`

**Why this task exists:** Plan 1's final whole-branch review flagged that `mySalonId(req)` — "look up the authenticated caller's own salon, 404 if they don't have one" — was duplicated verbatim in `salon-services.controller.ts` and `schedule.controller.ts`, and recommended extracting it once a third call site needed the same thing. This plan's `salon-bookings.controller.ts` (Task 11) is exactly that third call site, so this task does the extraction now, before it's needed a third time via copy-paste.

- [ ] **Step 1: Extend the Express `Request` type** — `apps/api/src/types/express.d.ts`

Current content augments `Request` with `user`. Add `salonId` alongside it:

```typescript
import { User } from '../users/user.entity';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      salonId?: string;
    }
  }
}
```

- [ ] **Step 2: Create the guard** — `apps/api/src/salons/salon-owner.guard.ts`

```typescript
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { User } from '../users/user.entity';
import { SalonsService } from './salons.service';

/**
 * Must run after AuthGuard (reads req.user). Resolves the caller's own salon
 * and attaches its id to req.salonId, 404ing via SalonsService.findMine if
 * they don't have one. Replaces the private mySalonId(req) helper that was
 * duplicated across salon-services.controller.ts and schedule.controller.ts.
 */
@Injectable()
export class SalonOwnerGuard implements CanActivate {
  constructor(private readonly salons: SalonsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const salon = await this.salons.findMine((req.user as User).id);
    req.salonId = salon.id;
    return true;
  }
}
```

- [ ] **Step 3: Refactor `salon-services.controller.ts`**

Replace the whole file with:

```typescript
import {
  Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { CreateServiceDto, UpdateServiceDto } from './dto/salon-service.dto';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonService } from './salon-service.entity';

@Controller('salons/mine/services')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class SalonServicesController {
  constructor(
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
  ) {}

  @Post()
  async create(@Req() req: Request, @Body() dto: CreateServiceDto) {
    return this.services.save(this.services.create({ ...dto, salonId: req.salonId }));
  }

  @Get()
  async list(@Req() req: Request) {
    return this.services.find({ where: { salonId: req.salonId, isActive: true }, order: { createdAt: 'ASC' } });
  }

  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    const service = await this.services.findOneBy({ id, salonId: req.salonId, isActive: true });
    if (!service) throw new NotFoundException();
    Object.assign(service, dto);
    return this.services.save(service);
  }

  @Delete(':id')
  @HttpCode(204)
  async archive(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.services.update({ id, salonId: req.salonId }, { isActive: false });
    if (!result.affected) throw new NotFoundException();
  }
}
```

(`SalonsService` is no longer imported/injected here — it was only ever used for `mySalonId`.)

- [ ] **Step 4: Refactor `schedule.controller.ts`**

Replace the whole file with:

```typescript
import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException,
  Param, ParseUUIDPipe, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { DataSource, Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { CreateExceptionDto, ReplaceHoursDto } from './dto/schedule.dto';
import { SalonOwnerGuard } from './salon-owner.guard';
import { ScheduleException } from './schedule-exception.entity';
import { WorkingHour } from './working-hour.entity';

@Controller('salons/mine')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class ScheduleController {
  constructor(
    @InjectRepository(WorkingHour) private readonly hours: Repository<WorkingHour>,
    @InjectRepository(ScheduleException) private readonly exceptions: Repository<ScheduleException>,
    private readonly dataSource: DataSource,
  ) {}

  @Put('hours')
  async replaceHours(@Req() req: Request, @Body() dto: ReplaceHoursDto) {
    for (const h of dto.hours) {
      if (h.openTime >= h.closeTime) {
        throw new BadRequestException(`openTime must be before closeTime (weekday ${h.weekday})`);
      }
    }
    const salonId = req.salonId!;
    return this.dataSource.transaction(async (em) => {
      await em.delete(WorkingHour, { salonId });
      return em.save(WorkingHour, dto.hours.map((h) => ({ ...h, salonId })));
    });
  }

  @Get('hours')
  async listHours(@Req() req: Request) {
    return this.hours.find({ where: { salonId: req.salonId }, order: { weekday: 'ASC', openTime: 'ASC' } });
  }

  @Post('exceptions')
  async addException(@Req() req: Request, @Body() dto: CreateExceptionDto) {
    return this.exceptions.save(
      this.exceptions.create({ salonId: req.salonId, date: dto.date, isClosed: dto.isClosed ?? true }),
    );
  }

  @Get('exceptions')
  async listExceptions(@Req() req: Request) {
    return this.exceptions.find({ where: { salonId: req.salonId }, order: { date: 'ASC' } });
  }

  @Delete('exceptions/:id')
  @HttpCode(204)
  async removeException(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.exceptions.delete({ id, salonId: req.salonId });
    if (!result.affected) throw new NotFoundException();
  }
}
```

- [ ] **Step 5: Add `findById` to `SalonsService`** — `apps/api/src/salons/salons.service.ts`

This is needed by Task 11's provider-side booking controller and Task 10's payments service, both of which look up a salon that the CALLER doesn't necessarily own (the system itself, or a customer). Add this method alongside the existing ones (don't reorder/rewrite the rest of the file):

```typescript
  findById(id: string): Promise<Salon | null> {
    return this.repo.findOneBy({ id });
  }
```

- [ ] **Step 6: Register the guard in `salons.module.ts`**

Add `SalonOwnerGuard` to `providers` and `exports` (Task 11 needs to inject it from `BookingModule`):

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonService } from './salon-service.entity';
import { Salon } from './salon.entity';
import { SalonServicesController } from './salon-services.controller';
import { SalonsController } from './salons.controller';
import { SalonsService } from './salons.service';
import { ScheduleController } from './schedule.controller';
import { ScheduleException } from './schedule-exception.entity';
import { WorkingHour } from './working-hour.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Salon, SalonService, WorkingHour, ScheduleException]),
    AuthModule,
  ],
  controllers: [SalonServicesController, ScheduleController, SalonsController],
  providers: [SalonsService, SalonOwnerGuard],
  exports: [SalonsService, SalonOwnerGuard, TypeOrmModule],
})
export class SalonsModule {}
```

- [ ] **Step 7: Verify nothing broke**

Run: `pnpm --filter @arayeshgah/api test:e2e`
Expected: all 30 existing e2e tests still pass unchanged — `salon-services.e2e-spec.ts` and `schedule.e2e-spec.ts` exercise these exact controllers and don't know or care that the internals were refactored.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/salons apps/api/src/types
git commit -m "refactor(api): extract SalonOwnerGuard, resolving the mySalonId duplication flagged in Plan 1's final review"
```

---

### Task 3: `PlatformConfigModule` — typed access to the already-seeded config table

**Files:**
- Create: `apps/api/src/platform-config/platform-config.entity.ts`
- Create: `apps/api/src/platform-config/platform-config.service.ts`
- Create: `apps/api/src/platform-config/platform-config.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/platform-config.e2e-spec.ts`

**Context:** Task 4 of Plan 1's migration already created `platform_config` (key varchar PK, value jsonb) and seeded exactly 5 rows: `deposit_percent`=20, `deposit_min_toman`=200000, `cancellation_window_hours`=24, `commission_percent`=10, `booking_hold_ttl_minutes`=15. Since those were inserted as bare JSON-valid numeric literals into a `jsonb` column, `pg` (the Postgres driver) returns them as already-parsed JS numbers — no manual `JSON.parse` needed.

- [ ] **Step 1: Entity** — `apps/api/src/platform-config/platform-config.entity.ts`

```typescript
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('platform_config')
export class PlatformConfig {
  @PrimaryColumn()
  key: string;

  @Column({ type: 'jsonb' })
  value: unknown;
}
```

- [ ] **Step 2: Service** — `apps/api/src/platform-config/platform-config.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformConfig } from './platform-config.entity';

@Injectable()
export class PlatformConfigService {
  constructor(
    @InjectRepository(PlatformConfig) private readonly repo: Repository<PlatformConfig>,
  ) {}

  private async getNumber(key: string): Promise<number> {
    const row = await this.repo.findOneBy({ key });
    if (!row) throw new Error(`Missing platform_config key: ${key}`);
    return Number(row.value);
  }

  getDepositPercent(): Promise<number> {
    return this.getNumber('deposit_percent');
  }

  getDepositMinToman(): Promise<number> {
    return this.getNumber('deposit_min_toman');
  }

  getCancellationWindowHours(): Promise<number> {
    return this.getNumber('cancellation_window_hours');
  }

  getCommissionPercent(): Promise<number> {
    return this.getNumber('commission_percent');
  }

  getBookingHoldTtlMinutes(): Promise<number> {
    return this.getNumber('booking_hold_ttl_minutes');
  }
}
```

(A missing key means the deployment's migrations never ran the seed — that's a genuine startup-invariant violation, not a user-facing error, so a raw thrown `Error` producing a 500 is the right severity; there's no request input that could trigger this.)

- [ ] **Step 3: Module** — `apps/api/src/platform-config/platform-config.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformConfig } from './platform-config.entity';
import { PlatformConfigService } from './platform-config.service';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformConfig])],
  providers: [PlatformConfigService],
  exports: [PlatformConfigService],
})
export class PlatformConfigModule {}
```

- [ ] **Step 4: Register in `app.module.ts`**

```typescript
import { PlatformConfigModule } from './platform-config/platform-config.module';
```

Add `PlatformConfigModule` to `imports`, anywhere after `RedisModule`.

- [ ] **Step 5: Write the e2e test** — `apps/api/test/platform-config.e2e-spec.ts`

```typescript
import { INestApplication } from '@nestjs/common';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';
import { PlatformConfigService } from '../src/platform-config/platform-config.service';

describe('PlatformConfigService (e2e)', () => {
  let app: INestApplication;
  let config: PlatformConfigService;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    config = app.get(PlatformConfigService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('reads all five seeded tunables with the correct values and types', async () => {
    expect(await config.getDepositPercent()).toBe(20);
    expect(await config.getDepositMinToman()).toBe(200000);
    expect(await config.getCancellationWindowHours()).toBe(24);
    expect(await config.getCommissionPercent()).toBe(10);
    expect(await config.getBookingHoldTtlMinutes()).toBe(15);
  });
});
```

- [ ] **Step 6: Run, verify pass**

Run: `pnpm --filter @arayeshgah/api test:e2e -- platform-config`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/platform-config apps/api/src/app.module.ts apps/api/test/platform-config.e2e-spec.ts
git commit -m "feat(api): add typed PlatformConfigService for the seeded config table"
```

---

### Task 4: Extend `SmsProvider` with a generic `send()` for booking notifications

**Files:**
- Modify: `apps/api/src/sms/sms.provider.ts`
- Modify: `apps/api/src/sms/console-sms.provider.ts`
- Modify: `apps/api/src/sms/kavenegar-sms.provider.ts`
- Modify: `apps/api/src/sms/kavenegar-sms.provider.spec.ts`

**Context:** Plan 1's `SmsProvider` interface only has `sendOtp` (Kavenegar's templated Verify/Lookup API). Booking confirmations, provider notices, and reminders are free-text messages, which Kavenegar sends through a *different* endpoint (`sms/send.json`, plain `receptor`+`message`, no template). Extending the interface — rather than creating a second, parallel `NotificationProvider` — keeps one injection point for "how do we text someone" and matches the existing `SMS_PROVIDER` config-driven selection in `sms.module.ts` (unchanged by this task).

- [ ] **Step 1: Extend the interface** — `apps/api/src/sms/sms.provider.ts`

```typescript
export const SMS_PROVIDER = 'SMS_PROVIDER';

export interface SmsProvider {
  sendOtp(phone: string, code: string): Promise<void>;
  send(phone: string, message: string): Promise<void>;
}
```

- [ ] **Step 2: Implement in `ConsoleSmsProvider`** — `apps/api/src/sms/console-sms.provider.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms.provider';

@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SMS');

  async sendOtp(phone: string, code: string): Promise<void> {
    this.logger.log(`OTP for ${phone}: ${code}`);
  }

  async send(phone: string, message: string): Promise<void> {
    this.logger.log(`SMS to ${phone}: ${message}`);
  }
}
```

- [ ] **Step 3: Write the failing test for Kavenegar's `send()`** — append to `apps/api/src/sms/kavenegar-sms.provider.spec.ts` (after the existing three tests, inside the same `describe` block, before the closing `});`)

```typescript

  it('calls the plain sms/send endpoint with phone and message', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ return: { status: 200 } }),
    });
    const provider = new KavenegarSmsProvider('MY_KEY', 'my-template');
    await provider.send('09121234567', 'Your booking is confirmed');

    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain('/v1/MY_KEY/sms/send.json');
    expect(url).toContain('receptor=09121234567');
    expect(url).toContain('message=Your');
  });

  it('throws when kavenegar reports failure on a plain send', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ return: { status: 418, message: 'invalid' } }),
    });
    const provider = new KavenegarSmsProvider('MY_KEY', 'my-template');
    await expect(provider.send('09121234567', 'hi')).rejects.toThrow();
  });
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @arayeshgah/api test -- kavenegar`
Expected: FAIL — `provider.send is not a function` (2 new failures, the original 3 `sendOtp` tests still pass).

- [ ] **Step 5: Implement `send()` in `KavenegarSmsProvider`** — `apps/api/src/sms/kavenegar-sms.provider.ts`

Add this method to the existing class, after `sendOtp` (the `KavenegarResponse` interface and imports at the top of the file are unchanged and already support this):

```typescript
  async send(phone: string, message: string): Promise<void> {
    const params = new URLSearchParams({ receptor: phone, message });
    const url = `https://api.kavenegar.com/v1/${this.apiKey}/sms/send.json?${params}`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new Error(`Kavenegar send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const body = (await res.json()) as KavenegarResponse;
    if (!res.ok || body?.return?.status !== 200) {
      throw new Error(`Kavenegar send failed: ${body?.return?.message ?? res.status}`);
    }
  }
```

- [ ] **Step 6: Run tests to verify pass**

Run: `pnpm --filter @arayeshgah/api test -- kavenegar`
Expected: PASS (5 tests — the original 3 plus these 2).

Run: `pnpm --filter @arayeshgah/api test`
Expected: PASS (13 tests total across 3 unit suites — confirms `ConsoleSmsProvider`'s new method didn't break anything, since nothing directly unit-tests `ConsoleSmsProvider` but the interface change must still compile).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/sms
git commit -m "feat(api): extend SmsProvider with a generic send() for booking notifications"
```

---

### Task 5: `Booking` and `Payment` entities + migration

**Files:**
- Create: `apps/api/src/migrations/1751700000000-booking-payments-schema.ts`
- Create: `apps/api/src/booking/booking.entity.ts`
- Create: `apps/api/src/booking/payment.entity.ts`

**Context:** This is the second migration in the project (the first, Plan 1's `1751600000000-initial-schema.ts`, already ran and is recorded in the `migrations` table on the dev/test databases). TypeORM tracks which migrations have already run by filename/timestamp, so this new one — with a later numeric prefix — runs additively on top of the existing schema; it never touches the 10 tables Plan 1 created.

- [ ] **Step 1: Write the migration** — `apps/api/src/migrations/1751700000000-booking-payments-schema.ts`

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class BookingPaymentsSchema1751700000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE bookings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id),
        salon_id uuid NOT NULL REFERENCES salons(id),
        service_id uuid NOT NULL REFERENCES salon_services(id),
        starts_at timestamptz NOT NULL,
        ends_at timestamptz NOT NULL,
        price_snapshot bigint NOT NULL,
        deposit_amount bigint NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'pending_payment',
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX bookings_salon_time_idx ON bookings(salon_id, starts_at, ends_at)`);
    await q.query(`CREATE INDEX bookings_user_idx ON bookings(user_id)`);
    await q.query(`CREATE INDEX bookings_status_idx ON bookings(status)`);

    await q.query(`
      CREATE TABLE payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id uuid NOT NULL REFERENCES bookings(id),
        amount bigint NOT NULL,
        gateway varchar(20) NOT NULL DEFAULT 'zarinpal',
        authority varchar(64),
        ref_id varchar(64),
        status varchar(20) NOT NULL DEFAULT 'initiated',
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX payments_booking_uidx ON payments(booking_id)`);
    await q.query(`CREATE INDEX payments_authority_idx ON payments(authority)`);
    await q.query(`CREATE INDEX payments_status_idx ON payments(status, created_at)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE payments`);
    await q.query(`DROP TABLE bookings`);
  }
}
```

Note on the `bookings.status` enum: it's `'pending_payment' | 'confirmed' | 'completed' | 'cancelled_by_user' | 'cancelled_by_salon' | 'expired' | 'no_show'` — one more value (`'expired'`) than the original design spec's list, added because "the hold's 15-minute TTL ran out with no user action" is a genuinely distinct state from "the user actively cancelled," needed for correct observability (Task 14's expiry job sets it) and for `bookings.e2e-spec.ts` to assert on it precisely.

Note on `payments_status_idx`: mirrors `bookings_status_idx`'s purpose — Task 15's reconciliation job runs every 5 minutes forever with `WHERE status = 'initiated' AND created_at < :cutoff`, the exact query shape `bookings_status_idx` already exists to serve for Task 14's expiry job. Without it, `payments` would be full-scanned on every reconciliation run as the table grows.

- [ ] **Step 2: Run the migration against the dev DB**

Run (from `apps/api/`): `pnpm migration:run`
Expected: `BookingPaymentsSchema1751700000000 has been executed successfully.`

Verify: `docker compose exec postgres psql -U arayeshgah -c "\dt"` (from repo root)
Expected: 12 tables now (the original 10 plus `bookings` and `payments`).

- [ ] **Step 3: `Booking` entity** — `apps/api/src/booking/booking.entity.ts`

```typescript
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type BookingStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'completed'
  | 'cancelled_by_user'
  | 'cancelled_by_salon'
  | 'expired'
  | 'no_show';

const bigintToNumber = {
  to: (v: number) => v,
  from: (v: string) => Number(v),
};

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ name: 'service_id' })
  serviceId: string;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  @Column({ name: 'price_snapshot', type: 'bigint', transformer: bigintToNumber })
  priceSnapshot: number;

  @Column({ name: 'deposit_amount', type: 'bigint', transformer: bigintToNumber })
  depositAmount: number;

  @Column({ type: 'varchar', default: 'pending_payment' })
  status: BookingStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 4: `Payment` entity** — `apps/api/src/booking/payment.entity.ts`

```typescript
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type PaymentStatus = 'initiated' | 'paid' | 'failed' | 'refunded';

const bigintToNumber = {
  to: (v: number) => v,
  from: (v: string) => Number(v),
};

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_id', unique: true })
  bookingId: string;

  @Column({ type: 'bigint', transformer: bigintToNumber })
  amount: number;

  @Column({ type: 'varchar', default: 'zarinpal' })
  gateway: string;

  @Column({ type: 'varchar', nullable: true })
  authority: string | null;

  @Column({ name: 'ref_id', type: 'varchar', nullable: true })
  refId: string | null;

  @Column({ type: 'varchar', default: 'initiated' })
  status: PaymentStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 5: Verify entities load without error**

Run: `pnpm --filter @arayeshgah/api build`
Expected: compiles cleanly (this doesn't wire the entities into any module yet — that's Task 11 — but proves the TypeScript is valid and `autoLoadEntities: true` won't choke on them once registered).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/migrations apps/api/src/booking
git commit -m "feat(api): add bookings and payments tables plus their entities"
```

---

### Task 6: `deposit.util.ts` — pure deposit calculation (TDD)

**Files:**
- Create: `apps/api/src/booking/deposit.util.ts`
- Test: `apps/api/src/booking/deposit.util.spec.ts`

- [ ] **Step 1: Write the failing test** — `apps/api/src/booking/deposit.util.spec.ts`

```typescript
import { calculateDeposit } from './deposit.util';

describe('calculateDeposit', () => {
  it('takes the percentage of price when it exceeds the minimum', () => {
    expect(calculateDeposit(800000, 20, 200000)).toBe(160000);
  });

  it('falls back to the minimum when the percentage would be lower', () => {
    expect(calculateDeposit(500000, 20, 200000)).toBe(200000);
  });

  it('rounds to the nearest whole toman', () => {
    expect(calculateDeposit(333333, 20, 1000)).toBe(66667);
  });

  it('returns the minimum for a zero-price service', () => {
    expect(calculateDeposit(0, 20, 200000)).toBe(200000);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @arayeshgah/api test -- deposit.util`
Expected: FAIL — `Cannot find module './deposit.util'`.

- [ ] **Step 3: Implement** — `apps/api/src/booking/deposit.util.ts`

```typescript
export function calculateDeposit(priceToman: number, depositPercent: number, depositMinToman: number): number {
  const byPercent = Math.round((priceToman * depositPercent) / 100);
  return Math.max(byPercent, depositMinToman);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @arayeshgah/api test -- deposit.util`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/booking/deposit.util.ts apps/api/src/booking/deposit.util.spec.ts
git commit -m "feat(api): add pure deposit calculation util"
```

---

### Task 7: `availability.util.ts` — the pure slot-computation function (TDD, exhaustive)

**Files:**
- Create: `apps/api/src/booking/availability.util.ts`
- Test: `apps/api/src/booking/availability.util.spec.ts`

**Context:** The design spec calls slot computation "the hardest part" and says to test it first (section 9). This function takes plain data — no DB, no HTTP, no Nest DI — so every edge case is a fast, deterministic unit test. `AvailabilityService` (Task 8) is a thin wrapper that fetches this data from repositories and hands it to this function.

- [ ] **Step 1: Write the failing tests** — `apps/api/src/booking/availability.util.spec.ts`

```typescript
import { computeAvailableSlots } from './availability.util';

describe('computeAvailableSlots', () => {
  const NOW = new Date('2026-08-03T08:00:00.000Z'); // a Monday, 08:00 UTC

  it('generates slots stepping by duration within a single open range', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: 60,
      capacity: 1,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '12:00:00' }]]]),
      closedDates: new Set(),
      existingBookings: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-08-03');
    expect(result[0].slots).toEqual([
      '2026-08-03T09:00:00.000Z',
      '2026-08-03T10:00:00.000Z',
      '2026-08-03T11:00:00.000Z',
    ]);
  });

  it('does not generate a slot that would run past closing time', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: 90,
      capacity: 1,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '10:30:00' }]]]),
      closedDates: new Set(),
      existingBookings: [],
    });
    // exactly one 90-minute slot fits 09:00-10:30; a second would end at 12:00, past close
    expect(result[0].slots).toEqual(['2026-08-03T09:00:00.000Z']);
  });

  it('handles multiple open ranges on the same day independently', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: 60,
      capacity: 1,
      hoursByWeekday: new Map([[1, [
        { openTime: '09:00:00', closeTime: '11:00:00' },
        { openTime: '15:00:00', closeTime: '17:00:00' },
      ]]]),
      closedDates: new Set(),
      existingBookings: [],
    });
    expect(result[0].slots).toEqual([
      '2026-08-03T09:00:00.000Z',
      '2026-08-03T10:00:00.000Z',
      '2026-08-03T15:00:00.000Z',
      '2026-08-03T16:00:00.000Z',
    ]);
  });

  it('excludes a date entirely when there are no working hours for that weekday', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 2,
      durationMin: 60,
      capacity: 1,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '10:00:00' }]]]), // only Monday
      closedDates: new Set(),
      existingBookings: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-08-03');
  });

  it('excludes a date listed in closedDates even if it has working hours', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: 60,
      capacity: 1,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '10:00:00' }]]]),
      closedDates: new Set(['2026-08-03']),
      existingBookings: [],
    });
    expect(result).toHaveLength(0);
  });

  it('excludes a slot once existing bookings fill it to capacity', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: 60,
      capacity: 2,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '11:00:00' }]]]),
      closedDates: new Set(),
      existingBookings: [
        { startsAt: new Date('2026-08-03T09:00:00.000Z'), endsAt: new Date('2026-08-03T10:00:00.000Z') },
        { startsAt: new Date('2026-08-03T09:00:00.000Z'), endsAt: new Date('2026-08-03T10:00:00.000Z') },
      ],
    });
    // 09:00 has 2 overlapping bookings === capacity, so it's full; 10:00 is untouched
    expect(result[0].slots).toEqual(['2026-08-03T10:00:00.000Z']);
  });

  it('counts a booking as overlapping even if it does not start exactly on the candidate boundary', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: 60,
      capacity: 1,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '11:00:00' }]]]),
      closedDates: new Set(),
      existingBookings: [
        // an existing 09:30-10:30 booking overlaps both the 09:00-10:00 and 10:00-11:00 candidates
        { startsAt: new Date('2026-08-03T09:30:00.000Z'), endsAt: new Date('2026-08-03T10:30:00.000Z') },
      ],
    });
    expect(result).toHaveLength(0);
  });

  it('excludes candidate start times that have already passed today, but keeps future ones', () => {
    const result = computeAvailableSlots({
      now: new Date('2026-08-03T09:30:00.000Z'), // 09:30 on the same Monday
      days: 1,
      durationMin: 60,
      capacity: 1,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '12:00:00' }]]]),
      closedDates: new Set(),
      existingBookings: [],
    });
    // 09:00 has already started/passed; 10:00 and 11:00 remain
    expect(result[0].slots).toEqual(['2026-08-03T10:00:00.000Z', '2026-08-03T11:00:00.000Z']);
  });

  it('does not exclude past-today times on future days', () => {
    const result = computeAvailableSlots({
      now: new Date('2026-08-03T23:00:00.000Z'),
      days: 2,
      durationMin: 60,
      capacity: 1,
      hoursByWeekday: new Map([
        [1, [{ openTime: '09:00:00', closeTime: '10:00:00' }]],
        [2, [{ openTime: '09:00:00', closeTime: '10:00:00' }]],
      ]),
      closedDates: new Set(),
      existingBookings: [],
    });
    expect(result).toHaveLength(2);
    expect(result[1].slots).toEqual(['2026-08-04T09:00:00.000Z']);
  });

  it('returns an empty array when nothing is available across the whole window', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 3,
      durationMin: 60,
      capacity: 1,
      hoursByWeekday: new Map(),
      closedDates: new Set(),
      existingBookings: [],
    });
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @arayeshgah/api test -- availability.util`
Expected: FAIL — `Cannot find module './availability.util'`.

- [ ] **Step 3: Implement** — `apps/api/src/booking/availability.util.ts`

```typescript
export interface WorkingHourRange {
  openTime: string; // 'HH:MM:SS' or 'HH:MM', as returned by Postgres's `time` type
  closeTime: string;
}

export interface BookingInterval {
  startsAt: Date;
  endsAt: Date;
}

export interface ComputeAvailabilityParams {
  now: Date;
  days: number;
  durationMin: number;
  capacity: number;
  hoursByWeekday: Map<number, WorkingHourRange[]>;
  closedDates: Set<string>;
  existingBookings: BookingInterval[];
}

export interface DayAvailability {
  date: string; // 'YYYY-MM-DD'
  slots: string[]; // ISO 8601 UTC start times
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function dateStringUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function combineDateAndMinutes(dateStr: string, minutesFromMidnight: number): Date {
  const base = new Date(`${dateStr}T00:00:00.000Z`);
  return new Date(base.getTime() + minutesFromMidnight * 60_000);
}

export function computeAvailableSlots(params: ComputeAvailabilityParams): DayAvailability[] {
  const { now, days, durationMin, capacity, hoursByWeekday, closedDates, existingBookings } = params;
  const results: DayAvailability[] = [];

  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const day = new Date(now.getTime() + dayOffset * 24 * 60 * 60_000);
    const dateStr = dateStringUtc(day);
    if (closedDates.has(dateStr)) continue;

    const weekday = day.getUTCDay();
    const ranges = hoursByWeekday.get(weekday);
    if (!ranges || ranges.length === 0) continue;

    const daySlots: string[] = [];
    for (const range of ranges) {
      const openMin = parseTimeToMinutes(range.openTime);
      const closeMin = parseTimeToMinutes(range.closeTime);

      for (let cursorMin = openMin; cursorMin + durationMin <= closeMin; cursorMin += durationMin) {
        const candidateStart = combineDateAndMinutes(dateStr, cursorMin);
        const candidateEnd = combineDateAndMinutes(dateStr, cursorMin + durationMin);

        if (candidateStart <= now) continue;

        const overlapCount = existingBookings.filter(
          (b) => b.startsAt < candidateEnd && b.endsAt > candidateStart,
        ).length;
        if (overlapCount >= capacity) continue;

        daySlots.push(candidateStart.toISOString());
      }
    }

    if (daySlots.length > 0) results.push({ date: dateStr, slots: daySlots });
  }

  return results;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @arayeshgah/api test -- availability.util`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/booking/availability.util.ts apps/api/src/booking/availability.util.spec.ts
git commit -m "feat(api): add exhaustively-tested pure slot-computation function"
```

---

### Task 8: `AvailabilityService` — orchestrator + public endpoint

**Files:**
- Create: `apps/api/src/booking/availability.service.ts`
- Create: `apps/api/src/booking/dto/booking.dto.ts` (availability query DTO only in this task; booking DTOs land in Task 9)
- Modify: `apps/api/src/booking/booking.module.ts` (created fresh in this task)
- Test: `apps/api/test/availability.e2e-spec.ts`

- [ ] **Step 1: Availability query DTO** — `apps/api/src/booking/dto/booking.dto.ts`

```typescript
import { IsUUID } from 'class-validator';

export class AvailabilityQueryDto {
  @IsUUID()
  serviceId: string;
}
```

(More DTOs are appended to this same file in later tasks — `CreateBookingDto`, `UpdateBookingStatusDto`.)

- [ ] **Step 2: `AvailabilityService`** — `apps/api/src/booking/availability.service.ts`

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThan, Repository } from 'typeorm';
import { SalonService } from '../salons/salon-service.entity';
import { ScheduleException } from '../salons/schedule-exception.entity';
import { WorkingHour } from '../salons/working-hour.entity';
import { Salon } from '../salons/salon.entity';
import { Booking } from './booking.entity';
import { computeAvailableSlots, DayAvailability, WorkingHourRange } from './availability.util';

const AVAILABILITY_WINDOW_DAYS = 14;

@Injectable()
export class AvailabilityService {
  constructor(
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    @InjectRepository(WorkingHour) private readonly hours: Repository<WorkingHour>,
    @InjectRepository(ScheduleException) private readonly exceptions: Repository<ScheduleException>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
  ) {}

  async computeFor(salonId: string, serviceId: string, now: Date = new Date()): Promise<DayAvailability[]> {
    const salon = await this.salons.findOneBy({ id: salonId, status: 'approved' });
    if (!salon) throw new NotFoundException('Salon not found');

    const service = await this.services.findOneBy({ id: serviceId, salonId, isActive: true });
    if (!service) throw new NotFoundException('Service not found');

    const [hourRows, exceptionRows, existingBookingRows] = await Promise.all([
      this.hours.find({ where: { salonId } }),
      this.exceptions.find({ where: { salonId, isClosed: true } }),
      this.bookings.find({
        where: {
          salonId,
          status: 'confirmed' as const,
          startsAt: LessThan(new Date(now.getTime() + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60_000)),
          endsAt: MoreThan(now),
        },
      }),
    ]);

    const pendingBookingRows = await this.bookings.find({
      where: {
        salonId,
        status: 'pending_payment' as const,
        startsAt: LessThan(new Date(now.getTime() + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60_000)),
        endsAt: MoreThan(now),
      },
    });

    const hoursByWeekday = new Map<number, WorkingHourRange[]>();
    for (const h of hourRows) {
      const existing = hoursByWeekday.get(h.weekday) ?? [];
      existing.push({ openTime: h.openTime, closeTime: h.closeTime });
      hoursByWeekday.set(h.weekday, existing);
    }

    return computeAvailableSlots({
      now,
      days: AVAILABILITY_WINDOW_DAYS,
      durationMin: service.durationMin,
      capacity: salon.capacity,
      hoursByWeekday,
      closedDates: new Set(exceptionRows.map((e) => e.date)),
      existingBookings: [...existingBookingRows, ...pendingBookingRows].map((b) => ({
        startsAt: b.startsAt,
        endsAt: b.endsAt,
      })),
    });
  }
}
```

(Both `confirmed` and `pending_payment` bookings count against capacity — a slot someone else is mid-checkout on must not be offered to a second customer, which is exactly what the design spec's "double booking is impossible" claim depends on. `pending_payment` rows older than the hold TTL are cleaned up by Task 14's expiry job, so this can't accumulate stale holds indefinitely.)

- [ ] **Step 3: Controller + module** — new file `apps/api/src/booking/booking.module.ts` (this task only wires availability; Tasks 9-15 add to this same module)

Create `apps/api/src/booking/availability.controller.ts`:

```typescript
import { Controller, Get, Param, Query } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { AvailabilityQueryDto } from './dto/booking.dto';

@Controller('salons/:salonId/availability')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  get(@Param('salonId') salonId: string, @Query() query: AvailabilityQueryDto) {
    return this.availability.computeFor(salonId, query.serviceId);
  }
}
```

Create `apps/api/src/booking/booking.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalonsModule } from '../salons/salons.module';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { Booking } from './booking.entity';
import { Payment } from './payment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Payment]),
    SalonsModule,
  ],
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
})
export class BookingModule {}
```

Register in `apps/api/src/app.module.ts`:

```typescript
import { BookingModule } from './booking/booking.module';
```

Add `BookingModule` to `imports`, after `SalonsModule`.

(This new controller's path is `salons/:salonId/availability` — a completely distinct route tree from `SalonsController`'s `salons/:slug` and from `SalonServicesController`'s/`ScheduleController`'s `salons/mine/*`. No registration-order concern applies here: Express only matches `:salonId` against a single path segment, so `/salons/<uuid>/availability` (3 segments) can never collide with `/salons/:slug` (2 segments) regardless of which module registers first.)

- [ ] **Step 4: Write the e2e test** — `apps/api/test/availability.e2e-spec.ts`

Seeds a salon (bypassing the approval-request flow via direct SQL, same pattern as Plan 1's `search.e2e-spec.ts`) with real working hours, a schedule exception, and one existing booking, then hits the endpoint.

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Availability (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09124440000');

    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send({
      name: 'Availability Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 1,
    });
    salonId = salonRes.body.id;

    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', cookie)
      .send({ categoryId: 1, name: 'Cut', price: 500000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);

    // open every day 09:00-11:00 (weekdays 0-6)
    const hoursRows = Array.from({ length: 7 }, (_, weekday) => `('${salonId}', ${weekday}, '09:00', '11:00')`).join(',');
    await ds.query(`INSERT INTO working_hours (salon_id, weekday, open_time, close_time) VALUES ${hoursRows}`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 14 days of availability with at least one slot per day', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/salons/${salonId}/availability`)
      .query({ serviceId })
      .expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.length).toBeLessThanOrEqual(14);
    expect(res.body[0].slots).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it('excludes a date added as a closed schedule exception', async () => {
    const before = await request(app.getHttpServer())
      .get(`/api/salons/${salonId}/availability`)
      .query({ serviceId })
      .expect(200);
    const targetDate = before.body[0].date;

    const ds = app.get(DataSource);
    await ds.query(
      `INSERT INTO schedule_exceptions (salon_id, date, is_closed) VALUES ($1, $2, true)`,
      [salonId, targetDate],
    );

    const after = await request(app.getHttpServer())
      .get(`/api/salons/${salonId}/availability`)
      .query({ serviceId })
      .expect(200);
    expect(after.body.map((d: { date: string }) => d.date)).not.toContain(targetDate);
  });

  it('404s for a service that does not belong to the salon', () =>
    request(app.getHttpServer())
      .get(`/api/salons/${salonId}/availability`)
      .query({ serviceId: '00000000-0000-4000-8000-000000000099' })
      .expect(404));

  it('404s for a salon that is not approved', async () => {
    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'pending' WHERE id = $1`, [salonId]);
    await request(app.getHttpServer())
      .get(`/api/salons/${salonId}/availability`)
      .query({ serviceId })
      .expect(404);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
  });
});
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm --filter @arayeshgah/api test:e2e -- availability`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/booking apps/api/src/app.module.ts apps/api/test/availability.e2e-spec.ts
git commit -m "feat(api): add availability orchestrator service and public endpoint"
```

---

### Task 9: `PaymentGateway` interface + `MockPaymentGateway` + `ZarinpalGateway`

**Files:**
- Create: `apps/api/src/booking/payment-gateway.ts`
- Create: `apps/api/src/booking/mock-payment.gateway.ts`
- Create: `apps/api/src/booking/zarinpal-payment.gateway.ts`
- Test: `apps/api/src/booking/zarinpal-payment.gateway.spec.ts`
- Modify: `.env.example`
- Modify: `apps/api/.env.test`

- [ ] **Step 1: The interface** — `apps/api/src/booking/payment-gateway.ts`

```typescript
export const PAYMENT_GATEWAY = 'PAYMENT_GATEWAY';

export interface PaymentRequestResult {
  authority: string;
  paymentUrl: string;
}

export interface PaymentVerifyResult {
  success: boolean;
  refId: string | null;
}

export interface PaymentGateway {
  requestPayment(amountToman: number, description: string, callbackUrl: string): Promise<PaymentRequestResult>;
  verifyPayment(authority: string, amountToman: number): Promise<PaymentVerifyResult>;
}
```

- [ ] **Step 2: `MockPaymentGateway`** — `apps/api/src/booking/mock-payment.gateway.ts`

Used in dev/test (default) so no automated test or local dev session ever calls the real Zarinpal API. An authority starting with `MOCK-FAIL` always fails verification — this lets e2e tests deterministically exercise the failure path without any conditional test-only branching in production code.

```typescript
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PaymentGateway, PaymentRequestResult, PaymentVerifyResult } from './payment-gateway';

@Injectable()
export class MockPaymentGateway implements PaymentGateway {
  async requestPayment(_amountToman: number, _description: string, callbackUrl: string): Promise<PaymentRequestResult> {
    const authority = `MOCK-${randomBytes(8).toString('hex')}`;
    return { authority, paymentUrl: `${callbackUrl}?Authority=${authority}&Status=OK` };
  }

  async verifyPayment(authority: string, _amountToman: number): Promise<PaymentVerifyResult> {
    if (authority.startsWith('MOCK-FAIL')) return { success: false, refId: null };
    return { success: true, refId: `MOCKREF-${authority}` };
  }
}
```

- [ ] **Step 3: Write the failing Zarinpal test** — `apps/api/src/booking/zarinpal-payment.gateway.spec.ts`

```typescript
import { ZarinpalGateway } from './zarinpal-payment.gateway';

describe('ZarinpalGateway', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });

  it('requests a payment with amount converted from toman to rial', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { code: 100, authority: 'AUTH123', message: 'ok' }, errors: [] }),
    });
    const gateway = new ZarinpalGateway('MERCHANT_ID');
    const result = await gateway.requestPayment(200000, 'Deposit for Rose Beauty', 'https://api.example.com/callback');

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://payment.zarinpal.com/pg/v4/payment/request.json');
    const body = JSON.parse(options.body);
    expect(body.merchant_id).toBe('MERCHANT_ID');
    expect(body.amount).toBe(2000000); // 200000 toman * 10 = rial
    expect(body.callback_url).toBe('https://api.example.com/callback');
    expect(result.authority).toBe('AUTH123');
    expect(result.paymentUrl).toBe('https://payment.zarinpal.com/pg/StartPay/AUTH123');
  });

  it('throws when zarinpal reports a non-100 code on request', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: null, errors: [{ code: -9, message: 'Invalid merchant' }] }),
    });
    const gateway = new ZarinpalGateway('MERCHANT_ID');
    await expect(gateway.requestPayment(200000, 'x', 'https://x.com/cb')).rejects.toThrow();
  });

  it('treats verify code 100 as success', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { code: 100, ref_id: 987654, message: 'ok' }, errors: [] }),
    });
    const gateway = new ZarinpalGateway('MERCHANT_ID');
    const result = await gateway.verifyPayment('AUTH123', 200000);
    expect(result.success).toBe(true);
    expect(result.refId).toBe('987654');
  });

  it('treats verify code 101 (already verified) as success too', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { code: 101, ref_id: 987654, message: 'already verified' }, errors: [] }),
    });
    const gateway = new ZarinpalGateway('MERCHANT_ID');
    const result = await gateway.verifyPayment('AUTH123', 200000);
    expect(result.success).toBe(true);
  });

  it('treats any other verify code as failure, not a thrown error', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { code: -50, message: 'not found' }, errors: [] }),
    });
    const gateway = new ZarinpalGateway('MERCHANT_ID');
    const result = await gateway.verifyPayment('AUTH123', 200000);
    expect(result.success).toBe(false);
  });

  it('normalizes a network-level fetch failure into a thrown error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const gateway = new ZarinpalGateway('MERCHANT_ID');
    await expect(gateway.requestPayment(200000, 'x', 'https://x.com/cb')).rejects.toThrow('Zarinpal');
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @arayeshgah/api test -- zarinpal-payment`
Expected: FAIL — `Cannot find module './zarinpal-payment.gateway'`.

- [ ] **Step 5: Implement** — `apps/api/src/booking/zarinpal-payment.gateway.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { PaymentGateway, PaymentRequestResult, PaymentVerifyResult } from './payment-gateway';

const REQUEST_URL = 'https://payment.zarinpal.com/pg/v4/payment/request.json';
const VERIFY_URL = 'https://payment.zarinpal.com/pg/v4/payment/verify.json';
const STARTPAY_URL = 'https://payment.zarinpal.com/pg/StartPay';
const TOMAN_TO_RIAL = 10;

interface ZarinpalRequestResponse {
  data: { code: number; authority: string; message: string } | null;
  errors: unknown;
}

interface ZarinpalVerifyResponse {
  data: { code: number; ref_id: number; message: string } | null;
  errors: unknown;
}

/**
 * Field names and status codes (merchant_id, callback_url, code 100/101,
 * the /pg/v4/payment/* endpoints, /pg/StartPay/{authority}) are Zarinpal's
 * documented v4 REST contract. VERIFY AGAINST ZARINPAL'S SANDBOX before
 * taking real payments -- see this plan's header note for why that couldn't
 * be done during planning. Every automated test uses MockPaymentGateway;
 * nothing in the test suite calls this class's real network path.
 */
@Injectable()
export class ZarinpalGateway implements PaymentGateway {
  constructor(private readonly merchantId: string) {}

  async requestPayment(amountToman: number, description: string, callbackUrl: string): Promise<PaymentRequestResult> {
    let res: Response;
    try {
      res = await fetch(REQUEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: this.merchantId,
          amount: amountToman * TOMAN_TO_RIAL,
          callback_url: callbackUrl,
          description,
        }),
      });
    } catch (err) {
      throw new Error(`Zarinpal request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const body = (await res.json()) as ZarinpalRequestResponse;
    if (!res.ok || body.data?.code !== 100) {
      throw new Error(`Zarinpal request failed: ${JSON.stringify(body.errors ?? body.data)}`);
    }
    return {
      authority: body.data.authority,
      paymentUrl: `${STARTPAY_URL}/${body.data.authority}`,
    };
  }

  async verifyPayment(authority: string, amountToman: number): Promise<PaymentVerifyResult> {
    let res: Response;
    try {
      res = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: this.merchantId,
          amount: amountToman * TOMAN_TO_RIAL,
          authority,
        }),
      });
    } catch (err) {
      throw new Error(`Zarinpal verify failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const body = (await res.json()) as ZarinpalVerifyResponse;
    if (body.data?.code === 100 || body.data?.code === 101) {
      return { success: true, refId: String(body.data.ref_id) };
    }
    return { success: false, refId: null };
  }
}
```

- [ ] **Step 6: Run tests to verify pass**

Run: `pnpm --filter @arayeshgah/api test -- zarinpal-payment`
Expected: PASS (6 tests).

- [ ] **Step 7: Add new env vars** — append to `.env.example`:

```
PAYMENT_GATEWAY=mock
ZARINPAL_MERCHANT_ID=
APP_BASE_URL=http://localhost:3002
```

Append to `apps/api/.env.test`:

```
PAYMENT_GATEWAY=mock
ZARINPAL_MERCHANT_ID=
APP_BASE_URL=http://localhost:3003
```

(`PAYMENT_GATEWAY=mock` in both means the real `ZarinpalGateway` is never constructed in dev or test unless someone explicitly flips it to `zarinpal` and provides a real `ZARINPAL_MERCHANT_ID` — mirroring exactly how `SMS_PROVIDER=console` works in Plan 1.)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/booking .env.example apps/api/.env.test
git commit -m "feat(api): add PaymentGateway interface with mock and zarinpal implementations"
```

---

### Task 10: `BookingsService.createHold` + `POST /bookings`

**Files:**
- Modify: `apps/api/src/booking/dto/booking.dto.ts` (add `CreateBookingDto`)
- Create: `apps/api/src/booking/bookings.service.ts`
- Create: `apps/api/src/booking/bookings.controller.ts`
- Modify: `apps/api/src/booking/booking.module.ts`
- Test: `apps/api/test/bookings.e2e-spec.ts`

**Context on the two-phase transaction:** the DB transaction that inserts the booking+payment rows and re-checks capacity must NOT stay open while waiting on Zarinpal's network response — holding a DB transaction/connection open across an external HTTP call is a real reliability risk (connection pool exhaustion under load, long lock hold times). So this task commits the transaction first (booking `pending_payment`, payment `initiated` with no `authority` yet), releases the Redis lock, THEN calls the gateway, THEN does a small separate `UPDATE` to attach the resulting `authority`. If the gateway call itself fails after the transaction commits, the booking is simply left `pending_payment` with no authority — Task 14's expiry job cleans it up once the hold TTL passes, so this failure mode is self-healing, not a leak.

- [ ] **Step 1: Add `CreateBookingDto`** — append to `apps/api/src/booking/dto/booking.dto.ts`

```typescript

export class CreateBookingDto {
  @IsUUID()
  salonId: string;

  @IsUUID()
  serviceId: string;

  @IsISO8601()
  startsAt: string;
}
```

Update the file's import line to include the new decorator:

```typescript
import { IsISO8601, IsUUID } from 'class-validator';
```

- [ ] **Step 2: `BookingsService`** — `apps/api/src/booking/bookings.service.ts`

```typescript
import {
  BadRequestException, ConflictException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource, In, LessThan, MoreThan, Repository } from 'typeorm';
import { REDIS } from '../redis/redis.module';
import { SalonService } from '../salons/salon-service.entity';
import { Salon } from '../salons/salon.entity';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { Booking } from './booking.entity';
import { CreateBookingDto } from './dto/booking.dto';
import { calculateDeposit } from './deposit.util';
import { PAYMENT_GATEWAY, PaymentGateway } from './payment-gateway';
import { Payment } from './payment.entity';

const LOCK_TTL_MS = 5000;

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    private readonly dataSource: DataSource,
    private readonly config: PlatformConfigService,
    private readonly nestConfig: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async createHold(userId: string, dto: CreateBookingDto): Promise<{ booking: Booking; paymentUrl: string }> {
    const salon = await this.salons.findOneBy({ id: dto.salonId, status: 'approved' });
    if (!salon) throw new NotFoundException('Salon not found');

    const service = await this.services.findOneBy({ id: dto.serviceId, salonId: dto.salonId, isActive: true });
    if (!service) throw new NotFoundException('Service not found');

    const startsAt = new Date(dto.startsAt);
    if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) {
      throw new BadRequestException('startsAt must be a valid future date-time');
    }
    const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);

    // Locked per-SALON, not per-exact-slot-instant. A salon offering services with
    // different durations can produce two bookings with different startsAt values
    // whose intervals still overlap (e.g. a 90-min booking at 09:00 and a 30-min
    // booking at 09:30) -- a lock keyed on the exact instant wouldn't serialize
    // those against each other, and under READ COMMITTED both transactions could
    // read the same (incomplete) overlap count before either commits. Locking the
    // whole salon means the entire check-then-insert critical section below is
    // fully serialized per salon regardless of duration or capacity, which is what
    // actually backs the "double booking is impossible" guarantee.
    const lockKey = `lock:booking:${dto.salonId}`;
    const acquired = await this.redis.set(lockKey, '1', 'PX', LOCK_TTL_MS, 'NX');
    if (!acquired) throw new ConflictException('This slot is being booked by someone else, try again');

    let booking: Booking;
    let depositAmount: number;
    try {
      const result = await this.dataSource.transaction(async (em) => {
        const overlapping = await em.count(Booking, {
          where: {
            salonId: dto.salonId,
            status: In(['pending_payment', 'confirmed']),
            startsAt: LessThan(endsAt),
            endsAt: MoreThan(startsAt),
          },
        });
        if (overlapping >= salon.capacity) throw new ConflictException('Slot no longer available');

        const depositPercent = await this.config.getDepositPercent();
        const depositMin = await this.config.getDepositMinToman();
        const deposit = calculateDeposit(service.price, depositPercent, depositMin);

        const savedBooking = await em.save(
          Booking,
          em.create(Booking, {
            userId,
            salonId: dto.salonId,
            serviceId: dto.serviceId,
            startsAt,
            endsAt,
            priceSnapshot: service.price,
            depositAmount: deposit,
            status: 'pending_payment',
          }),
        );
        await em.save(
          Payment,
          em.create(Payment, {
            bookingId: savedBooking.id,
            amount: deposit,
            gateway: 'zarinpal',
            status: 'initiated',
          }),
        );
        return { booking: savedBooking, depositAmount: deposit };
      });
      booking = result.booking;
      depositAmount = result.depositAmount;
    } finally {
      await this.redis.del(lockKey);
    }

    const callbackUrl = `${this.nestConfig.getOrThrow('APP_BASE_URL')}/api/payments/callback`;
    const { authority, paymentUrl } = await this.gateway.requestPayment(
      depositAmount,
      `Booking deposit for ${salon.name}`,
      callbackUrl,
    );
    await this.payments.update({ bookingId: booking.id }, { authority });

    return { booking, paymentUrl };
  }

  async findMine(userId: string, id: string): Promise<Booking> {
    const booking = await this.bookings.findOneBy({ id, userId });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  listMine(userId: string): Promise<Booking[]> {
    return this.bookings.find({ where: { userId }, order: { startsAt: 'DESC' } });
  }
}
```

- [ ] **Step 3: Controller** — `apps/api/src/booking/bookings.controller.ts`

`mine` is declared before `:id` for the same reason as `SalonsController` in Plan 1 — both are 2-segment paths under the same controller, so declaration order decides which wins.

```typescript
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/booking.dto';

@Controller('bookings')
@UseGuards(AuthGuard)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateBookingDto) {
    return this.bookings.createHold((req.user as User).id, dto);
  }

  @Get('mine')
  listMine(@Req() req: Request) {
    return this.bookings.listMine((req.user as User).id);
  }

  @Get(':id')
  findMine(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.findMine((req.user as User).id, id);
  }
}
```

- [ ] **Step 4: Wire into `booking.module.ts`**

Replace the whole file:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { SalonsModule } from '../salons/salons.module';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { Booking } from './booking.entity';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { MockPaymentGateway } from './mock-payment.gateway';
import { PAYMENT_GATEWAY } from './payment-gateway';
import { Payment } from './payment.entity';
import { ZarinpalGateway } from './zarinpal-payment.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Payment]),
    SalonsModule,
    PlatformConfigModule,
    AuthModule,
  ],
  controllers: [AvailabilityController, BookingsController],
  providers: [
    AvailabilityService,
    BookingsService,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get('PAYMENT_GATEWAY') === 'zarinpal'
          ? new ZarinpalGateway(config.getOrThrow('ZARINPAL_MERCHANT_ID'))
          : new MockPaymentGateway(),
    },
  ],
})
export class BookingModule {}
```

**Why `AuthModule` is added here:** `BookingsController` uses `@UseGuards(AuthGuard)`, and `AuthGuard` is only a registered provider inside `AuthModule` (exported via `exports: [OtpService, AuthGuard, RolesGuard, UsersModule]`). `SalonsModule` imports `AuthModule` for its own guards but does not re-export it, so `BookingModule` must import `AuthModule` directly to resolve `AuthGuard` — the same reason `salons.module.ts` itself imports `AuthModule`.

- [ ] **Step 5: Write the e2e test** — `apps/api/test/bookings.e2e-spec.ts`

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Bookings — create hold (e2e)', () => {
  let app: INestApplication;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    const ownerCookie = await loginAs(app, '09125550001');
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Booking Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 1,
    });
    salonId = salonRes.body.id;

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

    customerCookie = await loginAs(app, '09126660002');
  });

  afterAll(async () => {
    await app.close();
  });

  function futureIso(hoursFromNow: number): string {
    return new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString();
  }

  it('creates a pending_payment booking with a 20% deposit and a mock payment URL', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(24) })
      .expect(201);

    expect(res.body.booking.status).toBe('pending_payment');
    expect(res.body.booking.priceSnapshot).toBe(500000);
    expect(res.body.booking.depositAmount).toBe(100000); // 20% of 500000
    expect(res.body.paymentUrl).toContain('Authority=MOCK-');
  });

  it('rejects a startsAt in the past', () =>
    request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(-1) })
      .expect(400));

  it('rejects a second overlapping booking once capacity (1) is full', async () => {
    const startsAt = futureIso(48);
    await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt })
      .expect(201);

    const secondCustomer = await loginAs(app, '09127770003');
    await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', secondCustomer)
      .send({ salonId, serviceId, startsAt })
      .expect(409);
  });

  it('lists the caller\'s own bookings via GET /bookings/mine', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/bookings/mine')
      .set('Cookie', customerCookie)
      .expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('fetches a single booking by id, scoped to the caller', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(72) })
      .expect(201);
    const bookingId = created.body.booking.id;

    await request(app.getHttpServer())
      .get(`/api/bookings/${bookingId}`)
      .set('Cookie', customerCookie)
      .expect(200);

    const otherCustomer = await loginAs(app, '09128880004');
    await request(app.getHttpServer())
      .get(`/api/bookings/${bookingId}`)
      .set('Cookie', otherCustomer)
      .expect(404);
  });

  it('requires auth to create a booking', () =>
    request(app.getHttpServer())
      .post('/api/bookings')
      .send({ salonId, serviceId, startsAt: futureIso(24) })
      .expect(401));
});
```

- [ ] **Step 6: Run, verify pass**

Run: `pnpm --filter @arayeshgah/api test:e2e -- bookings`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/booking apps/api/test/bookings.e2e-spec.ts
git commit -m "feat(api): booking creation with redis lock, transactional capacity check, and deposit initiation"
```

---

### Task 11: `PaymentsService` — the Zarinpal callback

**Files:**
- Create: `apps/api/src/booking/payments.service.ts`
- Create: `apps/api/src/booking/payments.controller.ts`
- Modify: `apps/api/src/booking/booking.module.ts`
- Test: `apps/api/test/payments.e2e-spec.ts`

**Design note on the response shape:** the real Zarinpal flow redirects the user's browser back to `callback_url?Authority=...&Status=OK|NOK`, and a production API would then redirect the browser again to a frontend result page. No frontend exists yet in this plan (`user-app` is a later plan), so this endpoint returns a plain JSON body describing the outcome instead of issuing an HTTP redirect — simpler to test, and a natural place for a future plan to wrap in an actual redirect once there's a page to redirect to.

- [ ] **Step 1: `PaymentsService`** — `apps/api/src/booking/payments.service.ts`

```typescript
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';
import { SalonsService } from '../salons/salons.service';
import { UsersService } from '../users/users.service';
import { Booking } from './booking.entity';
import { PAYMENT_GATEWAY, PaymentGateway } from './payment-gateway';
import { Payment } from './payment.entity';

export type CallbackOutcome = 'success' | 'failed' | 'already-confirmed';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly dataSource: DataSource,
    private readonly salonsService: SalonsService,
    private readonly usersService: UsersService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async handleCallback(authority: string, status: string): Promise<{ status: CallbackOutcome; bookingId: string }> {
    const payment = await this.payments.findOneBy({ authority });
    if (!payment) throw new NotFoundException('Payment not found');

    if (payment.status === 'paid') {
      return { status: 'already-confirmed', bookingId: payment.bookingId };
    }
    if (payment.status !== 'initiated') {
      return { status: 'failed', bookingId: payment.bookingId };
    }

    if (status !== 'OK') {
      await this.markFailed(payment.id, payment.bookingId);
      return { status: 'failed', bookingId: payment.bookingId };
    }

    const verify = await this.gateway.verifyPayment(authority, payment.amount);
    if (!verify.success) {
      await this.markFailed(payment.id, payment.bookingId);
      return { status: 'failed', bookingId: payment.bookingId };
    }

    await this.dataSource.transaction(async (em) => {
      await em.update(Payment, { id: payment.id }, { status: 'paid', refId: verify.refId });
      await em.update(Booking, { id: payment.bookingId }, { status: 'confirmed' });
    });

    await this.notifyConfirmed(payment.bookingId);

    return { status: 'success', bookingId: payment.bookingId };
  }

  private async markFailed(paymentId: string, bookingId: string): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await em.update(Payment, { id: paymentId }, { status: 'failed' });
      await em.update(Booking, { id: bookingId }, { status: 'cancelled_by_user' });
    });
  }

  private async notifyConfirmed(bookingId: string): Promise<void> {
    const booking = await this.bookings.findOneBy({ id: bookingId });
    if (!booking) return;
    const salon = await this.salonsService.findById(booking.salonId);
    if (!salon) return;
    const [customer, owner] = await Promise.all([
      this.usersService.findById(booking.userId),
      this.usersService.findById(salon.ownerId),
    ]);
    const when = booking.startsAt.toISOString();

    // SMS failures never roll back a confirmed booking (per the design spec's error-handling
    // section) -- this is a best-effort notification, not a queued-with-retry system yet.
    if (customer) {
      await this.sms.send(customer.phone, `Booking confirmed at ${salon.name}, ${when}. Address: ${salon.address}`).catch(() => {});
    }
    if (owner) {
      await this.sms.send(owner.phone, `New booking at ${salon.name} for ${when}`).catch(() => {});
    }
  }
}
```

- [ ] **Step 2: Controller** — `apps/api/src/booking/payments.controller.ts`

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('callback')
  callback(@Query('Authority') authority: string, @Query('Status') status: string) {
    return this.payments.handleCallback(authority, status);
  }
}
```

- [ ] **Step 3: Wire into `booking.module.ts`**

Add imports for `SmsModule` (for `SMS_PROVIDER`, used by `PaymentsService.notifyConfirmed`) and `UsersModule` (for `UsersService`, used the same way), keeping the `AuthModule` import from Task 10, and register the new controller/service:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { SalonsModule } from '../salons/salons.module';
import { SmsModule } from '../sms/sms.module';
import { UsersModule } from '../users/users.module';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { Booking } from './booking.entity';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { MockPaymentGateway } from './mock-payment.gateway';
import { PAYMENT_GATEWAY } from './payment-gateway';
import { Payment } from './payment.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ZarinpalGateway } from './zarinpal-payment.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Payment]),
    SalonsModule,
    PlatformConfigModule,
    AuthModule,
    SmsModule,
    UsersModule,
  ],
  controllers: [AvailabilityController, BookingsController, PaymentsController],
  providers: [
    AvailabilityService,
    BookingsService,
    PaymentsService,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get('PAYMENT_GATEWAY') === 'zarinpal'
          ? new ZarinpalGateway(config.getOrThrow('ZARINPAL_MERCHANT_ID'))
          : new MockPaymentGateway(),
    },
  ],
})
export class BookingModule {}
```

(`UsersModule` is imported directly here for `UsersService` rather than relying on `AuthModule`'s own transitive re-export of it — `AuthModule` exports `UsersModule` too, so this is slightly redundant but explicit about what `BookingModule` actually depends on, matching this codebase's existing preference for directness over relying on transitive re-exports as an implementation detail.)

- [ ] **Step 4: Write the e2e test** — `apps/api/test/payments.e2e-spec.ts`

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Payments — callback (e2e)', () => {
  let app: INestApplication;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    const ownerCookie = await loginAs(app, '09129990005');
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Payments Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 1,
    });
    salonId = salonRes.body.id;

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

    customerCookie = await loginAs(app, '09121010006');
  });

  afterAll(async () => {
    await app.close();
  });

  function futureIso(hoursFromNow: number): string {
    return new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString();
  }

  function extractAuthority(paymentUrl: string): string {
    return new URL(paymentUrl).searchParams.get('Authority')!;
  }

  it('confirms the booking and marks the payment paid on a successful callback', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(24) })
      .expect(201);
    const authority = extractAuthority(created.body.paymentUrl);

    const res = await request(app.getHttpServer())
      .get('/api/payments/callback')
      .query({ Authority: authority, Status: 'OK' })
      .expect(200);
    expect(res.body.status).toBe('success');

    const booking = await request(app.getHttpServer())
      .get(`/api/bookings/${created.body.booking.id}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(booking.body.status).toBe('confirmed');
  });

  it('is idempotent — calling the callback again on an already-paid booking returns already-confirmed, not an error', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(48) })
      .expect(201);
    const authority = extractAuthority(created.body.paymentUrl);

    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(200);
    const second = await request(app.getHttpServer())
      .get('/api/payments/callback')
      .query({ Authority: authority, Status: 'OK' })
      .expect(200);
    expect(second.body.status).toBe('already-confirmed');
  });

  it('cancels the booking when Zarinpal reports Status=NOK', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(72) })
      .expect(201);
    const authority = extractAuthority(created.body.paymentUrl);

    const res = await request(app.getHttpServer())
      .get('/api/payments/callback')
      .query({ Authority: authority, Status: 'NOK' })
      .expect(200);
    expect(res.body.status).toBe('failed');

    const booking = await request(app.getHttpServer())
      .get(`/api/bookings/${created.body.booking.id}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(booking.body.status).toBe('cancelled_by_user');
  });

  it('404s for an authority that does not exist', () =>
    request(app.getHttpServer())
      .get('/api/payments/callback')
      .query({ Authority: 'MOCK-doesnotexist', Status: 'OK' })
      .expect(404));
});
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm --filter @arayeshgah/api test:e2e -- payments`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/booking apps/api/test/payments.e2e-spec.ts
git commit -m "feat(api): zarinpal callback handling with idempotent confirm and sms notifications"
```

---

### Task 12: Provider-side booking list + completion/no-show

**Files:**
- Modify: `apps/api/src/booking/dto/booking.dto.ts` (add `UpdateBookingStatusDto`)
- Create: `apps/api/src/booking/salon-bookings.controller.ts`
- Modify: `apps/api/src/booking/bookings.service.ts` (add provider-facing methods)
- Modify: `apps/api/src/booking/booking.module.ts`
- Test: `apps/api/test/salon-bookings.e2e-spec.ts`

This is the "third occurrence" `SalonOwnerGuard` (Task 2) was extracted for — this controller uses it directly, with zero duplicated ownership-resolution code.

- [ ] **Step 1: Add `UpdateBookingStatusDto`** — append to `apps/api/src/booking/dto/booking.dto.ts`

```typescript

export class UpdateBookingStatusDto {
  @IsIn(['completed', 'no_show'])
  status: 'completed' | 'no_show';
}
```

Update the import line:

```typescript
import { IsIn, IsISO8601, IsUUID } from 'class-validator';
```

- [ ] **Step 2: Add provider-facing methods to `BookingsService`**

Append these two methods to the `BookingsService` class in `apps/api/src/booking/bookings.service.ts` (after `listMine`, before the closing `}`):

```typescript

  listForSalon(salonId: string): Promise<Booking[]> {
    return this.bookings.find({ where: { salonId }, order: { startsAt: 'DESC' } });
  }

  async updateStatus(salonId: string, bookingId: string, status: 'completed' | 'no_show'): Promise<Booking> {
    const booking = await this.bookings.findOneBy({ id: bookingId, salonId });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== 'confirmed') {
      throw new BadRequestException('Only confirmed bookings can be marked completed or no-show');
    }
    // Both outcomes leave the payment `paid` -- a no-show forfeits the deposit to the
    // salon (no refund), and a completion's deposit is deducted from the in-salon total,
    // tracked outside this system for MVP. Neither calls a real payout/refund API; see
    // this plan's header note on why that's explicitly out of scope.
    await this.bookings.update({ id: bookingId }, { status });
    return (await this.bookings.findOneBy({ id: bookingId }))!;
  }
```

- [ ] **Step 3: Controller** — `apps/api/src/booking/salon-bookings.controller.ts`

```typescript
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { SalonOwnerGuard } from '../salons/salon-owner.guard';
import { BookingsService } from './bookings.service';
import { UpdateBookingStatusDto } from './dto/booking.dto';

@Controller('salons/mine/bookings')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class SalonBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  list(@Req() req: Request) {
    return this.bookings.listForSalon(req.salonId!);
  }

  @Patch(':id')
  updateStatus(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBookingStatusDto,
  ) {
    return this.bookings.updateStatus(req.salonId!, id, dto.status);
  }
}
```

- [ ] **Step 4: Register in `booking.module.ts`**

Add the import and controller registration:

```typescript
import { SalonBookingsController } from './salon-bookings.controller';
```

```typescript
  controllers: [AvailabilityController, BookingsController, PaymentsController, SalonBookingsController],
```

(No registration-order concern here either — `salons/mine/bookings` is a 3-segment base path, provably disjoint from `SalonsController`'s 2-segment `salons/:slug`, same reasoning as Task 8's `AvailabilityController`.)

- [ ] **Step 5: Write the e2e test** — `apps/api/test/salon-bookings.e2e-spec.ts`

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Salon-side booking management (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;
  let confirmedBookingId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09122020007');
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Provider Bookings Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 1,
    });
    salonId = salonRes.body.id;

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

    customerCookie = await loginAs(app, '09123030008');
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() })
      .expect(201);
    confirmedBookingId = created.body.booking.id;
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the salon\'s bookings for the owner', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/salons/mine/bookings')
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(res.body.map((b: { id: string }) => b.id)).toContain(confirmedBookingId);
  });

  it('rejects a non-owner from listing the salon\'s bookings', () =>
    request(app.getHttpServer())
      .get('/api/salons/mine/bookings')
      .set('Cookie', customerCookie)
      .expect(404)); // customer has no salon of their own -- SalonOwnerGuard 404s via findMine

  it('marks a confirmed booking completed', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${confirmedBookingId}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);
    expect(res.body.status).toBe('completed');
  });

  it('rejects marking an already-completed booking again', () =>
    request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${confirmedBookingId}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'no_show' })
      .expect(400));

  it('rejects an invalid status value', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString() })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${created.body.booking.id}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'bogus' })
      .expect(400);
  });
});
```

- [ ] **Step 6: Run, verify pass**

Run: `pnpm --filter @arayeshgah/api test:e2e -- salon-bookings`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/booking apps/api/test/salon-bookings.e2e-spec.ts
git commit -m "feat(api): provider booking list and completed/no-show status updates"
```

---

### Task 13: Cancellation with the spec's refund policy

**Files:**
- Modify: `apps/api/src/booking/bookings.service.ts` (add `cancel`)
- Modify: `apps/api/src/booking/bookings.controller.ts` (add the route)
- Modify: `apps/api/src/booking/booking.module.ts` (inject new dependencies)
- Test: `apps/api/test/booking-cancellation.e2e-spec.ts`

- [ ] **Step 1: Add `cancel` to `BookingsService`**

`BookingsService` needs `SalonsService` (to resolve `salon.ownerId` and check who's cancelling) and `PlatformConfigService` (already injected) for the cancellation window. Update the constructor and add the method.

In `apps/api/src/booking/bookings.service.ts`, update the imports and constructor:

```typescript
import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
```

```typescript
  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    private readonly dataSource: DataSource,
    private readonly config: PlatformConfigService,
    private readonly salonsService: SalonsService,
    private readonly nestConfig: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}
```

Add this import alongside the others at the top of the file:

```typescript
import { SalonsService } from '../salons/salons.service';
```

Append the method (after `listMine`, before the two provider-facing methods added in Task 12):

```typescript

  async cancel(bookingId: string, callerId: string): Promise<Booking> {
    const booking = await this.bookings.findOneBy({ id: bookingId });
    if (!booking) throw new NotFoundException('Booking not found');
    const cancellableStatuses: string[] = ['pending_payment', 'confirmed'];
    if (!cancellableStatuses.includes(booking.status)) {
      throw new BadRequestException('Booking cannot be cancelled in its current state');
    }

    const salon = await this.salonsService.findById(booking.salonId);
    if (!salon) throw new NotFoundException('Salon not found');

    const isCustomer = booking.userId === callerId;
    const isOwner = salon.ownerId === callerId;
    if (!isCustomer && !isOwner) throw new ForbiddenException('You cannot cancel this booking');

    let newBookingStatus: 'cancelled_by_user' | 'cancelled_by_salon';
    let refund: boolean;

    if (isOwner) {
      newBookingStatus = 'cancelled_by_salon';
      refund = true;
    } else {
      const cancellationWindowHours = await this.config.getCancellationWindowHours();
      const hoursUntilStart = (booking.startsAt.getTime() - Date.now()) / (1000 * 60 * 60);
      newBookingStatus = 'cancelled_by_user';
      refund = hoursUntilStart >= cancellationWindowHours;
    }

    await this.dataSource.transaction(async (em) => {
      await em.update(Booking, { id: booking.id }, { status: newBookingStatus });
      // A pending_payment booking never had a captured payment -- nothing to refund
      // or forfeit, so its payment is simply marked failed. A confirmed booking's
      // deposit was genuinely captured; `refund` decides the payment's fate. Marking
      // `refunded` here only records our own intent -- no real Zarinpal refund API
      // call is made (see this plan's header note on why that's out of scope).
      if (booking.status === 'confirmed') {
        await em.update(Payment, { bookingId: booking.id }, { status: refund ? 'refunded' : 'paid' });
      } else {
        await em.update(Payment, { bookingId: booking.id }, { status: 'failed' });
      }
    });

    return (await this.bookings.findOneBy({ id: booking.id }))!;
  }
```

- [ ] **Step 2: Add the route** — append to `BookingsController` in `apps/api/src/booking/bookings.controller.ts`

Add the import:

```typescript
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
```

(`Body` was already imported for `create`; no new import needed beyond what's already there.)

Add the method to the class, after `findMine`:

```typescript

  @Post(':id/cancel')
  cancel(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.cancel(id, (req.user as User).id);
  }
```

- [ ] **Step 3: Wire `SalonsModule` already covers `SalonsService`**

`SalonsModule` is already imported by `BookingModule` (for repos) and exports `SalonsService` — no `booking.module.ts` change needed here; `BookingsService`'s new constructor dependency resolves automatically since `SalonsModule` is already in `BookingModule`'s `imports`.

- [ ] **Step 4: Write the e2e test** — `apps/api/test/booking-cancellation.e2e-spec.ts`

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Booking cancellation policy (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09124040009');
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Cancellation Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 5,
    });
    salonId = salonRes.body.id;

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

    customerCookie = await loginAs(app, '09125050010');
  });

  afterAll(async () => {
    await app.close();
  });

  async function bookAndConfirm(hoursFromNow: number): Promise<{ bookingId: string; paymentId: string }> {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString() })
      .expect(201);
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(200);
    const ds = app.get(DataSource);
    const [payment] = await ds.query('SELECT id FROM payments WHERE booking_id = $1', [created.body.booking.id]);
    return { bookingId: created.body.booking.id, paymentId: payment.id };
  }

  it('fully refunds a user cancelling well outside the 24h window', async () => {
    const { bookingId, paymentId } = await bookAndConfirm(48);
    const res = await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/cancel`)
      .set('Cookie', customerCookie)
      .expect(201);
    expect(res.body.status).toBe('cancelled_by_user');

    const ds = app.get(DataSource);
    const [payment] = await ds.query('SELECT status FROM payments WHERE id = $1', [paymentId]);
    expect(payment.status).toBe('refunded');
  });

  it('forfeits the deposit when the user cancels inside the 24h window', async () => {
    const { bookingId, paymentId } = await bookAndConfirm(2);
    await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/cancel`)
      .set('Cookie', customerCookie)
      .expect(201);

    const ds = app.get(DataSource);
    const [payment] = await ds.query('SELECT status FROM payments WHERE id = $1', [paymentId]);
    expect(payment.status).toBe('paid'); // deposit stays with the salon, not refunded
  });

  it('always fully refunds when the salon cancels, regardless of timing', async () => {
    const { bookingId, paymentId } = await bookAndConfirm(1);
    const res = await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/cancel`)
      .set('Cookie', ownerCookie)
      .expect(201);
    expect(res.body.status).toBe('cancelled_by_salon');

    const ds = app.get(DataSource);
    const [payment] = await ds.query('SELECT status FROM payments WHERE id = $1', [paymentId]);
    expect(payment.status).toBe('refunded');
  });

  it('rejects cancellation by someone who is neither the customer nor the salon owner', async () => {
    const { bookingId } = await bookAndConfirm(48);
    const stranger = await loginAs(app, '09126060011');
    await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/cancel`)
      .set('Cookie', stranger)
      .expect(403);
  });

  it('rejects cancelling an already-cancelled booking', async () => {
    const { bookingId } = await bookAndConfirm(48);
    await request(app.getHttpServer()).post(`/api/bookings/${bookingId}/cancel`).set('Cookie', customerCookie).expect(201);
    await request(app.getHttpServer()).post(`/api/bookings/${bookingId}/cancel`).set('Cookie', customerCookie).expect(400);
  });

  it('marks a pending_payment (never-confirmed) cancellation\'s payment as failed, not refunded', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 96 * 60 * 60_000).toISOString() })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/bookings/${created.body.booking.id}/cancel`)
      .set('Cookie', customerCookie)
      .expect(201);

    const ds = app.get(DataSource);
    const [payment] = await ds.query('SELECT status FROM payments WHERE booking_id = $1', [created.body.booking.id]);
    expect(payment.status).toBe('failed');
  });
});
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm --filter @arayeshgah/api test:e2e -- booking-cancellation`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/booking apps/api/test/booking-cancellation.e2e-spec.ts
git commit -m "feat(api): booking cancellation with the spec's window-based refund/forfeit policy"
```

---

### Task 14: Booking expiry background job

**Files:**
- Create: `apps/api/src/booking/booking-expiry.job.ts`
- Modify: `apps/api/src/booking/booking.module.ts`
- Test: `apps/api/test/booking-expiry.e2e-spec.ts`

**Testability note:** the `@Cron`-decorated method is a one-line wrapper around a plain `run()` method, so the test calls `run()` directly rather than waiting on (or trying to mock) the actual cron scheduler — same pattern needed for Task 15.

- [ ] **Step 1: The job** — `apps/api/src/booking/booking-expiry.job.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { Booking } from './booking.entity';

@Injectable()
export class BookingExpiryJob {
  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly config: PlatformConfigService,
  ) {}

  @Cron('*/1 * * * *')
  async handleCron(): Promise<void> {
    await this.run();
  }

  async run(): Promise<number> {
    const ttlMinutes = await this.config.getBookingHoldTtlMinutes();
    const cutoff = new Date(Date.now() - ttlMinutes * 60_000);
    const result = await this.bookings
      .createQueryBuilder()
      .update(Booking)
      .set({ status: 'expired' })
      .where('status = :status', { status: 'pending_payment' })
      .andWhere('created_at < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }
}
```

- [ ] **Step 2: Register in `booking.module.ts`**

Add the import and provider entry:

```typescript
import { BookingExpiryJob } from './booking-expiry.job';
```

```typescript
  providers: [
    AvailabilityService,
    BookingsService,
    PaymentsService,
    BookingExpiryJob,
    {
      provide: PAYMENT_GATEWAY,
      // ... unchanged ...
    },
  ],
```

- [ ] **Step 3: Write the e2e test** — `apps/api/test/booking-expiry.e2e-spec.ts`

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';
import { BookingExpiryJob } from '../src/booking/booking-expiry.job';

describe('Booking expiry job (e2e)', () => {
  let app: INestApplication;
  let job: BookingExpiryJob;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    job = app.get(BookingExpiryJob);

    const ownerCookie = await loginAs(app, '09127070012');
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Expiry Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 1,
    });
    salonId = salonRes.body.id;

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

    customerCookie = await loginAs(app, '09128080013');
  });

  afterAll(async () => {
    await app.close();
  });

  it('expires a pending_payment booking older than the hold TTL, and leaves a fresh one untouched', async () => {
    const stale = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() })
      .expect(201);
    const fresh = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString() })
      .expect(201);

    const ds = app.get(DataSource);
    await ds.query(`UPDATE bookings SET created_at = now() - interval '20 minutes' WHERE id = $1`, [stale.body.booking.id]);

    const affected = await job.run();
    expect(affected).toBe(1);

    const staleAfter = await request(app.getHttpServer())
      .get(`/api/bookings/${stale.body.booking.id}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(staleAfter.body.status).toBe('expired');

    const freshAfter = await request(app.getHttpServer())
      .get(`/api/bookings/${fresh.body.booking.id}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(freshAfter.body.status).toBe('pending_payment');
  });

  it('releases the slot once expired, letting a new booking take it', async () => {
    const startsAt = new Date(Date.now() + 72 * 60 * 60_000).toISOString();
    const first = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt })
      .expect(201);

    const ds = app.get(DataSource);
    await ds.query(`UPDATE bookings SET created_at = now() - interval '20 minutes' WHERE id = $1`, [first.body.booking.id]);
    await job.run();

    const secondCustomer = await loginAs(app, '09129090014');
    await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', secondCustomer)
      .send({ salonId, serviceId, startsAt })
      .expect(201);
  });
});
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @arayeshgah/api test:e2e -- booking-expiry`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/booking apps/api/test/booking-expiry.e2e-spec.ts
git commit -m "feat(api): cron job to expire stale pending_payment holds"
```

---

### Task 15: Payment reconciliation background job

**Files:**
- Create: `apps/api/src/booking/payment-reconciliation.job.ts`
- Modify: `apps/api/src/booking/booking.module.ts`
- Test: `apps/api/test/payment-reconciliation.e2e-spec.ts`

**Context:** covers the case where a user genuinely paid on Zarinpal's side but the callback never reached the API (closed the browser tab mid-redirect, network blip). Every 5 minutes, this re-verifies any `initiated` payment older than 20 minutes.

- [ ] **Step 1: The job** — `apps/api/src/booking/payment-reconciliation.job.ts`

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { Booking } from './booking.entity';
import { PAYMENT_GATEWAY, PaymentGateway } from './payment-gateway';
import { Payment } from './payment.entity';

const STALE_AFTER_MINUTES = 20;

@Injectable()
export class PaymentReconciliationJob {
  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly dataSource: DataSource,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  @Cron('*/5 * * * *')
  async handleCron(): Promise<void> {
    await this.run();
  }

  async run(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60_000);
    const stale = await this.payments.find({
      where: { status: 'initiated', createdAt: LessThan(cutoff) },
    });

    let reconciled = 0;
    for (const payment of stale) {
      if (!payment.authority) continue;
      const verify = await this.gateway.verifyPayment(payment.authority, payment.amount);
      await this.dataSource.transaction(async (em) => {
        if (verify.success) {
          await em.update(Payment, { id: payment.id }, { status: 'paid', refId: verify.refId });
          await em.update(Booking, { id: payment.bookingId }, { status: 'confirmed' });
        } else {
          await em.update(Payment, { id: payment.id }, { status: 'failed' });
          await em.update(Booking, { id: payment.bookingId }, { status: 'cancelled_by_user' });
        }
      });
      reconciled++;
    }
    return reconciled;
  }
}
```

- [ ] **Step 2: Register in `booking.module.ts`**

```typescript
import { PaymentReconciliationJob } from './payment-reconciliation.job';
```

```typescript
  providers: [
    AvailabilityService,
    BookingsService,
    PaymentsService,
    BookingExpiryJob,
    PaymentReconciliationJob,
    {
      provide: PAYMENT_GATEWAY,
      // ... unchanged ...
    },
  ],
```

- [ ] **Step 3: Write the e2e test** — `apps/api/test/payment-reconciliation.e2e-spec.ts`

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';
import { PaymentReconciliationJob } from '../src/booking/payment-reconciliation.job';

describe('Payment reconciliation job (e2e)', () => {
  let app: INestApplication;
  let job: PaymentReconciliationJob;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    job = app.get(PaymentReconciliationJob);

    const ownerCookie = await loginAs(app, '09121110015');
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Reconciliation Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 2,
    });
    salonId = salonRes.body.id;

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

    customerCookie = await loginAs(app, '09122220016');
  });

  afterAll(async () => {
    await app.close();
  });

  it('confirms a stale initiated payment that the mock gateway reports as successful', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() })
      .expect(201);

    const ds = app.get(DataSource);
    await ds.query(
      `UPDATE payments SET created_at = now() - interval '25 minutes' WHERE booking_id = $1`,
      [created.body.booking.id],
    );

    const reconciled = await job.run();
    expect(reconciled).toBe(1);

    const booking = await request(app.getHttpServer())
      .get(`/api/bookings/${created.body.booking.id}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(booking.body.status).toBe('confirmed');
  });

  it('cancels the booking when the mock gateway reports the payment as never having succeeded', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString() })
      .expect(201);

    const ds = app.get(DataSource);
    // force MockPaymentGateway.verifyPayment to report failure by rewriting the authority
    // to start with the sentinel prefix it checks for
    await ds.query(
      `UPDATE payments SET authority = 'MOCK-FAIL-' || authority, created_at = now() - interval '25 minutes' WHERE booking_id = $1`,
      [created.body.booking.id],
    );

    const reconciled = await job.run();
    expect(reconciled).toBe(1);

    const booking = await request(app.getHttpServer())
      .get(`/api/bookings/${created.body.booking.id}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(booking.body.status).toBe('cancelled_by_user');
  });

  it('ignores payments that are not yet stale', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString() })
      .expect(201);

    const reconciled = await job.run();
    expect(reconciled).toBe(0);

    const booking = await request(app.getHttpServer())
      .get(`/api/bookings/${created.body.booking.id}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(booking.body.status).toBe('pending_payment');
  });
});
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @arayeshgah/api test:e2e -- payment-reconciliation`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/booking apps/api/test/payment-reconciliation.e2e-spec.ts
git commit -m "feat(api): cron job to reconcile stale initiated payments against the gateway"
```

---

### Task 16: Full-suite verification & docs update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run everything**

Run: `pnpm --filter @arayeshgah/api test && pnpm --filter @arayeshgah/api test:e2e && pnpm build`
Expected: all unit tests PASS, all e2e suites PASS, build succeeds. Expected final shape: unit suites include the original 3 from Plan 1 plus `deposit.util.spec.ts`, `availability.util.spec.ts`, `zarinpal-payment.gateway.spec.ts` (6 suites total); e2e suites include the original 7 from Plan 1 plus `platform-config`, `availability`, `bookings`, `payments`, `salon-bookings`, `booking-cancellation`, `booking-expiry`, `payment-reconciliation` (15 suites total).

- [ ] **Step 2: Update `README.md`**

Add a new section after the existing "## Tests" section:

```markdown

## Booking & payments (Plan 2)

- `POST /api/bookings` — hold a slot + get a Zarinpal deposit payment URL (customer, authenticated)
- `GET /api/salons/:salonId/availability?serviceId=...` — next 14 days of open slots (public)
- `GET /api/payments/callback?Authority=...&Status=OK|NOK` — Zarinpal redirects here; returns JSON (no frontend to redirect to yet)
- `GET /api/bookings/mine`, `GET /api/bookings/:id`, `POST /api/bookings/:id/cancel` — customer-facing
- `GET /api/salons/mine/bookings`, `PATCH /api/salons/mine/bookings/:id` — provider-facing (mark completed/no_show)

**Payments run against `MockPaymentGateway` by default** (`PAYMENT_GATEWAY=mock` in `.env`/`.env.test`) — no real Zarinpal account is needed for local dev or tests. To use the real gateway, set `PAYMENT_GATEWAY=zarinpal` and `ZARINPAL_MERCHANT_ID`, and **verify the exact API contract against Zarinpal's sandbox first** — see the note at the top of `docs/superpowers/plans/2026-07-04-plan-2-booking-payments.md`.

Two background jobs run every 1 and 5 minutes respectively: expiring abandoned booking holds, and reconciling payments whose Zarinpal callback never arrived.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document booking and payment endpoints from Plan 2"
```

---

## Self-Review

**Spec coverage:** every numbered step of the design spec's section 4 (Booking & Payment Flow) has a task — availability (Tasks 7-8), hold with Redis lock + transaction (Task 10), deposit payment (Tasks 9-10), confirm via server-side verify (Task 11), notify via SMS (Task 11), complete/no-show (Task 12), expiry job (Task 14), reconciliation job (Task 15). The cancellation/refund table (spec section 4) is fully covered by Task 13's three branches. Reviews (spec section 4 step 6's "triggers the review prompt") are explicitly deferred to Plan 3, as agreed with the user before writing this plan.

**Placeholder scan:** no TBD/TODO markers; every code block is complete, runnable content, not a description of what to write.

**Type consistency:** `BookingStatus` (Task 5) is used identically across `bookings.service.ts`, `booking-expiry.job.ts`, `payment-reconciliation.job.ts`, and every e2e test's string literals (`'pending_payment'`, `'confirmed'`, `'cancelled_by_user'`, `'cancelled_by_salon'`, `'expired'`, `'completed'`, `'no_show'`) — no typos introduced across tasks. `PaymentStatus` (`'initiated'|'paid'|'failed'|'refunded'`) likewise matches everywhere it's referenced. The `PAYMENT_GATEWAY` token and `PaymentGateway`/`PaymentRequestResult`/`PaymentVerifyResult` types are defined once in Task 9 and imported (never redefined) in every later task that needs them. `SalonOwnerGuard`'s `req.salonId` contract (Task 2) is consumed identically by `salon-services.controller.ts`, `schedule.controller.ts` (both refactored in Task 2), and `salon-bookings.controller.ts` (Task 12).
