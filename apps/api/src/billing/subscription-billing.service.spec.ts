import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionBillingPeriod } from './subscription-billing-period.entity';
import { SubscriptionBillingService } from './subscription-billing.service';
import { SubscriptionCouponRedemption } from './subscription-coupon-redemption.entity';
import { SubscriptionCoupon } from './subscription-coupon.entity';

describe('SubscriptionBillingService', () => {
  let service: SubscriptionBillingService;
  let periodsRepo: { find: jest.Mock };
  let subscriptions: { getForSalon: jest.Mock };
  let couponRepoInTx: { findOneBy: jest.Mock; createQueryBuilder: jest.Mock };
  let redemptionRepoInTx: { findOneBy: jest.Mock; count: jest.Mock; save: jest.Mock; create: jest.Mock; delete: jest.Mock };
  let periodsRepoInTx: { save: jest.Mock; create: jest.Mock; findOneBy: jest.Mock; update: jest.Mock };
  let transactionMock: jest.Mock;

  beforeEach(async () => {
    periodsRepo = { find: jest.fn().mockResolvedValue([]) };
    subscriptions = {
      getForSalon: jest.fn().mockResolvedValue({ subscription: { status: 'active' }, plan: { id: 'plan-1', monthlyPriceToman: 500_000 } }),
    };
    couponRepoInTx = {
      findOneBy: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(() => ({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(undefined),
      })),
    };
    redemptionRepoInTx = {
      findOneBy: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve({ id: 'redemption-1', ...v })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    periodsRepoInTx = {
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve({ id: 'period-1', ...v })),
      findOneBy: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const emRepos = new Map<unknown, unknown>([
      [SubscriptionCoupon, couponRepoInTx],
      [SubscriptionCouponRedemption, redemptionRepoInTx],
      [SubscriptionBillingPeriod, periodsRepoInTx],
    ]);
    transactionMock = jest.fn((cb: (em: unknown) => unknown) => cb({ getRepository: (entity: unknown) => emRepos.get(entity) }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        SubscriptionBillingService,
        { provide: DataSource, useValue: { transaction: transactionMock } },
        { provide: getRepositoryToken(SubscriptionBillingPeriod), useValue: periodsRepo },
        { provide: SubscriptionsService, useValue: subscriptions },
      ],
    }).compile();
    service = moduleRef.get(SubscriptionBillingService);
  });

  describe('createPeriod', () => {
    const dto = { periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-09-01T00:00:00.000Z' };

    it('rejects a period whose end is not after its start', async () => {
      await expect(
        service.createPeriod('salon-1', { periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-08-01T00:00:00.000Z' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to bill a canceled subscription -- the nominal plan is no longer in force', async () => {
      subscriptions.getForSalon.mockResolvedValue({ subscription: { status: 'canceled' }, plan: { id: 'plan-1', monthlyPriceToman: 500_000 } });
      await expect(service.createPeriod('salon-1', dto)).rejects.toBeInstanceOf(ConflictException);
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it('bills the plan price verbatim with no coupon', async () => {
      const period = await service.createPeriod('salon-1', dto);
      expect(periodsRepoInTx.save).toHaveBeenCalledWith(
        expect.objectContaining({ salonId: 'salon-1', planId: 'plan-1', baseAmountToman: 500_000, amountToman: 500_000, couponId: null }),
      );
      expect(period).toMatchObject({ amountToman: 500_000 });
    });

    it('applies a valid coupon and records the redemption', async () => {
      couponRepoInTx.findOneBy.mockResolvedValueOnce({ id: 'coupon-1', code: 'PLUS20', discountPercent: 20, isActive: true, expiresAt: null, maxRedemptions: null });

      await service.createPeriod('salon-1', { ...dto, couponCode: 'plus20' });

      expect(periodsRepoInTx.save).toHaveBeenCalledWith(
        expect.objectContaining({ baseAmountToman: 500_000, discountPercent: 20, amountToman: 400_000, couponId: 'coupon-1' }),
      );
      expect(redemptionRepoInTx.save).toHaveBeenCalledWith(
        expect.objectContaining({ couponId: 'coupon-1', salonId: 'salon-1', billingPeriodId: 'period-1' }),
      );
    });

    it('rejects an unknown or inactive coupon code', async () => {
      couponRepoInTx.findOneBy.mockResolvedValueOnce(null);
      await expect(service.createPeriod('salon-1', { ...dto, couponCode: 'NOPE' })).rejects.toBeInstanceOf(BadRequestException);
      expect(periodsRepoInTx.save).not.toHaveBeenCalled();
    });

    it('rejects an expired coupon', async () => {
      couponRepoInTx.findOneBy.mockResolvedValueOnce({
        id: 'coupon-1', discountPercent: 20, isActive: true, expiresAt: new Date('2020-01-01'), maxRedemptions: null,
      });
      await expect(service.createPeriod('salon-1', { ...dto, couponCode: 'PLUS20' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a coupon this salon already redeemed', async () => {
      couponRepoInTx.findOneBy.mockResolvedValueOnce({ id: 'coupon-1', discountPercent: 20, isActive: true, expiresAt: null, maxRedemptions: null });
      redemptionRepoInTx.findOneBy.mockResolvedValueOnce({ id: 'existing' });
      await expect(service.createPeriod('salon-1', { ...dto, couponCode: 'PLUS20' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects once a capped coupon has reached max redemptions', async () => {
      couponRepoInTx.findOneBy.mockResolvedValueOnce({ id: 'coupon-1', discountPercent: 20, isActive: true, expiresAt: null, maxRedemptions: 2 });
      redemptionRepoInTx.count.mockResolvedValueOnce(2);
      await expect(service.createPeriod('salon-1', { ...dto, couponCode: 'PLUS20' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('setStatus', () => {
    it('404s when the period does not exist under this salon', async () => {
      periodsRepoInTx.findOneBy.mockResolvedValue(null);
      await expect(service.setStatus('salon-1', 'missing', 'paid')).rejects.toBeInstanceOf(NotFoundException);
      expect(periodsRepoInTx.findOneBy).toHaveBeenCalledWith({ id: 'missing', salonId: 'salon-1' });
      expect(periodsRepoInTx.update).not.toHaveBeenCalled();
    });

    it('409s when the compare-and-swap loses (period already resolved, possibly by a concurrent admin)', async () => {
      periodsRepoInTx.findOneBy.mockResolvedValue({ id: 'period-1', salonId: 'salon-1', status: 'pending', couponId: null });
      periodsRepoInTx.update.mockResolvedValue({ affected: 0 });
      await expect(service.setStatus('salon-1', 'period-1', 'comped')).rejects.toBeInstanceOf(ConflictException);
    });

    it('marks a pending period paid via a status-conditioned UPDATE and stamps resolvedAt', async () => {
      periodsRepoInTx.findOneBy
        .mockResolvedValueOnce({ id: 'period-1', salonId: 'salon-1', status: 'pending', couponId: null })
        .mockResolvedValueOnce({ id: 'period-1', salonId: 'salon-1', status: 'paid', resolvedAt: new Date() });

      const result = await service.setStatus('salon-1', 'period-1', 'paid');
      expect(periodsRepoInTx.update).toHaveBeenCalledWith(
        { id: 'period-1', salonId: 'salon-1', status: 'pending' },
        { status: 'paid', resolvedAt: expect.any(Date) },
      );
      expect(redemptionRepoInTx.delete).not.toHaveBeenCalled();
      expect(result.status).toBe('paid');
    });

    it('voiding a coupon-discounted period releases the redemption so the salon can use the code again', async () => {
      periodsRepoInTx.findOneBy
        .mockResolvedValueOnce({ id: 'period-1', salonId: 'salon-1', status: 'pending', couponId: 'coupon-1' })
        .mockResolvedValueOnce({ id: 'period-1', salonId: 'salon-1', status: 'void', resolvedAt: new Date() });

      await service.setStatus('salon-1', 'period-1', 'void');
      expect(redemptionRepoInTx.delete).toHaveBeenCalledWith({ billingPeriodId: 'period-1' });
    });

    it('paying a coupon-discounted period keeps the redemption', async () => {
      periodsRepoInTx.findOneBy
        .mockResolvedValueOnce({ id: 'period-1', salonId: 'salon-1', status: 'pending', couponId: 'coupon-1' })
        .mockResolvedValueOnce({ id: 'period-1', salonId: 'salon-1', status: 'paid', resolvedAt: new Date() });

      await service.setStatus('salon-1', 'period-1', 'paid');
      expect(redemptionRepoInTx.delete).not.toHaveBeenCalled();
    });
  });
});
