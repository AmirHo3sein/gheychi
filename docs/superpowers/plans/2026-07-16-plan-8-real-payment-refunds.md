# Real Payment Refunds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bookkeeping-only `refunded` payment status with real Zarinpal refund API calls, fully automatic across all refund producers, with customer-visible refund state.

**Architecture:** A new `refund_pending` status marks money as owed; a single idempotent consumer `PaymentsService.attemptRefund()` performs the gateway call and the race-safe `refund_pending → refunded` transition. Three producers feed it: `BookingsService.cancel()` (inline attempt right after commit), `PaymentReconciliationJob`'s late-capture branch, and a new `RefundRetryJob` cron that self-heals gateway failures. The gateway abstraction gains `refundPayment(authority)`, implemented for Zarinpal (`POST /pg/v4/payment/refund.json`, Bearer access token) and the mock.

**Tech Stack:** NestJS 11, TypeORM 0.3 (+ raw SQL migration), Jest + supertest, Nuxt 4 + Vitest (`@nuxt/test-utils`).

**Spec:** `docs/superpowers/specs/2026-07-16-real-payment-refunds-design.md`

**Repo/branch note:** The real repo is at WSL path `~/projects/Arayeshgah` (NOT the stale Windows-side clone at `C:\Users\amirh\Desktop\Projects\Arayeshgah`). Work on branch `feature/real-payment-refunds`. Before starting, verify: `cd ~/projects/Arayeshgah && git branch --show-current` → `feature/real-payment-refunds`, and `git log --oneline -1` shows a 2026-07 commit. All commands below run from `~/projects/Arayeshgah` inside WSL. Backend tests need the docker services up (`docker compose up -d`).

---

### Task 1: `refund_pending` status, new payment columns, migration

**Files:**
- Modify: `apps/api/src/booking/payment.entity.ts`
- Create: `apps/api/src/migrations/1752700000000-payment-refunds.ts`

- [ ] **Step 1: Add the status value and columns to the entity**

In `apps/api/src/booking/payment.entity.ts`, change the status type line:

```typescript
export type PaymentStatus = 'initiated' | 'paid' | 'refund_pending' | 'refunded' | 'failed';
```

(Reordering to match the lifecycle; it was `'initiated' | 'paid' | 'failed' | 'refunded'`.)

Add three columns after the existing `refId` column:

```typescript
  // Set when a producer (cancel, reconciliation) marks the payment refund_pending.
  // The table has no updated_at; the retry job's grace period and its 24h
  // escalation both key off this.
  @Column({ name: 'refund_requested_at', type: 'timestamptz', nullable: true })
  refundRequestedAt: Date | null;

  // Zarinpal's refund reference (refund.json ref_id). Non-null iff status is 'refunded'
  // via the real gateway (mock writes MOCKREFUND-* values).
  @Column({ name: 'refund_ref_id', type: 'varchar', nullable: true })
  refundRefId: string | null;

  @Column({ name: 'refunded_at', type: 'timestamptz', nullable: true })
  refundedAt: Date | null;
```

- [ ] **Step 2: Write the migration**

Create `apps/api/src/migrations/1752700000000-payment-refunds.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentRefunds1752700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE payments ADD COLUMN refund_requested_at timestamptz`);
    await queryRunner.query(`ALTER TABLE payments ADD COLUMN refund_ref_id varchar`);
    await queryRunner.query(`ALTER TABLE payments ADD COLUMN refunded_at timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE payments DROP COLUMN refunded_at`);
    await queryRunner.query(`ALTER TABLE payments DROP COLUMN refund_ref_id`);
    await queryRunner.query(`ALTER TABLE payments DROP COLUMN refund_requested_at`);
  }
}
```

- [ ] **Step 3: Run the migration and verify**

Run: `pnpm --filter @arayeshgah/api migration:run`
Expected: `PaymentRefunds1752700000000` listed as executed, no errors.

Verify columns exist: `docker compose exec postgres psql -U arayeshgah -d arayeshgah -c "\d payments"` — expect `refund_requested_at`, `refund_ref_id`, `refunded_at`.

- [ ] **Step 4: Verify existing tests still pass**

Run: `pnpm --filter @arayeshgah/api test`
Expected: PASS (entity change is additive).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/booking/payment.entity.ts apps/api/src/migrations/1752700000000-payment-refunds.ts
git commit -m "feat(api): add refund_pending status and refund tracking columns to payments"
```

---

### Task 2: `refundPayment` on the gateway abstraction (interface, Zarinpal, mock, factory)

**Files:**
- Modify: `apps/api/src/booking/payment-gateway.ts`
- Modify: `apps/api/src/booking/zarinpal-payment.gateway.ts`
- Modify: `apps/api/src/booking/mock-payment.gateway.ts`
- Modify: `apps/api/src/booking/booking.module.ts` (factory: pass access token)
- Test: `apps/api/src/booking/zarinpal-payment.gateway.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe('ZarinpalGateway', ...)` in `apps/api/src/booking/zarinpal-payment.gateway.spec.ts`. Note the constructor gains a second argument in this task, so FIRST update every existing `new ZarinpalGateway('MERCHANT_ID')` in this file to `new ZarinpalGateway('MERCHANT_ID', 'ACCESS_TOKEN')`.

