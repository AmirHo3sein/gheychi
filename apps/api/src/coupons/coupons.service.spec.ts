import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CouponRedemption } from './coupon-redemption.entity';
import { Coupon } from './coupon.entity';
import { CouponsService } from './coupons.service';

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

describe('CouponsService.resolveAndValidate', () => {
  let couponsRepo: { findOneBy: jest.Mock };
  let redemptionsRepo: { findOneBy: jest.Mock; count: jest.Mock };
  let service: CouponsService;

  beforeEach(() => {
    couponsRepo = { findOneBy: jest.fn() };
    redemptionsRepo = { findOneBy: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) };
    service = new CouponsService(couponsRepo as never, redemptionsRepo as never);
  });

  it('rejects a code that does not exist', async () => {
    couponsRepo.findOneBy.mockResolvedValue(null);
    await expect(service.resolveAndValidate('NOPE', 'salon-1', 'user-1')).rejects.toThrow(BadRequestException);
    await expect(service.resolveAndValidate('NOPE', 'salon-1', 'user-1')).rejects.toThrow('کد تخفیف نامعتبر است');
  });

  it('rejects an inactive coupon with the same generic message', async () => {
    couponsRepo.findOneBy.mockResolvedValue(makeCoupon({ isActive: false }));
    await expect(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1')).rejects.toThrow('کد تخفیف نامعتبر است');
  });

  it('rejects a salon-scoped code when used against a different salon, without leaking that it exists', async () => {
    couponsRepo.findOneBy.mockResolvedValue(makeCoupon({ salonId: 'salon-owner' }));
    await expect(service.resolveAndValidate('SUMMER20', 'salon-other', 'user-1')).rejects.toThrow(
      'کد تخفیف نامعتبر است',
    );
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
    });

    it('row-locks the coupon and accepts when still below the cap', async () => {
      const coupon = makeCoupon({ maxRedemptions: 2 });
      const { em } = makeEm(coupon, 1);
      await expect(service.resolveAndValidate('SUMMER20', 'salon-1', 'user-1', em)).resolves.toBe(coupon);
    });
  });
});
