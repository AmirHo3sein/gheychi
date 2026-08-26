import { BadRequestException, ConflictException } from '@nestjs/common';
import { EntityManager, QueryFailedError } from 'typeorm';
import { UNIQUE_VIOLATION } from '../common/postgres-error-codes';
import { MetricsService } from '../metrics/metrics.service';
import {
  COUPON_ALREADY_REDEEMED,
  COUPON_EXPIRED,
  COUPON_FEATURE_DISABLED,
  COUPON_INVALID,
  COUPON_LIMIT_REACHED,
} from './coupon-error-codes';
import { CouponRedemption } from './coupon-redemption.entity';
import { Coupon } from './coupon.entity';
import { CouponsService } from './coupons.service';

// Every coupon-validation rejection is a BadRequestException whose response body now
// carries a stable `code` alongside the existing Persian `message` (see
// coupon-error-codes.ts) -- this reads that `code` back off the rejected promise so
// each test below can assert on it without duplicating the whole rejection setup.
async function rejectionCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    return (err as { response?: { code?: string } }).response?.code;
  }
  throw new Error('expected promise to reject');
}

function makeCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'coupon-1',
    code: 'SUMMER20',
    salonId: null,
    discountPercent: 20,
    discountFixedAmount: null,
    expiresAt: null,
    maxRedemptions: null,
    isActive: true,
    issuedToUserId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('CouponsService create', () => {
  let couponsRepo: { create: jest.Mock; save: jest.Mock };
  let service: CouponsService;

  beforeEach(() => {
    couponsRepo = {
      create: jest.fn((data: Partial<Coupon>) => data),
      save: jest.fn((data: Partial<Coupon>) => Promise.resolve(makeCoupon(data))),
    };
    service = new CouponsService(couponsRepo as never, {} as never, new MetricsService(), {
      getFeatureFlags: jest.fn().mockResolvedValue({ couponsEnabled: true }),
    } as never);
  });

  // The create and list contracts must agree: the admin/provider coupon screens append the
  // created row straight into the list they already hold, so a missing redeemedCount rendered
  // as an empty usage cell -- "not used yet" indistinguishable from "data missing".
  it('returns redeemedCount 0 on a platform-wide create, matching the list shape', async () => {
    const created = await service.createPlatformWide({ code: 'summer20', discountPercent: 20 });
    expect(created.redeemedCount).toBe(0);
    expect(created.code).toBe('SUMMER20');
    expect(created.salonId).toBeNull();
  });

  it('returns redeemedCount 0 on a salon-scoped create too', async () => {
    const created = await service.createForSalon('salon-1', { code: 'VIP10', discountPercent: 10 });
    expect(created.redeemedCount).toBe(0);
    expect(created.salonId).toBe('salon-1');
  });

  it('still translates a duplicate code into a 409 rather than returning a row', async () => {
    const err = new QueryFailedError('query', [], new Error('duplicate key'));
    (err as unknown as { code: string }).code = UNIQUE_VIOLATION;
    couponsRepo.save.mockRejectedValueOnce(err);
    await expect(service.createPlatformWide({ code: 'SUMMER20', discountPercent: 20 })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('CouponsService.resolveAndValidate', () => {
  let couponsRepo: { findOneBy: jest.Mock };
  let redemptionsRepo: { findOneBy: jest.Mock; count: jest.Mock };
  let metrics: MetricsService;
  let platformConfig: { getFeatureFlags: jest.Mock };
  let service: CouponsService;

  beforeEach(() => {
    couponsRepo = { findOneBy: jest.fn() };
    redemptionsRepo = { findOneBy: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) };
    metrics = new MetricsService();
    platformConfig = { getFeatureFlags: jest.fn().mockResolvedValue({ couponsEnabled: true }) };
    service = new CouponsService(couponsRepo as never, redemptionsRepo as never, metrics, platformConfig as never);
  });

  it('rejects with a distinct code when feature_coupons_enabled is off, before touching the coupon repo', async () => {
    platformConfig.getFeatureFlags.mockResolvedValue({ couponsEnabled: false });

    await expect(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1')).rejects.toThrow(
      'کدهای تخفیف موقتاً غیرفعال است',
    );
    expect(await rejectionCode(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1'))).toBe(
      COUPON_FEATURE_DISABLED,
    );
    expect(couponsRepo.findOneBy).not.toHaveBeenCalled();
  });

  // A few of the domain counters wired into this exact call site (see coupons.service.ts's
  // resolveAndValidate wrapper) -- verifies they actually move on real success/rejection
  // paths, not just that resolveAndValidate itself resolves/rejects (already covered by
  // every other test in this describe block).
  describe('coupon_validation_attempts_total / coupon_redemptions_total / coupon_rejections_total', () => {
    async function metricValue(name: string, labels?: Record<string, string>): Promise<number | undefined> {
      const metric = await metrics.registry.getSingleMetric(name)?.get();
      const sample = metric?.values.find((v) =>
        labels ? Object.entries(labels).every(([k, val]) => v.labels[k] === val) : true,
      );
      return sample?.value;
    }

    it('counts an attempt and a redemption on a successful validation', async () => {
      const coupon = makeCoupon();
      couponsRepo.findOneBy.mockResolvedValue(coupon);
      await service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1');

      expect(await metricValue('coupon_validation_attempts_total')).toBe(1);
      expect(await metricValue('coupon_redemptions_total')).toBe(1);
      expect(await metricValue('coupon_rejections_total')).toBeUndefined();
    });

    it('counts an attempt and a rejection (labeled with the bounded error code) on an invalid code', async () => {
      couponsRepo.findOneBy.mockResolvedValue(null);
      await expect(service.resolveAndValidate('NOPE', 'salon-1', 'user-1')).rejects.toThrow(BadRequestException);

      expect(await metricValue('coupon_validation_attempts_total')).toBe(1);
      // coupon_redemptions_total has no labels, so prom-client pre-populates it with a
      // single zero-value sample the moment it's registered -- 0, not "no sample at
      // all", is the correct "never incremented" reading here.
      expect(await metricValue('coupon_redemptions_total')).toBe(0);
      expect(await metricValue('coupon_rejections_total', { reason: COUPON_INVALID })).toBe(1);
    });
  });

  it('rejects a code that does not exist', async () => {
    couponsRepo.findOneBy.mockResolvedValue(null);
    await expect(service.resolveAndValidate('NOPE', 'salon-1', 'user-1')).rejects.toThrow(BadRequestException);
    await expect(service.resolveAndValidate('NOPE', 'salon-1', 'user-1')).rejects.toThrow('کد تخفیف نامعتبر است');
    expect(await rejectionCode(service.resolveAndValidate('NOPE', 'salon-1', 'user-1'))).toBe(COUPON_INVALID);
  });

  it('rejects an inactive coupon with the same generic message', async () => {
    couponsRepo.findOneBy.mockResolvedValue(makeCoupon({ isActive: false }));
    await expect(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1')).rejects.toThrow('کد تخفیف نامعتبر است');
    expect(await rejectionCode(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1'))).toBe(COUPON_INVALID);
  });

  it('rejects a salon-scoped code when used against a different salon, without leaking that it exists', async () => {
    couponsRepo.findOneBy.mockResolvedValue(makeCoupon({ salonId: 'salon-owner' }));
    await expect(service.resolveAndValidate('SUMMER20', 'salon-other', 'user-1')).rejects.toThrow(
      'کد تخفیف نامعتبر است',
    );
    expect(await rejectionCode(service.resolveAndValidate('SUMMER20', 'salon-other', 'user-1'))).toBe(COUPON_INVALID);
  });

  it('accepts a salon-scoped code when used against its own salon', async () => {
    const coupon = makeCoupon({ salonId: 'salon-owner' });
    couponsRepo.findOneBy.mockResolvedValue(coupon);
    await expect(service.resolveAndValidate('SUMMER20', 'salon-owner', 'user-1')).resolves.toBe(coupon);
  });

  it('accepts a platform-wide code (salonId null) regardless of which salon is booked', async () => {
    const coupon = makeCoupon({ salonId: null });
    couponsRepo.findOneBy.mockResolvedValue(coupon);
    await expect(service.resolveAndValidate('SUMMER20', 'salon-a', 'user-1')).resolves.toBe(coupon);
    await expect(service.resolveAndValidate('SUMMER20', 'salon-b', 'user-1')).resolves.toBe(coupon);
  });

  it('rejects an expired coupon', async () => {
    couponsRepo.findOneBy.mockResolvedValue(makeCoupon({ expiresAt: new Date(Date.now() - 60_000) }));
    await expect(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1')).rejects.toThrow(
      'کد تخفیف منقضی شده است',
    );
    expect(await rejectionCode(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1'))).toBe(COUPON_EXPIRED);
  });

  it('accepts a coupon whose expiry is still in the future', async () => {
    const coupon = makeCoupon({ expiresAt: new Date(Date.now() + 60_000) });
    couponsRepo.findOneBy.mockResolvedValue(coupon);
    await expect(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1')).resolves.toBe(coupon);
  });

  it('rejects a code the same user has already redeemed', async () => {
    couponsRepo.findOneBy.mockResolvedValue(makeCoupon());
    redemptionsRepo.findOneBy.mockResolvedValue({ id: 'redemption-1' } as CouponRedemption);
    await expect(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1')).rejects.toThrow(
      'شما قبلا از این کد تخفیف استفاده کرده‌اید',
    );
    expect(await rejectionCode(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1'))).toBe(
      COUPON_ALREADY_REDEEMED,
    );
  });

  describe('issued_to_user_id restriction (Slice 5 -- referral-issued coupons)', () => {
    it('accepts a coupon with issuedToUserId=null (every ordinary, non-referral coupon) for any user', async () => {
      const coupon = makeCoupon({ issuedToUserId: null });
      couponsRepo.findOneBy.mockResolvedValue(coupon);
      await expect(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1')).resolves.toBe(coupon);
      await expect(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-2')).resolves.toBe(coupon);
    });

    it('accepts a referral-issued coupon when used by its intended recipient', async () => {
      const coupon = makeCoupon({ issuedToUserId: 'user-1' });
      couponsRepo.findOneBy.mockResolvedValue(coupon);
      await expect(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1')).resolves.toBe(coupon);
    });

    it('rejects a referral-issued coupon used by a different user, with the same generic message', async () => {
      const coupon = makeCoupon({ issuedToUserId: 'user-1' });
      couponsRepo.findOneBy.mockResolvedValue(coupon);
      await expect(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-2')).rejects.toThrow(
        'کد تخفیف نامعتبر است',
      );
      expect(await rejectionCode(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-2'))).toBe(COUPON_INVALID);
    });
  });

  it('normalizes the code (trim + uppercase) before lookup', async () => {
    const coupon = makeCoupon();
    couponsRepo.findOneBy.mockResolvedValue(coupon);
    await service.resolveAndValidate('  summer20 ', 'salon-1', 'user-1');
    expect(couponsRepo.findOneBy).toHaveBeenCalledWith({ code: 'SUMMER20' });
  });

  describe('maxRedemptions cap (no EntityManager -- read-only preview)', () => {
    it('rejects once the cap is reached', async () => {
      couponsRepo.findOneBy.mockResolvedValue(makeCoupon({ maxRedemptions: 2 }));
      redemptionsRepo.count.mockResolvedValue(2);
      await expect(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1')).rejects.toThrow(
        'ظرفیت استفاده از این کد تخفیف تکمیل شده است',
      );
      expect(await rejectionCode(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1'))).toBe(
        COUPON_LIMIT_REACHED,
      );
    });

    it('accepts when redemptions are still below the cap', async () => {
      const coupon = makeCoupon({ maxRedemptions: 2 });
      couponsRepo.findOneBy.mockResolvedValue(coupon);
      redemptionsRepo.count.mockResolvedValue(1);
      await expect(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1')).resolves.toBe(coupon);
    });
  });

  describe('maxRedemptions cap (with EntityManager -- the real, row-locked booking path)', () => {
    function makeEm(coupon: Coupon, redeemedCount: number): { em: EntityManager; qb: { setLock: jest.Mock } } {
      const qb = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(coupon),
      };
      const couponRepoInEm = {
        findOneBy: jest.fn().mockResolvedValue(coupon),
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
      const redemptionRepoInEm = {
        findOneBy: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(redeemedCount),
      };
      const em = {
        getRepository: jest.fn((entity: unknown) => (entity === Coupon ? couponRepoInEm : redemptionRepoInEm)),
      } as unknown as EntityManager;
      return { em, qb };
    }

    it('row-locks the coupon and rejects once the cap is reached', async () => {
      const coupon = makeCoupon({ maxRedemptions: 1 });
      const { em, qb } = makeEm(coupon, 1);
      await expect(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1', em)).rejects.toThrow(
        'ظرفیت استفاده از این کد تخفیف تکمیل شده است',
      );
      expect(qb.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(await rejectionCode(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1', makeEm(coupon, 1).em))).toBe(
        COUPON_LIMIT_REACHED,
      );
    });

    it('row-locks the coupon and accepts when still below the cap', async () => {
      const coupon = makeCoupon({ maxRedemptions: 2 });
      const { em } = makeEm(coupon, 1);
      await expect(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1', em)).resolves.toBe(coupon);
    });
  });
});