```typescript
  describe('refundPayment', () => {
    it('posts the authority with the merchant id and a bearer access token', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { code: 100, message: 'ok', ref_id: 555, session: 1, iban: 'IR000' }, errors: [] }),
      });
      const gateway = new ZarinpalGateway('MERCHANT_ID', 'ACCESS_TOKEN');
      const result = await gateway.refundPayment('AUTH123');

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://payment.zarinpal.com/pg/v4/payment/refund.json');
      expect(options.headers.Authorization).toBe('Bearer ACCESS_TOKEN');
      const body = JSON.parse(options.body);
      expect(body.merchant_id).toBe('MERCHANT_ID');
      expect(body.authority).toBe('AUTH123');
      expect(result).toEqual({ success: true, refundRefId: '555' });
    });

    it('treats code 101 (already refunded) as success, without requiring a ref_id', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { code: 101, message: 'already refunded' }, errors: [] }),
      });
      const gateway = new ZarinpalGateway('MERCHANT_ID', 'ACCESS_TOKEN');
      const result = await gateway.refundPayment('AUTH123');
      expect(result.success).toBe(true);
      expect(result.refundRefId).toBeNull();
    });

    it('treats any other code as a refusal, not a thrown error', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ data: null, errors: [{ code: -33, message: 'cannot refund' }] }),
      });
      const gateway = new ZarinpalGateway('MERCHANT_ID', 'ACCESS_TOKEN');
      const result = await gateway.refundPayment('AUTH123');
      expect(result).toEqual({ success: false, refundRefId: null });
    });

    it('throws on a non-ok HTTP status (infrastructure failure, not a refusal)', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ data: null, errors: [{ code: -1, message: 'maintenance' }] }),
      });
      const gateway = new ZarinpalGateway('MERCHANT_ID', 'ACCESS_TOKEN');
      await expect(gateway.refundPayment('AUTH123')).rejects.toThrow('Zarinpal');
    });

    it('normalizes a network-level failure into a thrown Zarinpal error', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      const gateway = new ZarinpalGateway('MERCHANT_ID', 'ACCESS_TOKEN');
      await expect(gateway.refundPayment('AUTH123')).rejects.toThrow('Zarinpal');
    });

    it('bounds the refund request with a network timeout', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { code: 100, message: 'ok', ref_id: 1 }, errors: [] }),
      });
      const gateway = new ZarinpalGateway('MERCHANT_ID', 'ACCESS_TOKEN');
      await gateway.refundPayment('AUTH123');
      expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arayeshgah/api test -- zarinpal-payment.gateway`
Expected: FAIL — TS compile error (constructor arity / `refundPayment` does not exist).

- [ ] **Step 3: Implement the interface, Zarinpal method, and mock**

In `apps/api/src/booking/payment-gateway.ts`, add after `PaymentVerifyResult`:

```typescript
export interface PaymentRefundResult {
  success: boolean;
  refundRefId: string | null;
}
```

and extend the interface:

```typescript
export interface PaymentGateway {
  requestPayment(amountToman: number, description: string, callbackUrl: string): Promise<PaymentRequestResult>;
  verifyPayment(authority: string, amountToman: number): Promise<PaymentVerifyResult>;
  refundPayment(authority: string): Promise<PaymentRefundResult>;
}
```

In `apps/api/src/booking/zarinpal-payment.gateway.ts`:

Add near the other URL constants:

```typescript
const REFUND_URL = 'https://payment.zarinpal.com/pg/v4/payment/refund.json';
```

Add a response interface near the others:

```typescript
interface ZarinpalRefundResponse {
  data: { code: number; message: string; ref_id?: number; session?: number; iban?: string } | null;
  errors: unknown;
}
```

Change the constructor to take the access token (refunds authenticate with a personal access token from the Zarinpal panel, not the merchant id):

```typescript
  constructor(
    private readonly merchantId: string,
    private readonly accessToken: string,
  ) {}
```

Update the import line to include `PaymentRefundResult`, then add the method:

```typescript
  /**
   * Refunds the full captured amount of a transaction by its authority.
   * POST /pg/v4/payment/refund.json with a Bearer personal access token
   * (generated in the Zarinpal panel -- separate from the merchant id).
   * Codes 100/101 are treated as success, mirroring verifyPayment's contract,
   * so a repeat refund attempt after a crash is harmless (idempotent).
   * VERIFY AGAINST ZARINPAL'S SANDBOX before taking real refunds -- the exact
   * "already refunded" code must be confirmed there, same caveat as the class
   * header note above.
   */
  async refundPayment(authority: string): Promise<PaymentRefundResult> {
    let res: Response;
    let body: ZarinpalRefundResponse;
    try {
      res = await fetch(REFUND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.accessToken}` },
        signal: AbortSignal.timeout(ZARINPAL_TIMEOUT_MS),
        body: JSON.stringify({ merchant_id: this.merchantId, authority }),
      });
      body = (await res.json()) as ZarinpalRefundResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Zarinpal refund failed for authority ${authority}: ${message}`);
      throw new Error(`Zarinpal refund failed: ${message}`);
    }
    // Same policy as verifyPayment: a decline-shaped answer (normal HTTP, non-success
    // code) returns success:false; an infrastructure failure (non-ok HTTP) throws so
    // callers leave the payment refund_pending for the retry job.
    if (!res.ok) {
      this.logger.error(`Zarinpal refund returned HTTP ${res.status} for authority ${authority}: ${JSON.stringify(body.errors ?? body.data)}`);
      throw new Error(`Zarinpal refund failed: HTTP ${res.status} ${JSON.stringify(body.errors ?? body.data)}`);
    }
    if (body.data?.code === 100 || body.data?.code === 101) {
      return { success: true, refundRefId: body.data.ref_id != null ? String(body.data.ref_id) : null };
    }
    return { success: false, refundRefId: null };
  }
```

In `apps/api/src/booking/mock-payment.gateway.ts`, update the import to include `PaymentRefundResult` and add:

```typescript
  async refundPayment(authority: string): Promise<PaymentRefundResult> {
    if (authority.includes('MOCK-REFUND-FAIL')) return { success: false, refundRefId: null };
    return { success: true, refundRefId: `MOCKREFUND-${authority}` };
  }
```

In `apps/api/src/booking/booking.module.ts`, update the factory:

```typescript
      useFactory: (config: ConfigService) =>
        config.get('PAYMENT_GATEWAY') === 'zarinpal'
          ? new ZarinpalGateway(config.getOrThrow('ZARINPAL_MERCHANT_ID'), config.getOrThrow('ZARINPAL_ACCESS_TOKEN'))
          : new MockPaymentGateway(),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arayeshgah/api test -- zarinpal-payment.gateway`
