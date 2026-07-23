import { ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager, QueryFailedError } from 'typeorm';
import { Salon } from '../salons/salon.entity';
import { Worker } from '../salons/worker.entity';
import { ReferralCode } from './referral-code.entity';
import { ReferralRewardType } from './referral-reward-type.entity';
import { Referral } from './referral.entity';
import { maskPhone, ReferralsService } from './referrals.service';

// Minimal in-memory fake DB driving em.query() for tryGrantReward/reverseIfNeeded --
// mirrors wallet.service.spec.ts's fake-em approach (pattern-match on SQL shape, keep
// mutable in-memory state) rather than asserting on literal SQL strings, so the tests
// pin behavior, not exact query text.
interface FakeReferralRow {
  id: string;
  referrer_user_id: string;
  referred_user_id: string;
  salon_id: string | null;
  referrer_reward_kind: string;
  referrer_reward_value: string;
  referrer_reward_max: string | null;
  referred_reward_kind: string;
  referred_reward_value: string;
  referred_reward_max: string | null;
  qualifying_event: string;
  grant_holdback_hours: number;
  status: string;
  expires_at: string | null;
}

interface FakeRewardRow {
  id: string;
  referral_id: string;
  beneficiary_user_id: string;
  beneficiary_role: string;
  reward_kind: string;
  reward_value: string;
  wallet_transaction_id: string | null;
  coupon_id: string | null;
  status: string;
  reversal_reason?: string | null;
}

interface FakeCouponRow {
  id: string;
  code: string;
  salon_id: string | null;
  discount_percent: number | null;
  discount_fixed_amount: number | null;
  is_active: boolean;
  max_redemptions: number | null;
  expires_at: Date;
  issued_to_user_id: string;
}

function makeFakeReferral(overrides: Partial<FakeReferralRow> = {}): FakeReferralRow {
  return {
    id: 'referral-1',
    referrer_user_id: 'referrer-1',
    referred_user_id: 'referred-1',
    salon_id: null,
    referrer_reward_kind: 'wallet_credit',
    referrer_reward_value: '20000',
    referrer_reward_max: null,
    referred_reward_kind: 'wallet_credit',
    referred_reward_value: '15000',
    referred_reward_max: null,
    qualifying_event: 'first_completed_booking',
    grant_holdback_hours: 72,
    status: 'awaiting_qualifying_event',
    expires_at: null,
    ...overrides,
  };
}

/** Fake `em` for tryGrantReward -- an in-memory referrals + referral_rewards + coupons + payments table. */
function makeGrantFakeEm(opts: {
  referral: FakeReferralRow | null;
  payment?: { status: string; paid_at: string | null } | null;
  existingRewards?: FakeRewardRow[];
}) {
  const rewards: FakeRewardRow[] = [...(opts.existingRewards ?? [])];
  const coupons: FakeCouponRow[] = [];
  const referralUpdates: Array<{ sql: string; params: unknown[] }> = [];
  let nextId = rewards.length + 1;
  let nextCouponId = 1;

  const query = jest.fn(async (sql: string, params: unknown[] = []): Promise<unknown> => {
    if (sql.includes('FROM referrals WHERE referred_user_id')) {
      return opts.referral ? [opts.referral] : [];
    }
    if (sql.includes('FROM payments WHERE booking_id')) {
      return opts.payment ? [opts.payment] : [];
    }
    if (sql.includes('INSERT INTO wallet_balances')) return [];
    if (sql.includes('SELECT user_id FROM wallet_balances')) return [];
    if (sql.includes('SELECT id FROM referral_rewards WHERE referral_id')) {
      const [referralId, role] = params as [string, string];
      const found = rewards.find((r) => r.referral_id === referralId && r.beneficiary_role === role);
      return found ? [{ id: found.id }] : [];
    }
    if (sql.includes('INSERT INTO referral_rewards')) {
      const [referralId, userId, role, kind, value] = params as [string, string, string, string, number];
      const id = `reward-${nextId++}`;
      rewards.push({
        id,
        referral_id: referralId,
        beneficiary_user_id: userId,
        beneficiary_role: role,
        reward_kind: kind,
        reward_value: String(value),
        wallet_transaction_id: null,
        coupon_id: null,
        status: 'granted',
      });
      return [{ id }];
    }
    if (sql.includes('INSERT INTO coupons')) {
      const [code, salonId, discountPercent, discountFixedAmount, expiresAt, issuedToUserId] = params as [
        string,
        string | null,
        number | null,
        number | null,
        Date,
        string,
      ];
      const id = `coupon-${nextCouponId++}`;
      coupons.push({
        id,
        code,
        salon_id: salonId,
        discount_percent: discountPercent,
        discount_fixed_amount: discountFixedAmount,
        is_active: true,
        max_redemptions: 1,
        expires_at: expiresAt,
        issued_to_user_id: issuedToUserId,
      });
      return [{ id }];
    }
    if (sql.includes('UPDATE referral_rewards SET wallet_transaction_id')) {
      const [id, txId] = params as [string, string];
      const r = rewards.find((row) => row.id === id);
      if (r) r.wallet_transaction_id = txId;
      return [];
    }
    if (sql.includes('UPDATE referral_rewards SET coupon_id')) {
      const [id, couponId] = params as [string, string];
      const r = rewards.find((row) => row.id === id);
      if (r) r.coupon_id = couponId;
      return [];
    }
    if (sql.includes('SELECT COUNT(*)::int AS c FROM referral_rewards')) {
      const [referralId] = params as [string];
      return [{ c: String(rewards.filter((r) => r.referral_id === referralId).length) }];
    }
    if (sql.includes('UPDATE referrals SET status')) {
      referralUpdates.push({ sql, params });
      return [];
    }
    throw new Error(`Unexpected query in tryGrantReward test: ${sql}`);
  });

  const em = { query } as unknown as EntityManager;
  return { em, rewards, coupons, referralUpdates };
}

