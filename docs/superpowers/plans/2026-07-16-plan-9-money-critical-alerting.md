# Money-Critical Alerting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route money-critical operator signals (stuck/refused refunds, captured money on dead bookings, orphaned payment authorities) to admins via in-app notifications + SMS, with Redis dedup against cron re-detection storms.

**Architecture:** A new `AlertsService.raise({ key, severity, title, body, link? })` in `src/alerts/` — never throws, dedups per key via Redis `SET NX EX` (6h, fail-open), writes an `admin_notifications` row through the existing `AdminNotificationsService` (already rendered by the admin panel's NotificationBell), and SMSes `ALERT_ADMIN_PHONE` for `critical` severity only. Seven call sites in `BookingModule` opt in explicitly beside their existing `logger.error` calls.

**Tech Stack:** NestJS 11, ioredis, existing `SmsProvider`/`AdminNotificationsService`, Jest + supertest.

**Spec:** `docs/superpowers/specs/2026-07-16-money-critical-alerting-design.md`

**Repo/branch note:** The real repo is at WSL path `~/projects/Arayeshgah` (NOT the stale Windows-side clone at `C:\Users\amirh\Desktop\Projects\Arayeshgah`). Work on branch `feature/money-critical-alerting`. Verify first: `cd ~/projects/Arayeshgah && git branch --show-current` → `feature/money-critical-alerting`, `git log -1 --oneline` → `bac131c docs(spec): ...`. All commands run from `~/projects/Arayeshgah` inside WSL; e2e needs docker services (`docker compose up -d`).

**Key existing facts (verified):** `RedisModule` is `@Global()` and exports the `REDIS` token (`src/redis/redis.module.ts`) — no module import needed to inject it. `AdminNotificationsModule` exports `AdminNotificationsService` whose signature is `emit(type, title, body, link, manager?)`. `SmsModule` exports the `SMS_PROVIDER` token (`SmsProvider` interface: `send(phone, body)`). The admin panel's `NotificationBell.vue` renders `title`/`body` directly with no type→label mapping, so there is **zero frontend work**. `loginAsAdmin(app, phone)` exists in `apps/api/test/utils/auth-helper.ts`.

---

### Task 1: `AlertsService` — dedup, in-app, SMS-for-critical, never throws

**Files:**
- Create: `apps/api/src/alerts/alerts.service.ts`
- Create: `apps/api/src/alerts/alerts.module.ts`
- Create (test): `apps/api/src/alerts/alerts.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` (register `AlertsModule` in the root imports list, alongside the other feature modules)

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/alerts/alerts.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { REDIS } from '../redis/redis.module';
import { SMS_PROVIDER } from '../sms/sms.provider';
import { AlertsService } from './alerts.service';

describe('AlertsService.raise', () => {
  let service: AlertsService;
  let redisSet: jest.Mock;
  let emit: jest.Mock;
  let smsSend: jest.Mock;
  let configGet: jest.Mock;

  const CRITICAL_ALERT = {
    key: 'refund-stuck:pay-1',
    severity: 'critical' as const,
    title: 'بازپرداخت معوق',
    body: 'پرداخت pay-1 بیش از ۲۴ ساعت در انتظار بازگشت وجه است.',
  };

  beforeEach(async () => {
    redisSet = jest.fn().mockResolvedValue('OK'); // 'OK' = key was fresh, not a duplicate
    emit = jest.fn().mockResolvedValue(undefined);
    smsSend = jest.fn().mockResolvedValue(undefined);
    configGet = jest.fn().mockReturnValue('09121112233');

    const moduleRef = await Test.createTestingModule({
      providers: [
        AlertsService,
        { provide: REDIS, useValue: { set: redisSet } },
        { provide: AdminNotificationsService, useValue: { emit } },
        { provide: SMS_PROVIDER, useValue: { send: smsSend } },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    service = moduleRef.get(AlertsService);
  });

  it('sends an in-app notification and an SMS for a fresh critical alert', async () => {
    await service.raise(CRITICAL_ALERT);

    expect(redisSet).toHaveBeenCalledWith('alert:dedup:refund-stuck:pay-1', '1', 'EX', 6 * 3600, 'NX');
    expect(emit).toHaveBeenCalledWith('alert', CRITICAL_ALERT.title, CRITICAL_ALERT.body, null);
    expect(smsSend).toHaveBeenCalledWith('09121112233', `${CRITICAL_ALERT.title} — ${CRITICAL_ALERT.body}`);
  });

  it('passes the link through to the notification when provided', async () => {
    await service.raise({ ...CRITICAL_ALERT, link: '/payments/pay-1' });
    expect(emit).toHaveBeenCalledWith('alert', CRITICAL_ALERT.title, CRITICAL_ALERT.body, '/payments/pay-1');
  });

  it('suppresses a duplicate key inside the dedup window (no notification, no SMS)', async () => {
    redisSet.mockResolvedValue(null); // NX miss: key already present
    await service.raise(CRITICAL_ALERT);
    expect(emit).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('never SMSes for warning severity', async () => {
    await service.raise({ ...CRITICAL_ALERT, severity: 'warning' });
    expect(emit).toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('skips SMS (but not the notification) when ALERT_ADMIN_PHONE is empty', async () => {
    configGet.mockReturnValue('');
    await service.raise(CRITICAL_ALERT);
    expect(emit).toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('fails open when Redis errors: the alert still sends', async () => {
    redisSet.mockRejectedValue(new Error('redis down'));
    await service.raise(CRITICAL_ALERT);
    expect(emit).toHaveBeenCalled();
    expect(smsSend).toHaveBeenCalled();
  });

  it('swallows a notification-emit failure and still attempts the SMS', async () => {
    emit.mockRejectedValue(new Error('db down'));
    await expect(service.raise(CRITICAL_ALERT)).resolves.toBeUndefined();
    expect(smsSend).toHaveBeenCalled();
  });

  it('swallows an SMS failure (never throws to the caller)', async () => {
    smsSend.mockRejectedValue(new Error('kavenegar down'));
    await expect(service.raise(CRITICAL_ALERT)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arayeshgah/api test -- alerts.service`
Expected: FAIL — module `./alerts.service` not found.

- [ ] **Step 3: Implement the service and module**

Create `apps/api/src/alerts/alerts.service.ts`:

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { REDIS } from '../redis/redis.module';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';

// One alert per key per window. The refund-retry and reconciliation crons re-detect
// the same stuck condition every 5 minutes; without dedup a single stuck payment
// would page 288 times a day.
const ALERT_DEDUP_HOURS = 6;

export interface AlertInput {
  key: string; // dedup identity, per entity -- e.g. 'refund-stuck:<paymentId>'
  severity: 'critical' | 'warning'; // critical => also SMS the admin phone
  title: string;
  body: string;
  link?: string; // optional admin-panel deep link
}

/**
 * Operator paging for money-critical conditions. Every alert becomes an
 * admin-panel notification (type 'alert'); critical ones also SMS
 * ALERT_ADMIN_PHONE (empty/unset => SMS disabled, e.g. local dev). raise()
 * NEVER throws -- alerting must not be able to break a payment path -- and
 * fails open on Redis errors (a duplicate alert beats a dropped one).
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly adminNotifications: AdminNotificationsService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly config: ConfigService,
  ) {}

  async raise(input: AlertInput): Promise<void> {
    try {
      const fresh = await this.redis
        .set(`alert:dedup:${input.key}`, '1', 'EX', ALERT_DEDUP_HOURS * 3600, 'NX')
        .catch((err) => {
          this.logger.error(
            `Alert dedup check failed for ${input.key} (failing open): ${err instanceof Error ? err.message : String(err)}`,
          );
          return 'OK' as const;
        });
      if (!fresh) return; // duplicate inside the window -- already alerted

      await this.adminNotifications.emit('alert', input.title, input.body, input.link ?? null).catch((err) => {
        this.logger.error(
          `Alert notification emit failed for ${input.key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

      if (input.severity === 'critical') {
        const phone = this.config.get('ALERT_ADMIN_PHONE', '');
        if (phone) {
          await this.sms.send(phone, `${input.title} — ${input.body}`).catch((err) => {
            this.logger.error(
              `Alert SMS failed for ${input.key}: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
      }
    } catch (err) {
      // Belt-and-braces: nothing above should reach here, but a throw from raise()
      // inside a payment path would be worse than a lost alert.
      this.logger.error(`Alert raise failed for ${input.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
```

Create `apps/api/src/alerts/alerts.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module';
import { SmsModule } from '../sms/sms.module';
import { AlertsService } from './alerts.service';

// RedisModule is @Global(), so the REDIS token needs no import here.
@Module({
  imports: [AdminNotificationsModule, SmsModule],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
```

In `apps/api/src/app.module.ts`, add `AlertsModule` to the imports array (import line + list entry, alphabetically with the others):

```typescript
import { AlertsModule } from './alerts/alerts.module';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arayeshgah/api test -- alerts.service`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/alerts/ apps/api/src/app.module.ts
git commit -m "feat(api): AlertsService -- deduped operator alerts via admin notifications + SMS"
```

---

### Task 2: Critical call sites — stuck refund, no-authority refund, orphaned authority

**Files:**
- Modify: `apps/api/src/booking/booking.module.ts` (import `AlertsModule`)
- Modify: `apps/api/src/booking/refund-retry.job.ts`
- Modify: `apps/api/src/booking/payments.service.ts` (`attemptRefund` null-authority branch)
- Modify: `apps/api/src/booking/bookings.service.ts` (`createPaymentSession` catch)
- Test: `apps/api/src/booking/refund-retry.job.spec.ts`, `apps/api/src/booking/payments.service.spec.ts`, `apps/api/src/booking/bookings.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

**`refund-retry.job.spec.ts`:** add to the imports: `import { AlertsService } from '../alerts/alerts.service';`. In the `beforeEach`, declare and create a mock and add the provider:

```typescript
  let raise: jest.Mock;
  // in beforeEach, next to the other mock initializations:
  raise = jest.fn().mockResolvedValue(undefined);
  // in the providers array:
  { provide: AlertsService, useValue: { raise } },
```

Extend the existing escalation test (`'logs an escalation for a payment stuck refund_pending for over 24 hours'`) with:

```typescript
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'refund-stuck:pay-old', severity: 'critical' }),
    );
```

Extend the existing negative test (`'does not escalate a payment still under the 24h threshold'`) with:

```typescript
    expect(raise).not.toHaveBeenCalled();
```

**`payments.service.spec.ts`:** add the import `import { AlertsService } from '../alerts/alerts.service';`. In BOTH describe blocks (`attemptRefund` and `handleCallback lost-CAS recovery`), add a `raise` mock the same way (declare `let raise: jest.Mock;`, initialize in `beforeEach`, add `{ provide: AlertsService, useValue: { raise } }` to providers).

Extend the existing null-authority test (`'leaves a payment with no authority pending and never calls the gateway'`) with:

```typescript
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'refund-no-authority:pay-1', severity: 'critical' }),
    );
```

And add to the happy-path test (`'refunds a refund_pending payment: ...'`):

```typescript
    expect(raise).not.toHaveBeenCalled();
```

**`bookings.service.spec.ts`:** add the import `import { AlertsService } from '../alerts/alerts.service';`. In the `BookingsService.cancel` describe's providers, add `{ provide: AlertsService, useValue: { raise: jest.fn() } }`, and add `{ provide: AlertsService, useValue: { raise: jest.fn() } }` to the `getEarnings` describe's providers too (the class now injects it). Then append a new describe at the end of the file:

```typescript
describe('BookingsService.retryPayment authority persist failure', () => {
  let service: BookingsService;
  let bookingsFindOneBy: jest.Mock;
  let salonsFindOneBy: jest.Mock;
  let paymentsUpdate: jest.Mock;
  let requestPayment: jest.Mock;
  let raise: jest.Mock;

  beforeEach(async () => {
    bookingsFindOneBy = jest.fn().mockResolvedValue({
      id: 'booking-1',
      userId: 'customer-1',
      salonId: 'salon-1',
      status: 'pending_payment',
      depositAmount: 100_000,
    });
    salonsFindOneBy = jest.fn().mockResolvedValue({ id: 'salon-1', name: 'Test Salon', ownerId: 'owner-1' });
    paymentsUpdate = jest.fn().mockRejectedValue(new Error('db down'));
    requestPayment = jest.fn().mockResolvedValue({ authority: 'AUTH-NEW', paymentUrl: 'https://pay.example/AUTH-NEW' });
    raise = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: bookingsFindOneBy } },
        { provide: getRepositoryToken(Payment), useValue: { update: paymentsUpdate } },
        { provide: getRepositoryToken(Salon), useValue: { findOneBy: salonsFindOneBy } },
        { provide: getRepositoryToken(SalonService), useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: PlatformConfigService, useValue: {} },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn().mockReturnValue('http://localhost:3002') } },
        { provide: REDIS, useValue: {} },
        { provide: PAYMENT_GATEWAY, useValue: { requestPayment } },
        { provide: PaymentsService, useValue: { attemptRefund: jest.fn() } },
        { provide: AlertsService, useValue: { raise } },
      ],
    }).compile();

    service = moduleRef.get(BookingsService);
  });

  it('raises a critical alert when persisting a fresh Zarinpal authority fails (orphaned chargeable session)', async () => {
    await expect(service.retryPayment('customer-1', 'booking-1')).rejects.toThrow('db down');

    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'authority-persist:booking-1', severity: 'critical' }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arayeshgah/api test -- "booking/(refund-retry.job|payments.service|bookings.service)"`
Expected: FAIL — `AlertsService` is not yet a dependency (Nest can't resolve provider assertions / `raise` never called).

- [ ] **Step 3: Implement the three critical sites**

`apps/api/src/booking/booking.module.ts` — add the import and the module:

```typescript
import { AlertsModule } from '../alerts/alerts.module';
// in @Module imports array:
    AlertsModule,
```

`apps/api/src/booking/refund-retry.job.ts` — import and inject:

```typescript
import { AlertsService } from '../alerts/alerts.service';
// constructor gains:
    private readonly alerts: AlertsService,
```

In `run()`, inside the existing 24h-escalation `if` block, after the `this.logger.error(...)` call, add:

```typescript
        await this.alerts.raise({
          key: `refund-stuck:${payment.id}`,
          severity: 'critical',
          title: 'بازپرداخت معوق',
          body: `بازگشت وجه پرداخت ${payment.id} بیش از ${ESCALATE_AFTER_HOURS} ساعت در انتظار مانده است و نیاز به بررسی دستی دارد.`,
        });
```

`apps/api/src/booking/payments.service.ts` — import and inject:

```typescript
import { AlertsService } from '../alerts/alerts.service';
// constructor gains:
    private readonly alerts: AlertsService,
```

In `attemptRefund`, in the null-authority branch, after the existing `this.logger.error(...)`:

```typescript
      await this.alerts.raise({
        key: `refund-no-authority:${payment.id}`,
        severity: 'critical',
        title: 'بازپرداخت بدون شناسه پرداخت',
        body: `پرداخت ${payment.id} در انتظار بازگشت وجه است اما شناسه (authority) ندارد؛ بازپرداخت خودکار ممکن نیست.`,
      });
```

`apps/api/src/booking/bookings.service.ts` — import and inject:

```typescript
import { AlertsService } from '../alerts/alerts.service';
// constructor gains:
    private readonly alerts: AlertsService,
```

In `createPaymentSession`, inside the existing `catch` block (after `this.logger.error(...)`, before `throw err;`):

```typescript
      await this.alerts.raise({
        key: `authority-persist:${booking.id}`,
        severity: 'critical',
        title: 'شناسه پرداخت ثبت نشد',
        body: `شناسه پرداخت زرین‌پال برای رزرو ${booking.id} در پایگاه داده ثبت نشد و نیاز به تطبیق دستی دارد.`,
      });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arayeshgah/api test -- "booking/(refund-retry.job|payments.service|bookings.service)"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/booking/booking.module.ts apps/api/src/booking/refund-retry.job.ts apps/api/src/booking/payments.service.ts apps/api/src/booking/bookings.service.ts apps/api/src/booking/refund-retry.job.spec.ts apps/api/src/booking/payments.service.spec.ts apps/api/src/booking/bookings.service.spec.ts
git commit -m "feat(api): critical alerts -- stuck refund, no-authority refund, orphaned authority"
```

---

### Task 3: Warning call sites — refused refund, late capture (both producers), reconcile failure, verify-persist failure

**Files:**
- Modify: `apps/api/src/booking/payments.service.ts` (three sites)
- Modify: `apps/api/src/booking/payment-reconciliation.job.ts` (two sites)
- Test: `apps/api/src/booking/payments.service.spec.ts`, `apps/api/src/booking/payment-reconciliation.job.spec.ts`

- [ ] **Step 1: Write the failing tests**

**`payments.service.spec.ts`** — extend the existing refused test (`'leaves the payment pending when the gateway refuses the refund'`):

```typescript
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'refund-refused:pay-1', severity: 'warning' }),
    );
```

Extend the lost-CAS recovery test (`'queues an automatic refund when cancel() marked the payment failed mid-callback ...'`):

```typescript
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'late-capture:pay-1', severity: 'warning' }),
    );
```

And extend the benign-duplicate test (`'treats a lost CAS with the payment already paid ...'`):

```typescript
    expect(raise).not.toHaveBeenCalled();
```

**`payment-reconciliation.job.spec.ts`** — add the import `import { AlertsService } from '../alerts/alerts.service';`, declare `let raise: jest.Mock;`, initialize `raise = jest.fn().mockResolvedValue(undefined);` in `beforeEach`, and add `{ provide: AlertsService, useValue: { raise } }` to the providers.

Extend the late-capture test (`'queues an automatic refund when the money was captured but the booking already moved on'`):

```typescript
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'late-capture:pay-1', severity: 'warning' }),
    );
```

Extend the isolation test (`'continues the batch when one payment errors (per-payment isolation)'`):

```typescript
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'reconcile-failed:pay-1', severity: 'warning' }),
    );
```

And extend the happy-path test (`'confirms the booking and marks the payment paid when verify succeeds in time'`):

```typescript
    expect(raise).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arayeshgah/api test -- "booking/(payments.service|payment-reconciliation.job)"`
Expected: FAIL — `raise` not called at the new sites.

- [ ] **Step 3: Implement the warning sites**

`apps/api/src/booking/payments.service.ts`:

1. In `attemptRefund`, refused branch (after `this.logger.error('Zarinpal refused the refund ...')`):

```typescript
      await this.alerts.raise({
        key: `refund-refused:${payment.id}`,
        severity: 'warning',
        title: 'بازپرداخت پذیرفته نشد',
        body: `زرین‌پال بازگشت وجه پرداخت ${payment.id} را نپذیرفت؛ تلاش مجدد به‌صورت خودکار ادامه دارد.`,
      });
```

2. In `handleCallback`, lost-CAS recovery branch (after the `this.logger.error('... cancelled mid-callback ...')` call, next to the status-guarded update):

```typescript
      await this.alerts.raise({
        key: `late-capture:${payment.id}`,
        severity: 'warning',
        title: 'پرداخت پس از لغو رزرو',
        body: `مبلغ پرداخت ${payment.id} پس از لغو رزرو ${payment.bookingId} دریافت شد؛ بازگشت وجه به‌صورت خودکار در صف قرار گرفت.`,
      });
```

3. In `handleCallback`, the transaction `.catch` (verify-persist failure — after its `this.logger.error(...)`, before `throw err;`):

```typescript
        void this.alerts.raise({
          key: `verify-persist:${payment.id}`,
          severity: 'warning',
          title: 'ثبت پرداخت ناموفق',
          body: `پرداخت ${payment.id} توسط زرین‌پال تایید شد اما ثبت آن در پایگاه داده ناموفق بود؛ تطبیق خودکار آن را اصلاح می‌کند.`,
        });
```

(`void` because this `.catch` re-throws synchronously; `raise` never rejects, so fire-and-forget is safe here. The other sites `await` normally.)

`apps/api/src/booking/payment-reconciliation.job.ts` — import and inject:

```typescript
import { AlertsService } from '../alerts/alerts.service';
// constructor gains:
    private readonly alerts: AlertsService,
```

1. In the late-capture branch, inside `if (queued.affected)` after the `this.logger.error(...)`:

```typescript
                await this.alerts.raise({
                  key: `late-capture:${payment.id}`,
                  severity: 'warning',
                  title: 'پرداخت پس از انقضای رزرو',
                  body: `مبلغ پرداخت ${payment.id} پس از خروج رزرو ${payment.bookingId} از حالت انتظار دریافت شد؛ بازگشت وجه به‌صورت خودکار در صف قرار گرفت.`,
                });
```

Note: this shares the `late-capture:<paymentId>` key with `handleCallback`'s recovery on purpose — same underlying event; whichever path detects it first wins the dedup.

2. In the per-payment `catch` block (after the `this.logger.error('Failed to reconcile ...')`):

```typescript
        await this.alerts.raise({
          key: `reconcile-failed:${payment.id}`,
          severity: 'warning',
          title: 'تطبیق پرداخت ناموفق',
          body: `تطبیق پرداخت ${payment.id} با خطا مواجه شد و در اجرای بعدی دوباره تلاش می‌شود.`,
        });
```

The `raise` call goes INSIDE the transaction callback only for the late-capture site because that's where the condition is detected; `raise` does its own writes outside the caller's transaction (no `manager` passed), which is intentional — an alert survives even if a later part of the caller's transaction rolls back, and a duplicate alert for a rolled-back transaction is acceptable (dedup caps it).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arayeshgah/api test -- "booking/(payments.service|payment-reconciliation.job)"`
Expected: PASS. Then run the full unit suite: `pnpm --filter @arayeshgah/api test` — Expected: PASS (no other spec should break; any spec that instantiates `PaymentsService`/`BookingsService`/jobs directly already got the mock in Task 2).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/booking/payments.service.ts apps/api/src/booking/payment-reconciliation.job.ts apps/api/src/booking/payments.service.spec.ts apps/api/src/booking/payment-reconciliation.job.spec.ts
git commit -m "feat(api): warning alerts -- refused refund, late capture, reconcile and persist failures"
```

---

### Task 4: End-to-end — a refused refund reaches the admin's notifications

**Files:**
- Create (test): `apps/api/test/alerts.e2e-spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `apps/api/test/alerts.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { RefundRetryJob } from '../src/booking/refund-retry.job';
import { REDIS } from '../src/redis/redis.module';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Money-critical alerting (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let customerCookie: string;
  let ownerCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    // Alert dedup keys live in Redis and survive resetDatabase() -- a re-run inside
    // the 6h window would silently suppress this test's alert. Clear ONLY alert keys
    // (never flushdb: OTP/lock state of concurrently-running e2e files shares this Redis).
    const redis = app.get<Redis>(REDIS);
    const dedupKeys = await redis.keys('alert:dedup:*');
    if (dedupKeys.length > 0) await redis.del(...dedupKeys);

    adminCookie = await loginAsAdmin(app, '09127770001');
    ownerCookie = await loginAs(app, '09127770002');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Alerts Test Salon',
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
      .send({ categoryId: categoriesRes.body[0].id, name: 'Cut', price: 500000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );

    customerCookie = await loginAs(app, '09127770003');
  });

  afterAll(async () => {
    await app.close();
  });

  it('a refused refund produces an unread admin notification of type alert', async () => {
    // Book + pay (mock gateway confirms instantly via the callback redirect).
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString() })
      .expect(201);
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer())
      .get('/api/payments/callback')
      .query({ Authority: authority, Status: 'OK' })
      .expect(302);

    // Force MockPaymentGateway.refundPayment to refuse, then cancel (refund-eligible).
    const ds = app.get(DataSource);
    await ds.query(`UPDATE payments SET authority = 'MOCK-REFUND-FAIL-' || authority WHERE booking_id = $1`, [
      created.body.booking.id,
    ]);
    await request(app.getHttpServer())
      .post(`/api/bookings/${created.body.booking.id}/cancel`)
      .set('Cookie', customerCookie)
      .expect(201);

    // The refused refund must now be visible to the admin.
    const list = await request(app.getHttpServer())
      .get('/api/admin/notifications?unread=true')
      .set('Cookie', adminCookie)
      .expect(200);
    const alert = list.body.items.find(
      (n: { type: string; title: string }) => n.type === 'alert' && n.title === 'بازپرداخت پذیرفته نشد',
    );
    expect(alert).toBeDefined();

    const count = await request(app.getHttpServer())
      .get('/api/admin/notifications/unread-count')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(count.body.count).toBeGreaterThanOrEqual(1);
  });

  it('the same condition does not alert twice inside the dedup window', async () => {
    // RefundRetryJob would re-detect the refused refund on its next tick; simulate by
    // re-running the inline attempt via a second cancel attempt being impossible, so
    // instead invoke the retry job directly after backdating the grace period.
    const ds = app.get(DataSource);
    await ds.query(`UPDATE payments SET refund_requested_at = now() - interval '10 minutes' WHERE status = 'refund_pending'`);

    const job = app.get(RefundRetryJob);
    await job.run();

    const list = await request(app.getHttpServer())
      .get('/api/admin/notifications')
      .set('Cookie', adminCookie)
      .expect(200);
    const alerts = list.body.items.filter(
      (n: { type: string; title: string }) => n.type === 'alert' && n.title === 'بازپرداخت پذیرفته نشد',
    );
    expect(alerts).toHaveLength(1); // deduped: still just the original alert
  });
});
```

- [ ] **Step 2: Run the e2e spec**

Run: `pnpm --filter @arayeshgah/api test:e2e -- alerts`
Expected: PASS (2 tests). Requires docker services.

- [ ] **Step 3: Run the full e2e suite (regression)**

Run: `pnpm --filter @arayeshgah/api test:e2e`
Expected: PASS (existing suites unaffected — `AlertsModule` resolves in the test app because `createTestApp` boots the real `AppModule`).

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/alerts.e2e-spec.ts
git commit -m "test(api): e2e -- refused refund alerts the admin once, deduped"
```

---

### Task 5: Config, docs, and full verification

**Files:**
- Modify: `.env.example`
- Modify: `docs/deployment/DEPLOY.md` (env-var table)
- Modify: `CLAUDE.md` (Known Gaps)
- Modify: `README.md` (alerting sentence from Plan 8 wording)

- [ ] **Step 1: Add the env var**

In `.env.example`, after the `PUSH_PROVIDER`/VAPID block, add:

```
# Admin phone for critical money alerts (SMS via the configured SMS provider).
# Empty = SMS alerts disabled; in-app admin notifications are always on.
ALERT_ADMIN_PHONE=
```

- [ ] **Step 2: DEPLOY.md env table**

In the optional-integrations table in `docs/deployment/DEPLOY.md`, add a row after the Push row:

```markdown
| Alerts (admin SMS) | `ALERT_ADMIN_PHONE` — optional; critical money alerts (stuck refunds, orphaned authorities) SMS this number via the configured SMS provider. Empty disables SMS; in-app admin notifications always flow |
```

- [ ] **Step 3: CLAUDE.md and README.md**

`CLAUDE.md`, Known Gaps — the Plan 8 bullet currently ends with: `There is still no real alerting/paging on the `logger.error(...)` operator signals (stuck refunds, payments needing review) — that remains an explicit MVP scope cut.` Replace that sentence with:

```markdown
Money-critical operator signals now page for real (Plan 9): `AlertsService` routes them to in-app admin notifications + SMS (`ALERT_ADMIN_PHONE`), deduped per condition via Redis. Non-money `logger.error` calls (audit/notification emit failures) remain log-only by design.
```

`README.md` — the Plan 8 paragraph currently ends with: `The remaining cuts: the `logger.error(...)` operator signals (stuck refunds, orphaned authorities) still have no alerting/paging integration, and the refund path has not yet been verified against Zarinpal's sandbox.` Replace with:

```markdown
As of Plan 9, those operator signals page for real: every money-critical condition (stuck refund, refused refund, captured money on a dead booking, orphaned authority) becomes an in-app admin notification, and critical ones SMS `ALERT_ADMIN_PHONE`, deduped per condition so the 5-minute crons can't storm. The remaining cut: the refund path has not yet been verified against Zarinpal's sandbox.
```

- [ ] **Step 4: Full verification**

```bash
pnpm --filter @arayeshgah/api test
pnpm --filter @arayeshgah/api test:e2e
pnpm build
```

All must pass. (user-app untouched by this plan; `pnpm build` covers it anyway.)

- [ ] **Step 5: Commit**

```bash
git add .env.example docs/deployment/DEPLOY.md CLAUDE.md README.md
git commit -m "docs: money-critical alerting -- ALERT_ADMIN_PHONE, known-gaps update"
```

---

## Post-plan

After all tasks: superpowers:requesting-code-review against the spec, then superpowers:finishing-a-development-branch (merge to `main` after user confirmation).