Expected: PASS (all, including the pre-existing request/verify tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/booking/payment-gateway.ts apps/api/src/booking/zarinpal-payment.gateway.ts apps/api/src/booking/zarinpal-payment.gateway.spec.ts apps/api/src/booking/mock-payment.gateway.ts apps/api/src/booking/booking.module.ts
git commit -m "feat(api): refundPayment on the payment gateway abstraction (Zarinpal refund.json + mock)"
```

---

### Task 3: `PaymentsService.attemptRefund()` — the single refund consumer

**Files:**
- Modify: `apps/api/src/booking/payments.service.ts`
- Create (test): `apps/api/src/booking/payments.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/booking/payments.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PushService } from '../push/push.service';
import { SMS_PROVIDER } from '../sms/sms.provider';
import { SalonsService } from '../salons/salons.service';
import { UsersService } from '../users/users.service';
import { Booking } from './booking.entity';
import { PAYMENT_GATEWAY } from './payment-gateway';
import { Payment } from './payment.entity';
import { PaymentsService } from './payments.service';

describe('PaymentsService.attemptRefund', () => {
  let service: PaymentsService;
  let paymentsFindOneBy: jest.Mock;
  let paymentsUpdate: jest.Mock;
  let bookingsFindOneBy: jest.Mock;
  let refundPayment: jest.Mock;
  let smsSend: jest.Mock;
  let pushSend: jest.Mock;

  const REFUND_PENDING_PAYMENT = {
    id: 'pay-1',
    bookingId: 'booking-1',
    authority: 'AUTH123',
    status: 'refund_pending',
  };

  beforeEach(async () => {
    paymentsFindOneBy = jest.fn();
    paymentsUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    bookingsFindOneBy = jest.fn().mockResolvedValue({ id: 'booking-1', userId: 'user-1', salonId: 'salon-1' });
    refundPayment = jest.fn();
    smsSend = jest.fn().mockResolvedValue(undefined);
    pushSend = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: { findOneBy: paymentsFindOneBy, update: paymentsUpdate } },
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: bookingsFindOneBy } },
        { provide: DataSource, useValue: {} },
        { provide: SalonsService, useValue: {} },
        { provide: UsersService, useValue: { findById: jest.fn().mockResolvedValue({ id: 'user-1', phone: '09120000000' }) } },
        { provide: SMS_PROVIDER, useValue: { send: smsSend } },
        { provide: PAYMENT_GATEWAY, useValue: { refundPayment } },
        { provide: PushService, useValue: { sendToUser: pushSend } },
      ],
    }).compile();

    service = moduleRef.get(PaymentsService);
  });

  it('refunds a refund_pending payment: gateway call, race-safe update, customer notification', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT });
    refundPayment.mockResolvedValue({ success: true, refundRefId: 'RR-1' });

    const outcome = await service.attemptRefund('booking-1');

    expect(outcome).toBe('refunded');
    expect(refundPayment).toHaveBeenCalledWith('AUTH123');
    expect(paymentsUpdate).toHaveBeenCalledWith(
      { id: 'pay-1', status: 'refund_pending' },
      expect.objectContaining({ status: 'refunded', refundRefId: 'RR-1', refundedAt: expect.any(Date) }),
    );
    expect(smsSend).toHaveBeenCalledWith('09120000000', expect.any(String));
    expect(pushSend).toHaveBeenCalledWith('user-1', expect.objectContaining({ title: expect.any(String) }));
  });

  it('skips a payment that is not refund_pending without touching the gateway', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT, status: 'paid' });
    const outcome = await service.attemptRefund('booking-1');
    expect(outcome).toBe('skipped');
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it('skips a missing payment', async () => {
    paymentsFindOneBy.mockResolvedValue(null);
    const outcome = await service.attemptRefund('booking-1');
    expect(outcome).toBe('skipped');
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it('leaves a payment with no authority pending and never calls the gateway', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT, authority: null });
    const outcome = await service.attemptRefund('booking-1');
    expect(outcome).toBe('pending');
    expect(refundPayment).not.toHaveBeenCalled();
    expect(paymentsUpdate).not.toHaveBeenCalled();
  });

  it('leaves the payment pending when the gateway refuses the refund', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT });
    refundPayment.mockResolvedValue({ success: false, refundRefId: null });
    const outcome = await service.attemptRefund('booking-1');
    expect(outcome).toBe('pending');
    expect(paymentsUpdate).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('catches a gateway throw and leaves the payment pending (never propagates)', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT });
    refundPayment.mockRejectedValue(new Error('Zarinpal refund failed: fetch failed'));
    const outcome = await service.attemptRefund('booking-1');
    expect(outcome).toBe('pending');
    expect(paymentsUpdate).not.toHaveBeenCalled();
  });

  it('does not notify when a concurrent attempt already won the conditional update', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT });
    refundPayment.mockResolvedValue({ success: true, refundRefId: 'RR-1' });
    paymentsUpdate.mockResolvedValue({ affected: 0 });

    const outcome = await service.attemptRefund('booking-1');

    expect(outcome).toBe('skipped');
    expect(smsSend).not.toHaveBeenCalled();
    expect(pushSend).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arayeshgah/api test -- payments.service`
Expected: FAIL — `attemptRefund` does not exist.

- [ ] **Step 3: Implement `attemptRefund`**

In `apps/api/src/booking/payments.service.ts`:

Update the payment-gateway import to include `PaymentRefundResult`:

```typescript
import { PAYMENT_GATEWAY, PaymentGateway, PaymentRefundResult } from './payment-gateway';
```

Add after `handleCallback` (before `markFailed`):

```typescript
  /**
   * The single consumer for refund_pending payments -- called inline by
   * BookingsService.cancel() right after its transaction commits, and by
   * RefundRetryJob for anything that slipped through. Never throws: a gateway
   * failure just leaves the payment refund_pending for the retry job's next
   * tick. Idempotent at both layers -- the conditional UPDATE means only one
   * concurrent attempt records the refund (and sends the one notification),
   * and the gateway treats a repeat refund of the same authority as success.
   */
  async attemptRefund(bookingId: string): Promise<'refunded' | 'pending' | 'skipped'> {
    const payment = await this.payments.findOneBy({ bookingId });
    if (!payment || payment.status !== 'refund_pending') return 'skipped';
    if (!payment.authority) {
      // Shouldn't occur -- a captured payment always has an authority -- but if it
      // does, an automatic refund is impossible and an operator has to step in.
      this.logger.error(`Payment ${payment.id} is refund_pending but has no authority -- needs manual refund`);
      return 'pending';
    }

    let result: PaymentRefundResult;
    try {
      result = await this.gateway.refundPayment(payment.authority);
    } catch (err) {
      this.logger.error(
        `Zarinpal refund threw for payment ${payment.id} (authority ${payment.authority}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'pending';
    }
    if (!result.success) {
      this.logger.error(`Zarinpal refused the refund for payment ${payment.id} (authority ${payment.authority}) -- will retry`);
      return 'pending';
    }

    const updated = await this.payments.update(
      { id: payment.id, status: 'refund_pending' },
      { status: 'refunded', refundRefId: result.refundRefId, refundedAt: new Date() },
    );
    // A losing concurrent attempt (inline cancel vs retry job) sees affected=0;
    // the winner already recorded the refund and sent the notification.
    if (!updated.affected) return 'skipped';

    await this.notifyRefunded(payment.bookingId);
    return 'refunded';
  }

  private async notifyRefunded(bookingId: string): Promise<void> {
    const booking = await this.bookings.findOneBy({ id: bookingId });
    if (!booking) return;
    const customer = await this.usersService.findById(booking.userId);
    if (!customer) return;
    await this.notifyOne(customer, 'مبلغ ودیعه نوبت شما بازگردانده شد.', {
      title: 'بازگشت وجه',
      body: 'مبلغ ودیعه نوبت شما بازگردانده شد.',
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arayeshgah/api test -- payments.service`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/booking/payments.service.ts apps/api/src/booking/payments.service.spec.ts
git commit -m "feat(api): PaymentsService.attemptRefund -- idempotent refund consumer with customer notification"
```

---

### Task 4: `cancel()` marks `refund_pending` and attempts the refund inline

**Files:**
- Modify: `apps/api/src/booking/bookings.service.ts`
- Test: `apps/api/src/booking/bookings.service.spec.ts` (new describe block)
- Test: `apps/api/test/booking-cancellation.e2e-spec.ts` (extend)

- [ ] **Step 1: Write the failing unit tests**

Append a new top-level `describe` to `apps/api/src/booking/bookings.service.spec.ts`. Add these imports at the top of the file:

```typescript
import { PaymentsService } from './payments.service';
```

The existing `describe('BookingsService.getEarnings', ...)` block's provider list also gains ONE line (it compiles the class, so the new constructor dependency must be mockable there too):

```typescript
        { provide: PaymentsService, useValue: { attemptRefund: jest.fn() } },
```

Then append:

```typescript
describe('BookingsService.cancel', () => {
  let service: BookingsService;
  let bookingsFindOneBy: jest.Mock;
  let salonsFindOneBy: jest.Mock;
  let emUpdate: jest.Mock;
  let attemptRefund: jest.Mock;

  const BOOKING = {
    id: 'booking-1',
    userId: 'customer-1',
    salonId: 'salon-1',
    status: 'confirmed',
    startsAt: new Date(Date.now() + 48 * 60 * 60_000), // 48h out -- outside the 24h window
  };

  beforeEach(async () => {
    emUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    attemptRefund = jest.fn().mockResolvedValue('refunded');
    bookingsFindOneBy = jest.fn();
    salonsFindOneBy = jest.fn().mockResolvedValue({ id: 'salon-1', ownerId: 'owner-1' });

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: bookingsFindOneBy } },
        { provide: getRepositoryToken(Payment), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: { findOneBy: salonsFindOneBy } },
        { provide: getRepositoryToken(SalonService), useValue: {} },
        { provide: DataSource, useValue: { transaction: jest.fn((cb: (em: unknown) => unknown) => cb({ update: emUpdate })) } },
        {
          provide: PlatformConfigService,
          useValue: { getCancellationWindowHours: jest.fn().mockResolvedValue(24) },
        },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
        { provide: REDIS, useValue: {} },
        { provide: PAYMENT_GATEWAY, useValue: {} },
        { provide: PaymentsService, useValue: { attemptRefund } },
      ],
    }).compile();

    service = moduleRef.get(BookingsService);
  });

  it('marks the payment refund_pending (with refundRequestedAt) and attempts the refund inline on an owner cancel', async () => {
    // findOneBy is called once pre-transaction and once for the returned row
    bookingsFindOneBy.mockResolvedValue({ ...BOOKING });

    await service.cancel('booking-1', 'owner-1');

    expect(emUpdate).toHaveBeenCalledWith(
      Payment,
      { bookingId: 'booking-1' },
      expect.objectContaining({ status: 'refund_pending', refundRequestedAt: expect.any(Date) }),
    );
    expect(attemptRefund).toHaveBeenCalledWith('booking-1');
  });

  it('does not attempt a refund when the customer cancels inside the window (deposit forfeited)', async () => {
    bookingsFindOneBy.mockResolvedValue({ ...BOOKING, startsAt: new Date(Date.now() + 2 * 60 * 60_000) });

    await service.cancel('booking-1', 'customer-1');

    expect(emUpdate).toHaveBeenCalledWith(Payment, { bookingId: 'booking-1' }, { status: 'paid' });
    expect(attemptRefund).not.toHaveBeenCalled();
  });

  it('does not attempt a refund for a pending_payment booking (nothing was captured)', async () => {
    bookingsFindOneBy.mockResolvedValue({ ...BOOKING, status: 'pending_payment' });

    await service.cancel('booking-1', 'customer-1');

    expect(emUpdate).toHaveBeenCalledWith(Payment, { bookingId: 'booking-1' }, { status: 'failed' });
    expect(attemptRefund).not.toHaveBeenCalled();
  });

  it('still succeeds the cancel when the inline refund attempt reports pending', async () => {
    bookingsFindOneBy.mockResolvedValue({ ...BOOKING });
    attemptRefund.mockResolvedValue('pending');

    const result = await service.cancel('booking-1', 'owner-1');

    expect(result).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arayeshgah/api test -- bookings.service`
Expected: FAIL — `PaymentsService` not a constructor dependency yet / `refund_pending` not written.

- [ ] **Step 3: Implement the cancel() changes**

In `apps/api/src/booking/bookings.service.ts`:

Add the import:

```typescript
import { PaymentsService } from './payments.service';
```

Add to the constructor (after the `gateway` param):

```typescript
    private readonly paymentsService: PaymentsService,
```

In `cancel()`, replace the payment-update block inside the transaction (currently the `if (booking.status === 'confirmed')` / `else` at the end of the transaction callback):

```typescript
      // A pending_payment booking never had a captured payment -- nothing to refund
      // or forfeit, so its payment is simply marked failed. A confirmed booking's
      // deposit was genuinely captured; `refund` decides the payment's fate.
      // refund_pending means "a real refund is owed" -- the inline attemptRefund()
      // call after this transaction commits (or, failing that, RefundRetryJob)
      // performs the actual Zarinpal refund and moves it to 'refunded'.
      if (booking.status === 'confirmed') {
        await em.update(
          Payment,
          { bookingId: booking.id },
          refund ? { status: 'refund_pending', refundRequestedAt: new Date() } : { status: 'paid' },
        );
      } else {
        await em.update(Payment, { bookingId: booking.id }, { status: 'failed' });
      }
```

Then, between the transaction and the final `return`, add the inline attempt:

```typescript
    // Attempt the real refund immediately so the common case completes within this
    // request (mock/happy path: customer sees the final state right away). attemptRefund
    // never throws -- a gateway failure leaves the payment refund_pending and the
    // cancellation response unaffected; RefundRetryJob self-heals it later.
    if (refund && booking.status === 'confirmed') {
      await this.paymentsService.attemptRefund(booking.id);
    }
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `pnpm --filter @arayeshgah/api test -- bookings.service`
Expected: PASS (both describe blocks).

- [ ] **Step 5: Extend the cancellation e2e spec**

In `apps/api/test/booking-cancellation.e2e-spec.ts`:

The two existing refund assertions still expect `refunded` (the inline mock refund completes within the cancel request), but now strengthen them. In `'fully refunds a user cancelling well outside the 24h window'` and `'always fully refunds when the salon cancels, regardless of timing'`, replace the final query + assertion with:

```typescript
    const ds = app.get(DataSource);
    const [payment] = await ds.query('SELECT status, refund_ref_id FROM payments WHERE id = $1', [paymentId]);
    expect(payment.status).toBe('refunded');
    expect(payment.refund_ref_id).toMatch(/^MOCKREFUND-/); // a real gateway refund happened, not just bookkeeping
```

Add a new test at the end of the describe block:

```typescript
  it('leaves the payment refund_pending when the gateway refuses the refund, without failing the cancel', async () => {
    const { bookingId, paymentId } = await bookAndConfirm(48);
    const ds = app.get(DataSource);
    // Force MockPaymentGateway.refundPayment to refuse by rewriting the authority
    // to contain the sentinel it checks for.
    await ds.query(`UPDATE payments SET authority = 'MOCK-REFUND-FAIL-' || authority WHERE id = $1`, [paymentId]);

    await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/cancel`)
      .set('Cookie', customerCookie)
      .expect(201);

    const [payment] = await ds.query('SELECT status, refund_ref_id FROM payments WHERE id = $1', [paymentId]);
    expect(payment.status).toBe('refund_pending'); // owed, not yet issued -- RefundRetryJob picks it up
    expect(payment.refund_ref_id).toBeNull();
  });