/** Fake `em` for reverseIfNeeded -- an in-memory referrals + referral_rewards table. */
function makeReverseFakeEm(opts: { referralIds: string[]; rewards: FakeRewardRow[] }) {
  const rewards = opts.rewards;
  const rewardUpdates: Array<{ sql: string; params: unknown[] }> = [];

  const query = jest.fn(async (sql: string, params: unknown[] = []): Promise<unknown> => {
    if (sql.includes('FROM referrals WHERE qualifying_booking_id')) {
      return opts.referralIds.map((id) => ({ id }));
    }
    if (sql.includes('FROM referral_rewards WHERE referral_id') && sql.includes("status = 'granted'")) {
      const [referralId] = params as [string];
      return rewards.filter((r) => r.referral_id === referralId && r.status === 'granted');
    }
    if (sql.includes('UPDATE referral_rewards') && sql.includes("status = 'reversed'")) {
      const [id] = params as [string];
      const r = rewards.find((row) => row.id === id);
      if (r) r.status = 'reversed'; // mutating in-memory state proves double-call idempotency
      rewardUpdates.push({ sql, params });
      return [];
    }
    if (sql.includes('UPDATE referral_rewards SET reversal_reason')) {
      const [id, reason] = params as [string, string];
      const r = rewards.find((row) => row.id === id);
      if (r) r.reversal_reason = reason; // status/reversed_at deliberately untouched
      rewardUpdates.push({ sql, params });
      return [];
    }
    if (sql.includes('coupon_redemptions')) return [];
    if (sql.includes('UPDATE coupons SET is_active')) return [];
    throw new Error(`Unexpected query in reverseIfNeeded test: ${sql}`);
  });

  const em = { query } as unknown as EntityManager;
  return { em, rewards, rewardUpdates };
}

// Same shape used across this codebase's other *.service.spec.ts files: a TypeORM
// QueryFailedError carrying the pg driver's code, which isUniqueViolation() reads.
function uniqueViolation(): QueryFailedError {
  const driverError = Object.assign(new Error('duplicate key'), { code: '23505' });
  return new QueryFailedError('INSERT INTO referrals', [], driverError);
}