```

- [ ] **Step 6: Run the e2e spec**

Run: `pnpm --filter @arayeshgah/api test:e2e -- booking-cancellation`
Expected: PASS (7 tests). Requires docker services up.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/booking/bookings.service.ts apps/api/src/booking/bookings.service.spec.ts apps/api/test/booking-cancellation.e2e-spec.ts
git commit -m "feat(api): cancel() performs a real inline refund via attemptRefund"
```

---

### Task 5: Reconciliation's late-capture branch queues an automatic refund

**Files:**
- Modify: `apps/api/src/booking/payment-reconciliation.job.ts`
- Test: `apps/api/test/payment-reconciliation.e2e-spec.ts` (update one test)

- [ ] **Step 1: Update the failing e2e expectation first**

In `apps/api/test/payment-reconciliation.e2e-spec.ts`, in the test `'does not resurrect an already-expired booking, but still marks the payment paid if Zarinpal confirms it'`:

Rename it to `'does not resurrect an already-expired booking; the captured payment is queued for automatic refund'` and replace the final payment assertion:

```typescript
    const [payment] = await ds.query('SELECT status, refund_requested_at FROM payments WHERE booking_id = $1', [created.body.booking.id]);
    expect(payment.status).toBe('refund_pending'); // Zarinpal captured money for a dead booking -- refund it, don't just log
    expect(payment.refund_requested_at).not.toBeNull();
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @arayeshgah/api test:e2e -- payment-reconciliation`
Expected: FAIL — status is `paid`.

- [ ] **Step 3: Implement the branch change**

In `apps/api/src/booking/payment-reconciliation.job.ts`, replace the `verify.success` branch's body (the conditional booking update + log + payment update) with:

```typescript
            const result = await em.update(
              Booking,
              { id: payment.bookingId, status: 'pending_payment' },
              { status: 'confirmed' },
            );
            if (!result.affected) {
              // Zarinpal genuinely captured the money but the booking already moved
              // on (expired / cancelled) -- the customer must get it back. Queue an
              // automatic refund; RefundRetryJob performs it on its next tick.
              this.logger.error(
                `Payment ${payment.id} (authority ${payment.authority}) was confirmed by Zarinpal after its booking ${payment.bookingId} already left pending_payment -- queueing automatic refund`,
              );
              await em.update(Payment, { id: payment.id }, {
                status: 'refund_pending',
                refId: verify.refId,
                refundRequestedAt: new Date(),
              });
            } else {
              await em.update(Payment, { id: payment.id }, { status: 'paid', refId: verify.refId });
            }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @arayeshgah/api test:e2e -- payment-reconciliation`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/booking/payment-reconciliation.job.ts apps/api/test/payment-reconciliation.e2e-spec.ts
git commit -m "feat(api): reconciliation queues an automatic refund for late-captured dead bookings"
```

---

### Task 6: `RefundRetryJob`

**Files:**
- Create: `apps/api/src/booking/refund-retry.job.ts`
- Create (test): `apps/api/src/booking/refund-retry.job.spec.ts`
- Modify: `apps/api/src/booking/booking.module.ts` (register provider)
- Test: `apps/api/test/booking-cancellation.e2e-spec.ts` (end-to-end retry case)

- [ ] **Step 1: Write the failing unit tests**

Create `apps/api/src/booking/refund-retry.job.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LessThan } from 'typeorm';
import { Payment } from './payment.entity';
import { PaymentsService } from './payments.service';
import { RefundRetryJob } from './refund-retry.job';