function makeRewardType(overrides: Partial<ReferralRewardType> = {}): ReferralRewardType {
  return {
    referralType: 'user',
    enabled: true,
    referrerRewardKind: 'wallet_credit',
    referrerRewardValue: 10000,
    referrerRewardMax: null,
    referredRewardKind: 'percent_discount',
    referredRewardValue: 10,
    referredRewardMax: null,
    qualifyingEvent: 'first_paid_booking',
    grantHoldbackHours: 72,
    expirationDays: null,
    maxReferralsPerReferrer: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeReferralCode(overrides: Partial<ReferralCode> = {}): ReferralCode {
  return {
    id: 'code-1',
    code: 'ABC12345',
    ownerUserId: 'referrer-1',
    disabledAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('ReferralsService', () => {
  let referralCodesRepo: { findOneBy: jest.Mock; save: jest.Mock; create: jest.Mock };
  let rewardTypesRepo: { findOneBy: jest.Mock; find: jest.Mock; update: jest.Mock };
  let referralsRepo: { update: jest.Mock; findOneBy: jest.Mock; count: jest.Mock; createQueryBuilder: jest.Mock };
  let salonsRepo: { findOneBy: jest.Mock };
  let workersRepo: { findOneBy: jest.Mock };
  let config: { get: jest.Mock };
  let referralRewardsRepo: { createQueryBuilder: jest.Mock; count: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let wallet: { credit: jest.Mock; debit: jest.Mock };
  let alerts: { raise: jest.Mock };
  let service: ReferralsService;

  beforeEach(() => {
    referralCodesRepo = { findOneBy: jest.fn(), save: jest.fn(), create: jest.fn((v) => v) };
    rewardTypesRepo = { findOneBy: jest.fn(), find: jest.fn(), update: jest.fn() };
    referralsRepo = { update: jest.fn(), findOneBy: jest.fn(), count: jest.fn(), createQueryBuilder: jest.fn() };
    salonsRepo = { findOneBy: jest.fn() };
    workersRepo = { findOneBy: jest.fn() };
    config = { get: jest.fn().mockReturnValue('http://localhost:3003') };
    referralRewardsRepo = { createQueryBuilder: jest.fn(), count: jest.fn() };
    // transaction() just invokes the callback with whatever `em` the individual test
    // wired up via makeGrantFakeEm/makeReverseFakeEm -- set per-test on dataSource.transaction.
    dataSource = { transaction: jest.fn() };
    wallet = {
      credit: jest.fn().mockResolvedValue({ balanceAfter: 0, transactionId: 'tx-1' }),
      debit: jest.fn().mockResolvedValue({ debited: 0, shortfall: 0, balanceAfter: 0 }),
    };
    alerts = { raise: jest.fn().mockResolvedValue(undefined) };

    service = new ReferralsService(
      referralCodesRepo as never,
      rewardTypesRepo as never,
      referralsRepo as never,
      salonsRepo as never,
      workersRepo as never,
      config as never,
      referralRewardsRepo as never,
      dataSource as never,
      wallet as never,
      alerts as never,
    );
  });

  describe('maskPhone', () => {
    it('masks the middle digits of an 11-digit Iranian phone number', () => {
      expect(maskPhone('09121234567')).toBe('0912***4567');
    });

    it('leaves a too-short string alone rather than producing a nonsensical mask', () => {
      expect(maskPhone('1234')).toBe('1234');
    });
  });

  describe('resolveReferralType', () => {
    // Fake EntityManager whose getRepository() dispatches to the same jest mocks the
    // service is otherwise constructed with, so tests can assert on the exact same
    // mock regardless of whether the em or no-em path is exercised.
    function makeEm(): EntityManager {
      return {
        getRepository: jest.fn((entity: unknown) => {
          if (entity === Worker) return workersRepo;
          if (entity === Salon) return salonsRepo;
          throw new Error(`unexpected entity in test em: ${String(entity)}`);
        }),
      } as unknown as EntityManager;
    }

    it('resolves to worker when the user has an active workers row, even if they also own a different salon', async () => {
      workersRepo.findOneBy.mockResolvedValue({ id: 'w1', userId: 'u1', active: true, salonId: 'salon-a' });
      salonsRepo.findOneBy.mockResolvedValue({ id: 'salon-b', ownerId: 'u1' });

      const result = await service.resolveReferralType('u1', makeEm());

      expect(result).toBe('worker');
      // Precedence proof: the salon owner check is short-circuited entirely once an
      // active worker row is found.
      expect(salonsRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('resolves to salon_owner when there is no active worker row but the user owns a salon', async () => {
      workersRepo.findOneBy.mockResolvedValue(null);
      salonsRepo.findOneBy.mockResolvedValue({ id: 'salon-b', ownerId: 'u1' });

      await expect(service.resolveReferralType('u1', makeEm())).resolves.toBe('salon_owner');
    });

    it('resolves to user when neither an active worker row nor an owned salon exists', async () => {
      workersRepo.findOneBy.mockResolvedValue(null);
      salonsRepo.findOneBy.mockResolvedValue(null);

      await expect(service.resolveReferralType('u1', makeEm())).resolves.toBe('user');
    });

    it('ignores a deactivated worker row (active=false is filtered at the query level, not in JS)', async () => {
      // findOneBy({ userId, active: true }) simply returns null when the only row is
      // inactive -- this test pins that the mock call itself was scoped correctly.
      workersRepo.findOneBy.mockResolvedValue(null);
      salonsRepo.findOneBy.mockResolvedValue(null);

      await service.resolveReferralType('u1', makeEm());

      expect(workersRepo.findOneBy).toHaveBeenCalledWith({ userId: 'u1', active: true });
    });
  });

  describe('applyReferralAtRegistration', () => {
    let referralInsert: jest.Mock;
    let referralCount: jest.Mock;
    let emQuery: jest.Mock;

    function makeEm(): EntityManager {
      referralInsert = jest.fn().mockResolvedValue({ identifiers: [{ id: 'referral-1' }] });
      referralCount = jest.fn().mockResolvedValue(0); // no existing referrals unless a test says otherwise
      emQuery = jest.fn().mockResolvedValue(undefined);
      return {
        query: emQuery,
        getRepository: jest.fn((entity: unknown) => {
          if (entity === ReferralCode) return referralCodesRepo;
          if (entity === ReferralRewardType) return rewardTypesRepo;
          if (entity === Referral) return { insert: referralInsert, count: referralCount };
          if (entity === Worker) return workersRepo;
          if (entity === Salon) return salonsRepo;
          throw new Error(`unexpected entity in test em: ${String(entity)}`);
        }),
      } as unknown as EntityManager;
    }

    it('returns invalid_code when the code does not exist (or is disabled)', async () => {
      referralCodesRepo.findOneBy.mockResolvedValue(null);

      const result = await service.applyReferralAtRegistration('new-user-1', 'NOPE', makeEm());

      expect(result).toEqual({ status: 'invalid_code' });
      expect(referralInsert).not.toHaveBeenCalled();
    });

    it('defensively rejects a code redeeming itself (cannot happen at registration, guarded anyway)', async () => {
      referralCodesRepo.findOneBy.mockResolvedValue(makeReferralCode({ ownerUserId: 'new-user-1' }));

      const result = await service.applyReferralAtRegistration('new-user-1', 'ABC12345', makeEm());

      expect(result).toEqual({ status: 'invalid_code' });
      expect(referralInsert).not.toHaveBeenCalled();
    });

    it('returns referral_type_disabled and creates no row when the resolved type is disabled (the default)', async () => {
      referralCodesRepo.findOneBy.mockResolvedValue(makeReferralCode());
      workersRepo.findOneBy.mockResolvedValue(null);
      salonsRepo.findOneBy.mockResolvedValue(null);
      rewardTypesRepo.findOneBy.mockResolvedValue(makeRewardType({ referralType: 'user', enabled: false }));

      const result = await service.applyReferralAtRegistration('new-user-1', 'abc12345', makeEm());

      expect(result).toEqual({ status: 'referral_type_disabled' });
      expect(referralInsert).not.toHaveBeenCalled();
    });

    it('creates a snapshotted referrals row with salonId=null for an enabled user-type referral', async () => {
      referralCodesRepo.findOneBy.mockResolvedValue(makeReferralCode());
      workersRepo.findOneBy.mockResolvedValue(null);
      salonsRepo.findOneBy.mockResolvedValue(null);
      const rewardType = makeRewardType({
        referralType: 'user',
        enabled: true,
        referrerRewardValue: 5000,
        expirationDays: 30,
      });
      rewardTypesRepo.findOneBy.mockResolvedValue(rewardType);

      const result = await service.applyReferralAtRegistration('new-user-1', 'ABC12345', makeEm());

      expect(result).toEqual({ status: 'applied' });
      expect(referralInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          referralCodeId: 'code-1',
          referrerUserId: 'referrer-1',
          referredUserId: 'new-user-1',
          referralType: 'user',
          salonId: null,
          referrerRewardKind: 'wallet_credit',
          referrerRewardValue: 5000,
          referredRewardKind: 'percent_discount',
          qualifyingEvent: 'first_paid_booking',
          grantHoldbackHours: 72,
          status: 'awaiting_qualifying_event',
        }),
      );
      const insertedRow = referralInsert.mock.calls[0][0];
      expect(insertedRow.expiresAt).toBeInstanceOf(Date);
      expect(emQuery).toHaveBeenCalledWith('SAVEPOINT referral_apply');
      expect(emQuery).toHaveBeenCalledWith('RELEASE SAVEPOINT referral_apply');
    });

    it('resolves salonId to the owned salon for a salon_owner-type referral', async () => {
      referralCodesRepo.findOneBy.mockResolvedValue(makeReferralCode());
      workersRepo.findOneBy.mockResolvedValue(null);
      salonsRepo.findOneBy.mockResolvedValue({ id: 'salon-owned-1', ownerId: 'referrer-1' });
      rewardTypesRepo.findOneBy.mockResolvedValue(makeRewardType({ referralType: 'salon_owner', enabled: true }));

      await service.applyReferralAtRegistration('new-user-1', 'ABC12345', makeEm());

      expect(referralInsert).toHaveBeenCalledWith(
        expect.objectContaining({ referralType: 'salon_owner', salonId: 'salon-owned-1' }),
      );
    });

    it('resolves salonId to the active worker row salon for a worker-type referral', async () => {
      referralCodesRepo.findOneBy.mockResolvedValue(makeReferralCode());
      workersRepo.findOneBy.mockResolvedValueOnce({ id: 'w1', userId: 'referrer-1', active: true, salonId: 'salon-x' });
      // resolveSalonId's own lookup (second call to workersRepo.findOneBy within the em)
      workersRepo.findOneBy.mockResolvedValueOnce({ id: 'w1', userId: 'referrer-1', active: true, salonId: 'salon-x' });
      rewardTypesRepo.findOneBy.mockResolvedValue(makeRewardType({ referralType: 'worker', enabled: true }));

      await service.applyReferralAtRegistration('new-user-1', 'ABC12345', makeEm());

      expect(referralInsert).toHaveBeenCalledWith(expect.objectContaining({ referralType: 'worker', salonId: 'salon-x' }));
    });

    it('treats a unique-violation on referred_user_id as an idempotent no-op, not a throw', async () => {
      referralCodesRepo.findOneBy.mockResolvedValue(makeReferralCode());
      workersRepo.findOneBy.mockResolvedValue(null);
      salonsRepo.findOneBy.mockResolvedValue(null);
      rewardTypesRepo.findOneBy.mockResolvedValue(makeRewardType({ enabled: true }));
      const em = makeEm();
      referralInsert.mockRejectedValue(uniqueViolation());

      const result = await service.applyReferralAtRegistration('new-user-1', 'ABC12345', em);

      expect(result).toEqual({ status: 'invalid_code' });
      expect(emQuery).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT referral_apply');
    });

    it('lets a genuinely different insert error propagate (not swallowed)', async () => {
      referralCodesRepo.findOneBy.mockResolvedValue(makeReferralCode());
      workersRepo.findOneBy.mockResolvedValue(null);
      salonsRepo.findOneBy.mockResolvedValue(null);
      rewardTypesRepo.findOneBy.mockResolvedValue(makeRewardType({ enabled: true }));
      const em = makeEm();
      referralInsert.mockRejectedValue(new Error('db down'));

      await expect(service.applyReferralAtRegistration('new-user-1', 'ABC12345', em)).rejects.toThrow('db down');
      expect(emQuery).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT referral_apply');
    });

    describe('R10 -- max_referrals_per_referrer, enforced at redemption time (Piece 2)', () => {
      it('never counts at all when maxReferralsPerReferrer is null (the default)', async () => {
        referralCodesRepo.findOneBy.mockResolvedValue(makeReferralCode());
        workersRepo.findOneBy.mockResolvedValue(null);
        salonsRepo.findOneBy.mockResolvedValue(null);
        rewardTypesRepo.findOneBy.mockResolvedValue(makeRewardType({ enabled: true, maxReferralsPerReferrer: null }));
        const em = makeEm();

        const result = await service.applyReferralAtRegistration('new-user-1', 'ABC12345', em);

        expect(result).toEqual({ status: 'applied' });
        expect(referralCount).not.toHaveBeenCalled();
      });

      it('allows redemption right up to the cap (count === max - 1)', async () => {
        referralCodesRepo.findOneBy.mockResolvedValue(makeReferralCode());
        workersRepo.findOneBy.mockResolvedValue(null);
        salonsRepo.findOneBy.mockResolvedValue(null);
        rewardTypesRepo.findOneBy.mockResolvedValue(makeRewardType({ enabled: true, maxReferralsPerReferrer: 3 }));
        const em = makeEm(); // must come first -- makeEm() creates a fresh referralCount mock
        referralCount.mockResolvedValue(2);

        const result = await service.applyReferralAtRegistration('new-user-1', 'ABC12345', em);

        expect(result).toEqual({ status: 'applied' });
        expect(referralInsert).toHaveBeenCalled();
        expect(referralCount).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ referrerUserId: 'referrer-1', referralType: 'user' }),
          }),
        );
      });

      it('blocks redemption once the cap is already reached (count === max), creates no row', async () => {
        referralCodesRepo.findOneBy.mockResolvedValue(makeReferralCode());
        workersRepo.findOneBy.mockResolvedValue(null);
        salonsRepo.findOneBy.mockResolvedValue(null);
        rewardTypesRepo.findOneBy.mockResolvedValue(makeRewardType({ enabled: true, maxReferralsPerReferrer: 3 }));
        const em = makeEm(); // must come first -- makeEm() creates a fresh referralCount mock
        referralCount.mockResolvedValue(3);

        // R10 deliberately reuses 'referral_type_disabled' rather than a 4th status.
        const result = await service.applyReferralAtRegistration('new-user-1', 'ABC12345', em);

        expect(result).toEqual({ status: 'referral_type_disabled' });
        expect(referralInsert).not.toHaveBeenCalled();
      });

      it('blocks redemption once the cap is exceeded (count > max, e.g. a racing concurrent grant)', async () => {
        referralCodesRepo.findOneBy.mockResolvedValue(makeReferralCode());
        workersRepo.findOneBy.mockResolvedValue(null);
        salonsRepo.findOneBy.mockResolvedValue(null);
        rewardTypesRepo.findOneBy.mockResolvedValue(makeRewardType({ enabled: true, maxReferralsPerReferrer: 3 }));
        const em = makeEm(); // must come first -- makeEm() creates a fresh referralCount mock
        referralCount.mockResolvedValue(4);

        const result = await service.applyReferralAtRegistration('new-user-1', 'ABC12345', em);

        expect(result).toEqual({ status: 'referral_type_disabled' });
        expect(referralInsert).not.toHaveBeenCalled();
      });

      it('excludes cancelled referrals from the count (status != cancelled)', async () => {
        referralCodesRepo.findOneBy.mockResolvedValue(makeReferralCode());
        workersRepo.findOneBy.mockResolvedValue(null);
        salonsRepo.findOneBy.mockResolvedValue(null);
        rewardTypesRepo.findOneBy.mockResolvedValue(makeRewardType({ enabled: true, maxReferralsPerReferrer: 1 }));
        const em = makeEm();

        await service.applyReferralAtRegistration('new-user-1', 'ABC12345', em);

        // Assert the count query's where-clause actually excludes 'cancelled' --
        // pinning the Not('cancelled') filter itself, not just its net effect.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting TypeORM's internal FindOperator shape
        const statusFilter = referralCount.mock.calls[0][0].where.status as any;
        expect(statusFilter._type).toBe('not');
        expect(statusFilter._value).toBe('cancelled');
      });
    });
  });

  describe('cancel', () => {
    it('409s when the referral exists but is no longer awaiting_qualifying_event', async () => {
      referralsRepo.update.mockResolvedValue({ affected: 0 });
      referralsRepo.findOneBy.mockResolvedValue({ id: 'r1', status: 'reward_granted' });

      await expect(service.cancel('r1', 'fraud suspected')).rejects.toBeInstanceOf(ConflictException);
    });

    it('a second cancel attempt on the same row also 409s (idempotent lost-race guard)', async () => {
      referralsRepo.update.mockResolvedValueOnce({ affected: 1 });
      referralsRepo.findOneBy.mockResolvedValueOnce({ id: 'r1', status: 'cancelled' });
      await service.cancel('r1', 'first cancel');

      referralsRepo.update.mockResolvedValueOnce({ affected: 0 });
      referralsRepo.findOneBy.mockResolvedValueOnce({ id: 'r1', status: 'cancelled' });
      await expect(service.cancel('r1', 'second cancel')).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s when the referral does not exist at all', async () => {
      referralsRepo.update.mockResolvedValue({ affected: 0 });
      referralsRepo.findOneBy.mockResolvedValue(null);

      await expect(service.cancel('nope', 'reason')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('cancels a referral still awaiting its qualifying event', async () => {
      referralsRepo.update.mockResolvedValue({ affected: 1 });
      referralsRepo.findOneBy.mockResolvedValue({ id: 'r1', status: 'cancelled', cancelledReason: 'fraud suspected' });

      const result = await service.cancel('r1', 'fraud suspected');

      expect(referralsRepo.update).toHaveBeenCalledWith(
        { id: 'r1', status: 'awaiting_qualifying_event' },
        { status: 'cancelled', cancelledReason: 'fraud suspected' },
      );
      expect(result.status).toBe('cancelled');
    });
  });

  describe('updateRewardType', () => {
    it('never touches the referrals table', async () => {
      rewardTypesRepo.update.mockResolvedValue({ affected: 1 });
      rewardTypesRepo.findOneBy.mockResolvedValue(makeRewardType({ enabled: true }));

      await service.updateRewardType('user', { enabled: true });

      expect(referralsRepo.update).not.toHaveBeenCalled();
      expect(referralsRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('404s for a bogus type', async () => {
      rewardTypesRepo.update.mockResolvedValue({ affected: 0 });
      await expect(service.updateRewardType('user', { enabled: true })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('only patches fields explicitly present on the DTO', async () => {
      rewardTypesRepo.update.mockResolvedValue({ affected: 1 });
      rewardTypesRepo.findOneBy.mockResolvedValue(makeRewardType({ enabled: true }));

      await service.updateRewardType('user', { enabled: true });

      expect(rewardTypesRepo.update).toHaveBeenCalledWith(
        { referralType: 'user' },
        expect.objectContaining({ enabled: true, updatedAt: expect.any(Date) }),
      );
      const patch = rewardTypesRepo.update.mock.calls[0][1];
      expect(patch).not.toHaveProperty('referrerRewardKind');
      expect(patch).not.toHaveProperty('grantHoldbackHours');
    });
  });

  describe('tryGrantReward', () => {
    const OLD_ENOUGH = new Date(Date.now() - 100 * 3600_000).toISOString(); // 100h ago
    const TOO_RECENT = new Date(Date.now() - 1 * 3600_000).toISOString(); // 1h ago

    it('no-ops when no referral is found for the referred user', async () => {
      const { em } = makeGrantFakeEm({ referral: null });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.tryGrantReward('nobody', 'booking-1', 'completed');

      expect(wallet.credit).not.toHaveBeenCalled();
      expect(alerts.raise).not.toHaveBeenCalled();
    });

    it.each(['reward_granted', 'expired', 'cancelled'])('no-ops when the referral status is already %s', async (status) => {
      const { em } = makeGrantFakeEm({ referral: makeFakeReferral({ status }) });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.tryGrantReward('referred-1', 'booking-1', 'completed');

      expect(wallet.credit).not.toHaveBeenCalled();
    });

    it('no-ops when the eventType does not match the referral\'s qualifying_event', async () => {
      const { em } = makeGrantFakeEm({
        referral: makeFakeReferral({ qualifying_event: 'first_completed_booking' }),
      });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.tryGrantReward('referred-1', 'booking-1', 'paid'); // maps to first_paid_booking

      expect(wallet.credit).not.toHaveBeenCalled();
    });

    it('no-ops when the referral has already expired', async () => {
      const { em } = makeGrantFakeEm({
        referral: makeFakeReferral({ expires_at: new Date(Date.now() - 1000).toISOString() }),
      });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.tryGrantReward('referred-1', 'booking-1', 'completed');

      expect(wallet.credit).not.toHaveBeenCalled();
    });

    it('no-ops for first_paid_booking when the hold-back window has not yet elapsed', async () => {
      const { em } = makeGrantFakeEm({
        referral: makeFakeReferral({ qualifying_event: 'first_paid_booking', grant_holdback_hours: 72 }),
        payment: { status: 'paid', paid_at: TOO_RECENT },
      });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.tryGrantReward('referred-1', 'booking-1', 'paid');

      expect(wallet.credit).not.toHaveBeenCalled();
    });

    it('grants for first_paid_booking once the hold-back window has elapsed', async () => {
      const { em } = makeGrantFakeEm({
        referral: makeFakeReferral({ qualifying_event: 'first_paid_booking', grant_holdback_hours: 72 }),
        payment: { status: 'paid', paid_at: OLD_ENOUGH },
      });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.tryGrantReward('referred-1', 'booking-1', 'paid');

      expect(wallet.credit).toHaveBeenCalledTimes(2); // both sides are wallet_credit in the default fixture
    });

    it.each(['refund_pending', 'refunded', 'failed'])(
      'no-ops for first_paid_booking when the triggering payment has since moved to %s',
      async (paymentStatus) => {
        const { em } = makeGrantFakeEm({
          referral: makeFakeReferral({ qualifying_event: 'first_paid_booking', grant_holdback_hours: 72 }),
          payment: { status: paymentStatus, paid_at: OLD_ENOUGH },
        });
        dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

        await service.tryGrantReward('referred-1', 'booking-1', 'paid');

        expect(wallet.credit).not.toHaveBeenCalled();
      },
    );

    it('no-ops for first_paid_booking when the triggering payment cannot be found at all', async () => {
      const { em } = makeGrantFakeEm({
        referral: makeFakeReferral({ qualifying_event: 'first_paid_booking' }),
        payment: null,
      });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.tryGrantReward('referred-1', 'booking-1', 'paid');

      expect(wallet.credit).not.toHaveBeenCalled();
    });

    it('both sides wallet-kind -> grants both, flips status to reward_granted with qualifying_booking_id + reward_granted_at', async () => {
      const { em, rewards, referralUpdates } = makeGrantFakeEm({
        referral: makeFakeReferral({ referrer_reward_kind: 'wallet_credit', referred_reward_kind: 'cashback' }),
      });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));
      wallet.credit
        .mockResolvedValueOnce({ balanceAfter: 20000, transactionId: 'tx-referrer' })
        .mockResolvedValueOnce({ balanceAfter: 15000, transactionId: 'tx-referred' });

      await service.tryGrantReward('referred-1', 'booking-1', 'completed');

      expect(rewards).toHaveLength(2);
      expect(rewards.map((r) => r.beneficiary_role).sort()).toEqual(['referred', 'referrer']);
      expect(rewards.every((r) => r.wallet_transaction_id !== null)).toBe(true);
      const grantUpdate = referralUpdates.find((u) => u.sql.includes("'reward_granted'"));
      expect(grantUpdate).toBeDefined();
      expect(grantUpdate!.params).toEqual(['referral-1', 'booking-1']);
    });

    it('one wallet-kind + one fixed_discount side (Slice 6 -- now supported) -> grants BOTH, status -> reward_granted', async () => {
      const { em, rewards, coupons, referralUpdates } = makeGrantFakeEm({
        referral: makeFakeReferral({
          referrer_reward_kind: 'wallet_credit',
          referred_reward_kind: 'fixed_discount',
          referred_reward_value: '50000',
        }),
      });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.tryGrantReward('referred-1', 'booking-1', 'completed');

      expect(wallet.credit).toHaveBeenCalledTimes(1);
      expect(rewards).toHaveLength(2);
      const referredReward = rewards.find((r) => r.beneficiary_role === 'referred')!;
      expect(referredReward.reward_kind).toBe('fixed_discount');
      expect(referredReward.coupon_id).not.toBeNull();
      expect(referredReward.wallet_transaction_id).toBeNull();
      expect(coupons).toHaveLength(1);
      expect(coupons[0].discount_fixed_amount).toBe(50000);
      expect(coupons[0].discount_percent).toBeNull();
      // Exactly one referrals UPDATE fired -- the reward_granted one (its own WHERE
      // clause textually contains "...'partially_granted')" as part of the source
      // status IN-list, so asserting on substring absence would be a false positive;
      // asserting the update count instead is the reliable check).
      const grantUpdate = referralUpdates.find((u) => u.sql.includes("SET status = 'reward_granted'"));
      expect(grantUpdate).toBeDefined();
      expect(referralUpdates).toHaveLength(1);
    });

    it('both sides fixed_discount (Slice 6 -- now supported) -> grants both as coupons, status -> reward_granted', async () => {
      const { em, rewards, coupons, referralUpdates } = makeGrantFakeEm({
        referral: makeFakeReferral({
          referrer_reward_kind: 'fixed_discount',
          referrer_reward_value: '30000',
          referred_reward_kind: 'fixed_discount',
          referred_reward_value: '20000',
        }),
      });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.tryGrantReward('referred-1', 'booking-1', 'completed');

      expect(wallet.credit).not.toHaveBeenCalled();
      expect(rewards).toHaveLength(2);
      expect(rewards.every((r) => r.coupon_id !== null)).toBe(true);
      expect(rewards.every((r) => r.wallet_transaction_id === null)).toBe(true);
      expect(coupons).toHaveLength(2);
      expect(coupons.every((c) => c.discount_percent === null)).toBe(true);
      expect(coupons.map((c) => c.discount_fixed_amount).sort()).toEqual([20000, 30000]);
      const grantUpdate = referralUpdates.find((u) => u.sql.includes("'reward_granted'"));
      expect(grantUpdate).toBeDefined();
    });

    it('fixed_discount coupon: reward_max caps the fixed amount and rounds a fractional resolved value, salon_id copied from the referral row', async () => {
      const { em, coupons, rewards } = makeGrantFakeEm({
        referral: makeFakeReferral({
          salon_id: 'salon-owner-1',
          referrer_reward_kind: 'fixed_discount',
          referrer_reward_value: '75000.6',
          referrer_reward_max: '60000',
          referred_reward_kind: 'wallet_credit',
        }),
      });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.tryGrantReward('referred-1', 'booking-1', 'completed');

      expect(coupons[0].salon_id).toBe('salon-owner-1');
      expect(coupons[0].discount_fixed_amount).toBe(60000); // capped at reward_max, not the raw 75000.6
      expect(coupons[0].discount_percent).toBeNull();
      expect(rewards.find((r) => r.beneficiary_role === 'referrer')!.reward_value).toBe('60000');
    });

    it('both sides percent_discount (Slice 5 -- now supported) -> grants both as coupons, status -> reward_granted', async () => {
      const { em, rewards, coupons, referralUpdates } = makeGrantFakeEm({
        referral: makeFakeReferral({
          referrer_reward_kind: 'percent_discount',
          referrer_reward_value: '12',
          referred_reward_kind: 'percent_discount',
          referred_reward_value: '10',
        }),
      });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.tryGrantReward('referred-1', 'booking-1', 'completed');

      expect(wallet.credit).not.toHaveBeenCalled();
      expect(rewards).toHaveLength(2);
      expect(rewards.every((r) => r.coupon_id !== null)).toBe(true);
      expect(rewards.every((r) => r.wallet_transaction_id === null)).toBe(true);
      expect(coupons).toHaveLength(2);
      expect(coupons.every((c) => c.code.startsWith('REF-'))).toBe(true);
      expect(coupons.map((c) => c.issued_to_user_id).sort()).toEqual(['referred-1', 'referrer-1']);
      const grantUpdate = referralUpdates.find((u) => u.sql.includes("'reward_granted'"));
      expect(grantUpdate).toBeDefined();
    });

    it('percent_discount coupon: salon_id is copied directly from the referral row (not re-derived), and rounds a fractional resolved percent', async () => {
      const { em, rewards, coupons } = makeGrantFakeEm({
        referral: makeFakeReferral({
          salon_id: 'salon-owner-1',
          referrer_reward_kind: 'percent_discount',
          referrer_reward_value: '12.6',
          referred_reward_kind: 'wallet_credit',
        }),
      });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.tryGrantReward('referred-1', 'booking-1', 'completed');

      expect(coupons[0].salon_id).toBe('salon-owner-1');
      expect(coupons[0].discount_percent).toBe(13); // Math.round(12.6)
      expect(rewards.find((r) => r.beneficiary_role === 'referrer')!.reward_value).toBe('13');
    });

    it('percent_discount coupon: reward_max caps the discount percent, mirroring the wallet-kind cap', async () => {
      const { em, coupons } = makeGrantFakeEm({
        referral: makeFakeReferral({
          referrer_reward_kind: 'percent_discount',
          referrer_reward_value: '30',
          referrer_reward_max: '15',
          referred_reward_kind: 'wallet_credit',
        }),
      });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.tryGrantReward('referred-1', 'booking-1', 'completed');

      expect(coupons[0].discount_percent).toBe(15);
    });

    it('re-calling on an already reward_granted referral is a true no-op (no duplicate wallet_transactions)', async () => {
      const { em } = makeGrantFakeEm({ referral: makeFakeReferral({ status: 'reward_granted' }) });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.tryGrantReward('referred-1', 'booking-1', 'completed');

      expect(wallet.credit).not.toHaveBeenCalled();
    });

    it('re-calling on a partially_granted referral (e.g. left over from before Slice 6 shipped) only attempts the still-unresolved side', async () => {
      const existingReferrerReward: FakeRewardRow = {
        id: 'reward-existing',
        referral_id: 'referral-1',
        beneficiary_user_id: 'referrer-1',
        beneficiary_role: 'referrer',
        reward_kind: 'wallet_credit',
        reward_value: '20000',
        wallet_transaction_id: 'tx-existing',
        coupon_id: null,
        status: 'granted',
      };
      const { em, rewards, coupons } = makeGrantFakeEm({
        referral: makeFakeReferral({
          status: 'partially_granted',
          referrer_reward_kind: 'wallet_credit',
          referred_reward_kind: 'fixed_discount', // NOW supported (Slice 6)
          referred_reward_value: '40000',
        }),
        existingRewards: [existingReferrerReward],
      });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.tryGrantReward('referred-1', 'booking-1', 'completed');

      // Referrer side already had a row -- skipped (idempotent), no new wallet credit.
      // Referred side is now grantable (fixed_discount is supported as of this
      // slice) -- a coupon gets issued for it.
      expect(wallet.credit).not.toHaveBeenCalled();
      expect(rewards).toHaveLength(2);
      expect(coupons).toHaveLength(1);
      expect(coupons[0].discount_fixed_amount).toBe(40000);
    });

    it('re-calling on a partially_granted referral grants a NOW-supported percent_discount side (Slice 5)', async () => {
      const existingReferrerReward: FakeRewardRow = {
        id: 'reward-existing',
        referral_id: 'referral-1',
        beneficiary_user_id: 'referrer-1',
        beneficiary_role: 'referrer',
        reward_kind: 'wallet_credit',
        reward_value: '20000',
        wallet_transaction_id: 'tx-existing',
        coupon_id: null,
        status: 'granted',
      };
      const { em, rewards, coupons, referralUpdates } = makeGrantFakeEm({
        referral: makeFakeReferral({
          status: 'partially_granted',
          referrer_reward_kind: 'wallet_credit',
          referred_reward_kind: 'percent_discount',
          referred_reward_value: '10',
        }),
        existingRewards: [existingReferrerReward],
      });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.tryGrantReward('referred-1', 'booking-1', 'completed');

      expect(wallet.credit).not.toHaveBeenCalled(); // referrer side already granted, skipped
      expect(rewards).toHaveLength(2);
      expect(coupons).toHaveLength(1);
      const grantUpdate = referralUpdates.find((u) => u.sql.includes("'reward_granted'"));
      expect(grantUpdate).toBeDefined(); // now BOTH sides have a row -- completes to reward_granted
    });

    it('caps the credited amount at reward_max when the resolved value would exceed it', async () => {
      const { em } = makeGrantFakeEm({
        referral: makeFakeReferral({
          referrer_reward_kind: 'wallet_credit',
          referrer_reward_value: '100000',
          referrer_reward_max: '20000',
          referred_reward_kind: 'cashback',
          referred_reward_value: '5000',
          referred_reward_max: null,
        }),
      });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.tryGrantReward('referred-1', 'booking-1', 'completed');

      // First credit() call is the referrer side -- capped at reward_max (20000), not
      // the raw reward_value (100000).
      expect(wallet.credit).toHaveBeenNthCalledWith(1, em, 'referrer-1', 'toman', 20000, 'referral_reward', expect.any(Object));
    });

    it('routes loyalty_points to the points currency, everything else to toman', async () => {
      const { em } = makeGrantFakeEm({
        referral: makeFakeReferral({ referrer_reward_kind: 'loyalty_points', referred_reward_kind: 'wallet_credit' }),
      });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.tryGrantReward('referred-1', 'booking-1', 'completed');

      expect(wallet.credit).toHaveBeenNthCalledWith(1, em, 'referrer-1', 'points', 20000, 'referral_reward', expect.any(Object));
      expect(wallet.credit).toHaveBeenNthCalledWith(2, em, 'referred-1', 'toman', 15000, 'referral_reward', expect.any(Object));
    });

    it('logs and pages AlertsService (critical) instead of throwing when the transaction itself blows up', async () => {
      dataSource.transaction.mockRejectedValue(new Error('db exploded'));

      await expect(service.tryGrantReward('referred-1', 'booking-1', 'completed')).resolves.toBeUndefined();

      expect(alerts.raise).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'critical', key: expect.stringContaining('referral-grant-failed') }),
      );
    });
  });

  describe('reverseIfNeeded', () => {
    it('is a safe no-op when no referral is linked to this booking', async () => {
      const { em } = makeReverseFakeEm({ referralIds: [], rewards: [] });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.reverseIfNeeded('booking-1');

      expect(wallet.debit).not.toHaveBeenCalled();
    });

    it('is a safe no-op when the referral has no linked referral_rewards rows', async () => {
      const { em } = makeReverseFakeEm({ referralIds: ['referral-1'], rewards: [] });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.reverseIfNeeded('booking-1');

      expect(wallet.debit).not.toHaveBeenCalled();
    });

    it('fully reverses a wallet-kind grant: debits the wallet and marks the reward reversed', async () => {
      const reward: FakeRewardRow = {
        id: 'reward-1',
        referral_id: 'referral-1',
        beneficiary_user_id: 'referrer-1',
        beneficiary_role: 'referrer',
        reward_kind: 'wallet_credit',
        reward_value: '20000',
        wallet_transaction_id: 'tx-1',
        coupon_id: null,
        status: 'granted',
      };
      const { em, rewards } = makeReverseFakeEm({ referralIds: ['referral-1'], rewards: [reward] });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));
      wallet.debit.mockResolvedValue({ debited: 20000, shortfall: 0, balanceAfter: 0 });

      await service.reverseIfNeeded('booking-1');

      expect(wallet.debit).toHaveBeenCalledWith(em, 'referrer-1', 'toman', 20000, 'referral_reversal', expect.any(Object));
      expect(rewards[0].status).toBe('reversed');
      expect(alerts.raise).not.toHaveBeenCalled(); // no shortfall -- not alert-worthy
    });

    it('records a shortfall and pages a critical alert when the debit is capped short of the full reward', async () => {
      const reward: FakeRewardRow = {
        id: 'reward-2',
        referral_id: 'referral-1',
        beneficiary_user_id: 'referrer-1',
        beneficiary_role: 'referrer',
        reward_kind: 'wallet_credit',
        reward_value: '20000',
        wallet_transaction_id: 'tx-2',
        coupon_id: null,
        status: 'granted',
      };
      const { em } = makeReverseFakeEm({ referralIds: ['referral-1'], rewards: [reward] });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));
      wallet.debit.mockResolvedValue({ debited: 5000, shortfall: 15000, balanceAfter: 0 });

      await service.reverseIfNeeded('booking-1');

      expect(alerts.raise).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'critical', key: 'referral-reward-shortfall:reward-2' }),
      );
    });

    it('is idempotent -- a second call for the same booking does not double-debit', async () => {
      const reward: FakeRewardRow = {
        id: 'reward-3',
        referral_id: 'referral-1',
        beneficiary_user_id: 'referrer-1',
        beneficiary_role: 'referrer',
        reward_kind: 'wallet_credit',
        reward_value: '20000',
        wallet_transaction_id: 'tx-3',
        coupon_id: null,
        status: 'granted',
      };
      const { em } = makeReverseFakeEm({ referralIds: ['referral-1'], rewards: [reward] });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));
      wallet.debit.mockResolvedValue({ debited: 20000, shortfall: 0, balanceAfter: 0 });

      await service.reverseIfNeeded('booking-1');
      await service.reverseIfNeeded('booking-1'); // second call -- reward is now status='reversed' in the fake store

      expect(wallet.debit).toHaveBeenCalledTimes(1);
    });

    it('leaves an already-redeemed discount coupon un-reversed and does not alert-page it', async () => {
      const reward: FakeRewardRow = {
        id: 'reward-4',
        referral_id: 'referral-1',
        beneficiary_user_id: 'referred-1',
        beneficiary_role: 'referred',
        reward_kind: 'percent_discount',
        reward_value: '10',
        wallet_transaction_id: null,
        coupon_id: 'coupon-1',
        status: 'granted',
      };
      const { em, rewards } = makeReverseFakeEm({ referralIds: ['referral-1'], rewards: [reward] });
      // Override: this coupon has a redemption on file.
      (em.query as jest.Mock).mockImplementation(async (sql: string, params: unknown[] = []) => {
        if (sql.includes('FROM referrals WHERE qualifying_booking_id')) return [{ id: 'referral-1' }];
        if (sql.includes('FROM referral_rewards WHERE referral_id')) return [reward];
        if (sql.includes('coupon_redemptions')) return [{ exists: true }];
        if (sql.includes('UPDATE referral_rewards SET reversal_reason')) {
          const [id, reason] = params as [string, string];
          const r = rewards.find((row) => row.id === id);
          if (r) r.reversal_reason = reason;
          return [];
        }
        throw new Error(`unexpected: ${sql}, ${JSON.stringify(params)}`);
      });
      dataSource.transaction.mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));

      await service.reverseIfNeeded('booking-1');

      expect(wallet.debit).not.toHaveBeenCalled();
      expect(rewards[0].status).toBe('granted'); // left untouched -- not reversible
      // Piece 1e's honest, queryable marker: reversal_reason set WITHOUT status/reversed_at.
      expect(rewards[0].reversal_reason).toBe('غیرقابل بازگشت -- کد از قبل استفاده شده');
      expect(alerts.raise).not.toHaveBeenCalled(); // expected/bounded behavior, not an incident
    });

    it('logs and pages AlertsService (critical) instead of throwing when the transaction itself blows up', async () => {
      dataSource.transaction.mockRejectedValue(new Error('db exploded'));

      await expect(service.reverseIfNeeded('booking-1')).resolves.toBeUndefined();

      expect(alerts.raise).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'critical', key: expect.stringContaining('referral-reversal-failed') }),
      );
    });
  });

  describe('getMyRewards', () => {
    it('paginates the caller\'s own referral_rewards rows, newest first', async () => {
      const getRawMany = jest.fn().mockResolvedValue([
        {
          id: 'reward-1',
          referralId: 'referral-1',
          beneficiaryRole: 'referrer',
          rewardKind: 'wallet_credit',
          rewardValue: '20000',
          status: 'granted',
          grantedAt: new Date('2026-01-01'),
          walletTransactionId: 'tx-1',
          couponId: null,
          currency: 'toman',
          couponCode: null,
        },
      ]);
      const qb = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany,
      };
      referralRewardsRepo.createQueryBuilder.mockReturnValue(qb);
      referralRewardsRepo.count.mockResolvedValue(1);

      const result = await service.getMyRewards('user-1', 1, 20);

      expect(qb.where).toHaveBeenCalledWith('reward.beneficiaryUserId = :userId', { userId: 'user-1' });
      expect(result.total).toBe(1);
      expect(result.items[0]).toEqual({
        id: 'reward-1',
        referralId: 'referral-1',
        beneficiaryRole: 'referrer',
        rewardKind: 'wallet_credit',
        rewardValue: 20000,
        status: 'granted',
        grantedAt: new Date('2026-01-01'),
        walletTransactionId: 'tx-1',
        couponId: null,
        currency: 'toman',
        couponCode: null,
      });
    });
  });

  describe('listForAdmin (Piece 3 -- projects reward-term columns onto each row)', () => {
    it('projects referrer/referred rewardKind/Value/Max, already columns on `referrals`', async () => {
      const chain = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            id: 'referral-1',
            referralType: 'user',
            status: 'reward_granted',
            referrerUserId: 'referrer-1',
            referrerPhone: '09120000001',
            referredUserId: 'referred-1',
            referredUserPhone: '09120000002',
            salonId: null,
            qualifyingEvent: 'first_completed_booking',
            expiresAt: null,
            rewardGrantedAt: new Date('2026-01-01'),
            cancelledReason: null,
            createdAt: new Date('2026-01-01'),
            referrerRewardKind: 'wallet_credit',
            referrerRewardValue: '20000',
            referrerRewardMax: null,
            referredRewardKind: 'percent_discount',
            referredRewardValue: '15',
            referredRewardMax: '10',
          },
        ]),
        getCount: jest.fn().mockResolvedValue(1),
      };
      referralsRepo.createQueryBuilder.mockReturnValue(chain);

      const result = await service.listForAdmin({}, 1, 20);

      expect(result.items[0]).toMatchObject({
        referrerRewardKind: 'wallet_credit',
        referrerRewardValue: 20000,
        referrerRewardMax: null,
        referredRewardKind: 'percent_discount',
        referredRewardValue: 15,
        referredRewardMax: 10,
      });
    });
  });

  describe('getRewardsForAdmin (Piece 3 -- new admin endpoint)', () => {
    it('404s when the referral does not exist at all', async () => {
      referralsRepo.findOneBy.mockResolvedValue(null);

      await expect(service.getRewardsForAdmin('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns both beneficiary sides, resolving the coupon code/isActive via a join, not the bare id', async () => {
      referralsRepo.findOneBy.mockResolvedValue({ id: 'referral-1' });
      const qb = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            id: 'reward-1',
            beneficiaryRole: 'referrer',
            beneficiaryUserId: 'referrer-1',
            rewardKind: 'wallet_credit',
            rewardValue: '20000',
            status: 'granted',
            grantedAt: new Date('2026-01-01'),
            reversedAt: null,
            reversalReason: null,
            reversalShortfallAmount: null,
            walletTransactionId: 'tx-1',
            couponId: null,
            couponCode: null,
            couponIsActive: null,
          },
          {
            id: 'reward-2',
            beneficiaryRole: 'referred',
            beneficiaryUserId: 'referred-1',
            rewardKind: 'percent_discount',
            rewardValue: '10',
            status: 'granted',
            grantedAt: new Date('2026-01-01'),
            reversedAt: null,
            reversalReason: null,
            reversalShortfallAmount: null,
            walletTransactionId: null,
            couponId: 'coupon-1',
            couponCode: 'REF-ABC12345',
            couponIsActive: true,
          },
        ]),
      };
      referralRewardsRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getRewardsForAdmin('referral-1');

      expect(qb.where).toHaveBeenCalledWith('reward.referralId = :referralId', { referralId: 'referral-1' });
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ beneficiaryRole: 'referrer', walletTransactionId: 'tx-1', couponId: null });
      expect(result[1]).toMatchObject({
        beneficiaryRole: 'referred',
        rewardValue: 10,
        couponId: 'coupon-1',
        couponCode: 'REF-ABC12345',
        couponIsActive: true,
      });
    });
  });
});