describe('RefundRetryJob', () => {
  let job: RefundRetryJob;
  let paymentsFind: jest.Mock;
  let attemptRefund: jest.Mock;

  beforeEach(async () => {
    paymentsFind = jest.fn().mockResolvedValue([]);
    attemptRefund = jest.fn().mockResolvedValue('refunded');

    const moduleRef = await Test.createTestingModule({
      providers: [
        RefundRetryJob,
        { provide: getRepositoryToken(Payment), useValue: { find: paymentsFind } },
        { provide: PaymentsService, useValue: { attemptRefund } },
      ],
    }).compile();

    job = moduleRef.get(RefundRetryJob);
  });

  it('only selects refund_pending payments past the grace period', async () => {
    await job.run();

    const where = paymentsFind.mock.calls[0][0].where;
    expect(where.status).toBe('refund_pending');
    // grace period: refund_requested_at must be at least ~2 minutes old
    expect(where.refundRequestedAt).toEqual(LessThan(expect.any(Date)));
  });

  it('attempts a refund for each eligible payment and counts successes', async () => {
    paymentsFind.mockResolvedValue([
      { id: 'pay-1', bookingId: 'b1', refundRequestedAt: new Date(Date.now() - 10 * 60_000) },
      { id: 'pay-2', bookingId: 'b2', refundRequestedAt: new Date(Date.now() - 10 * 60_000) },
    ]);
    attemptRefund.mockResolvedValueOnce('refunded').mockResolvedValueOnce('pending');

    const refunded = await job.run();

    expect(attemptRefund).toHaveBeenCalledWith('b1');
    expect(attemptRefund).toHaveBeenCalledWith('b2');
    expect(refunded).toBe(1);
  });

  it('logs an escalation for a payment stuck refund_pending for over 24 hours', async () => {
    const errorSpy = jest.spyOn(job['logger'], 'error').mockImplementation();
    paymentsFind.mockResolvedValue([
      { id: 'pay-old', bookingId: 'b1', refundRequestedAt: new Date(Date.now() - 25 * 60 * 60_000) },
    ]);
    attemptRefund.mockResolvedValue('pending');

    await job.run();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('pay-old'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arayeshgah/api test -- refund-retry`
Expected: FAIL — module `./refund-retry.job` not found.

- [ ] **Step 3: Implement the job**

Create `apps/api/src/booking/refund-retry.job.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Payment } from './payment.entity';
import { PaymentsService } from './payments.service';

// Skip refunds younger than this: the producing cancel() very likely just ran its own
// inline attemptRefund(), and giving that a head start keeps the (harmless, idempotent)
// double gateway call rare instead of routine.
const RETRY_GRACE_MINUTES = 2;
// A refund the gateway has refused/failed for a full day won't fix itself -- an operator
// needs to look at it (Zarinpal wallet balance, revoked access token, etc.).
const ESCALATE_AFTER_HOURS = 24;

@Injectable()
export class RefundRetryJob {
  private readonly logger = new Logger(RefundRetryJob.name);

  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Cron('*/5 * * * *')
  async handleCron(): Promise<void> {
    await this.run();
  }

  async run(): Promise<number> {
    const graceCutoff = new Date(Date.now() - RETRY_GRACE_MINUTES * 60_000);
    const pending = await this.payments.find({
      where: { status: 'refund_pending', refundRequestedAt: LessThan(graceCutoff) },
    });

    let refunded = 0;
    for (const payment of pending) {
      if (
        payment.refundRequestedAt &&
        Date.now() - payment.refundRequestedAt.getTime() > ESCALATE_AFTER_HOURS * 3_600_000
      ) {
        this.logger.error(
          `Payment ${payment.id} has been refund_pending since ${payment.refundRequestedAt.toISOString()} (over ${ESCALATE_AFTER_HOURS}h) -- needs operator attention`,
        );
      }
      // attemptRefund never throws (it catches gateway errors internally), so one bad
      // payment can't block the rest of the batch.
      const outcome = await this.paymentsService.attemptRefund(payment.bookingId);
      if (outcome === 'refunded') refunded++;
    }
    return refunded;
  }
}
```

Register it in `apps/api/src/booking/booking.module.ts` — add the import:

```typescript
import { RefundRetryJob } from './refund-retry.job';
```

and add `RefundRetryJob,` to the `providers` array (after `PaymentReconciliationJob,`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arayeshgah/api test -- refund-retry`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the end-to-end retry case**

Append to the describe block in `apps/api/test/booking-cancellation.e2e-spec.ts` (import `RefundRetryJob` at the top: `import { RefundRetryJob } from '../src/booking/refund-retry.job';`):

```typescript
  it('RefundRetryJob completes a refund the inline attempt could not', async () => {
    const { bookingId, paymentId } = await bookAndConfirm(48);
    const ds = app.get(DataSource);
    // First make the refund fail inline...
    await ds.query(`UPDATE payments SET authority = 'MOCK-REFUND-FAIL-' || authority WHERE id = $1`, [paymentId]);
    await request(app.getHttpServer()).post(`/api/bookings/${bookingId}/cancel`).set('Cookie', customerCookie).expect(201);
    let [payment] = await ds.query('SELECT status FROM payments WHERE id = $1', [paymentId]);
    expect(payment.status).toBe('refund_pending');

    // ...then heal the authority (gateway outage over), backdate past the grace period, and retry.
    await ds.query(
      `UPDATE payments SET authority = replace(authority, 'MOCK-REFUND-FAIL-', ''), refund_requested_at = now() - interval '10 minutes' WHERE id = $1`,
      [paymentId],
    );
    const job = app.get(RefundRetryJob);
    const refunded = await job.run();
    // >= rather than === : in a slow run, the earlier MOCK-REFUND-FAIL test's row can
    // age past the grace period and be (harmlessly, unsuccessfully) retried here too.
    expect(refunded).toBeGreaterThanOrEqual(1);

    [payment] = await ds.query('SELECT status, refund_ref_id FROM payments WHERE id = $1', [paymentId]);
    expect(payment.status).toBe('refunded');
    expect(payment.refund_ref_id).toMatch(/^MOCKREFUND-/);
  });
```

- [ ] **Step 6: Run the e2e spec**

Run: `pnpm --filter @arayeshgah/api test:e2e -- booking-cancellation`
Expected: PASS (8 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/booking/refund-retry.job.ts apps/api/src/booking/refund-retry.job.spec.ts apps/api/src/booking/booking.module.ts apps/api/test/booking-cancellation.e2e-spec.ts
git commit -m "feat(api): RefundRetryJob self-heals failed refunds with 24h escalation logging"
```

---

### Task 7: `refundStatus` on `GET /bookings/:id`

**Files:**
- Modify: `apps/api/src/booking/bookings.service.ts` (`findMine`)
- Test: `apps/api/test/booking-cancellation.e2e-spec.ts` (extend two existing tests)

- [ ] **Step 1: Extend the failing e2e assertions**

In `apps/api/test/booking-cancellation.e2e-spec.ts`:

In `'fully refunds a user cancelling well outside the 24h window'`, after the payment assertions, add:

```typescript
    const detail = await request(app.getHttpServer())
      .get(`/api/bookings/${bookingId}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(detail.body.refundStatus).toBe('done');
```

In `'leaves the payment refund_pending when the gateway refuses the refund, without failing the cancel'`, add at the end:

```typescript
    const detail = await request(app.getHttpServer())
      .get(`/api/bookings/${bookingId}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(detail.body.refundStatus).toBe('pending');
```

In `'forfeits the deposit when the user cancels inside the 24h window'`, add at the end:

```typescript
    const detail = await request(app.getHttpServer())
      .get(`/api/bookings/${bookingId}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(detail.body.refundStatus).toBeNull();
```

- [ ] **Step 2: Run to verify the new assertions fail**

Run: `pnpm --filter @arayeshgah/api test:e2e -- booking-cancellation`
Expected: FAIL — `refundStatus` is `undefined`.

- [ ] **Step 3: Implement `findMine`'s refundStatus**

In `apps/api/src/booking/bookings.service.ts`, replace `findMine` with:

```typescript
  async findMine(
    userId: string,
    id: string,
  ): Promise<Booking & { salonName: string; serviceName: string; refundStatus: 'pending' | 'done' | null }> {
    const booking = await this.bookings.findOneBy({ id, userId });
    if (!booking) throw new NotFoundException('Booking not found');
    const [withNames] = await this.attachNames([booking]);
    // Customer-facing refund state for the booking detail page: 'pending' = a refund
    // is owed and being retried, 'done' = the gateway confirmed it, null = no refund
    // in play (not cancelled, forfeited deposit, or never captured).
    const payment = await this.payments.findOneBy({ bookingId: id });
    const refundStatus =
      payment?.status === 'refund_pending' ? ('pending' as const)
      : payment?.status === 'refunded' ? ('done' as const)
      : null;
    return { ...withNames, refundStatus };
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @arayeshgah/api test:e2e -- booking-cancellation`
Expected: PASS. Also run `pnpm --filter @arayeshgah/api test:e2e -- payment-reconciliation` (it hits `GET /bookings/:id` too) — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/booking/bookings.service.ts apps/api/test/booking-cancellation.e2e-spec.ts
git commit -m "feat(api): expose refundStatus on GET /bookings/:id"
```

---

### Task 8: Refund status line on the user-app booking detail page

**Files:**
- Modify: `apps/user-app/app/pages/bookings/[id].vue`
- Create (test): `apps/user-app/test/nuxt/booking-detail.spec.ts`

- [ ] **Step 1: Write the failing component test**

Create `apps/user-app/test/nuxt/booking-detail.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import BookingDetailPage from '../../app/pages/bookings/[id].vue'

// Same pattern as booking-confirm.spec.ts: `$fetch` is a real globalThis binding,
// not an unimport-tracked auto-import, so it's stubbed directly.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

mockNuxtImport('useRoute', () => () => ({ params: { id: 'b1' } }))

const BASE_BOOKING = {
  id: 'b1',
  salonName: 'Test Salon',
  serviceName: 'Haircut',
  startsAt: '2026-07-20T09:00:00.000Z',
  priceSnapshot: 300_000,
  depositAmount: 200_000,
  status: 'cancelled_by_salon',
  refundStatus: null as string | null,
}

describe('booking detail page refund line', () => {
  let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    wrapper?.unmount()
    wrapper = undefined
    clearNuxtData('booking-detail-b1')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the in-progress line while the refund is pending', async () => {
    fetchMock.mockResolvedValue({ ...BASE_BOOKING, refundStatus: 'pending' })
    wrapper = await mountSuspended(BookingDetailPage)
    expect(wrapper.text()).toContain('بازگشت وجه در حال انجام است')
  })

  it('shows the completed line once the refund is done', async () => {
    fetchMock.mockResolvedValue({ ...BASE_BOOKING, refundStatus: 'done' })
    wrapper = await mountSuspended(BookingDetailPage)
    expect(wrapper.text()).toContain('وجه بازگردانده شد')
    expect(wrapper.text()).not.toContain('در حال انجام')
  })

  it('shows no refund line when there is no refund in play', async () => {
    fetchMock.mockResolvedValue({ ...BASE_BOOKING, refundStatus: null })
    wrapper = await mountSuspended(BookingDetailPage)
    expect(wrapper.text()).not.toContain('بازگشت وجه')
    expect(wrapper.text()).not.toContain('بازگردانده')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @arayeshgah/user-app test -- booking-detail`
Expected: FAIL — the texts are not rendered.

- [ ] **Step 3: Implement the page change**

In `apps/user-app/app/pages/bookings/[id].vue`:

Add to the `BookingDetail` interface:

```typescript
  refundStatus: 'pending' | 'done' | null
```

Add to the template, after the deposit `<p>` line and before the `<NuxtLink>`:

```vue
    <p v-if="booking!.refundStatus === 'pending'" class="text-(--color-accent)">بازگشت وجه در حال انجام است</p>
    <p v-else-if="booking!.refundStatus === 'done'" class="text-(--color-accent)">وجه بازگردانده شد</p>
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @arayeshgah/user-app test -- booking-detail`
Expected: PASS (3 tests). Then run the full frontend suite + typecheck:

Run: `pnpm --filter @arayeshgah/user-app test && pnpm --filter @arayeshgah/user-app typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-app/app/pages/bookings/[id].vue apps/user-app/test/nuxt/booking-detail.spec.ts
git commit -m "feat(user-app): show refund status on the booking detail page"
```

---

### Task 9: Config, docs, and full-suite verification

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md` (lines ~17, ~241, ~270)
- Modify: `README.md` (lines ~50, ~61)

- [ ] **Step 1: Add the env var**

In `.env.example`, after `ZARINPAL_MERCHANT_ID=`, add:

```
# Personal access token from the Zarinpal panel -- required only when PAYMENT_GATEWAY=zarinpal (refund API auth)
ZARINPAL_ACCESS_TOKEN=
```

- [ ] **Step 2: Update CLAUDE.md**

Three edits:

1. In the Development Mindset bullet listing deliberate MVP scope cuts (`bookkeeping-only refunds, reactive moderation, hold-TTL/reconciliation timing`), remove `bookkeeping-only refunds, ` (refunds are now real).

2. Replace the `Payment.status` row in the Domain Model table with:

```markdown
| `Payment.status` | `initiated` → `paid` → `refund_pending` → `refunded` \| `failed` — refunds are **real**: `refund_pending` means a refund is owed and being processed; `refunded` means Zarinpal confirmed it (`refund_ref_id` stored). Producers: `cancel()` (inline attempt), reconciliation's late-capture branch; `RefundRetryJob` (cron, 5 min) self-heals failures and escalate-logs after 24 h. Requires `ZARINPAL_ACCESS_TOKEN` in zarinpal mode; the exact refund success codes must still be verified against Zarinpal's sandbox before production |
```

3. Replace the Known Gaps bullet `- **No real payment refunds**, and no real alerting/paging on the ...` with:

```markdown
- **Refunds are real but sandbox-unverified.** The Zarinpal refund integration (`refund.json`, Bearer `ZARINPAL_ACCESS_TOKEN`) follows the documented contract but has never been exercised against a real Zarinpal account — verify in sandbox before production. There is still no real alerting/paging on the `logger.error(...)` operator signals (stuck refunds, payments needing review) — that remains an explicit MVP scope cut.
```

- [ ] **Step 3: Update README.md**

1. Replace the paragraph at ~line 50 (`**No money actually moves automatically in this plan.** ...`) with:

```markdown
**Refunds are real as of Plan 8.** Cancelling a confirmed booking (salon cancel, or customer cancel outside the window) triggers an actual Zarinpal refund (`/pg/v4/payment/refund.json`, authenticated with a panel-issued access token): the payment moves `refund_pending → refunded` with the gateway's refund reference stored, a retry cron self-heals gateway failures, and the reconciliation job's "captured after the booking died" edge case now queues an automatic refund instead of a manual-review log. The remaining cuts: the `logger.error(...)` operator signals (stuck refunds, orphaned authorities) still have no alerting/paging integration, and the refund path has not yet been verified against Zarinpal's sandbox.
```

2. In the ~line 61 paragraph, replace `Zarinpal refund settlement remains outside the system, same as Plan 2.` with `Zarinpal refund settlement is now in-system (Plan 8).`

- [ ] **Step 4: Full verification**

Run each; all must pass:

```bash
pnpm --filter @arayeshgah/api test
pnpm --filter @arayeshgah/api test:e2e
pnpm --filter @arayeshgah/user-app test
pnpm --filter @arayeshgah/user-app typecheck
pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add .env.example CLAUDE.md README.md
git commit -m "docs: real payment refunds -- env var, domain model, known gaps"
```

---

## Post-plan

After all tasks: use superpowers:requesting-code-review to review the branch against the spec, then superpowers:finishing-a-development-branch (merge to `main` after the user's confirmation, as in prior plans). Deployment prerequisite (tracked in Known Gaps): verify the refund path against Zarinpal's sandbox with a real access token before enabling `PAYMENT_GATEWAY=zarinpal` in production.
