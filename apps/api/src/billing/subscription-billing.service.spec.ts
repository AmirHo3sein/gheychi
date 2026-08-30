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
  let redemptionRepoInTx: { findOneBy: jest.Mock; count: jest.Mock; save: jest.Mock; create: jest.Mock };
  let periodsRepoInTx: { save: jest.Mock; create: jest.Mock };
  let transactionMock: jest.Mock;

  beforeEach(async () => {
    periodsRepo = { find: jest.fn().mockResolvedValue([]) };
    subscriptions = {
      getForSalon: jest.fn().mockResolvedValue({ plan: { id: 'plan-1', monthlyPriceToman: 500_000 } }),
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
    };
    periodsRepoInTx = {
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve({ id: 'period-1', ...v })),
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
    it('404s when the period does not exist', async () => {
      const findOneBy = jest.fn().mockResolvedValue(null);
      Object.assign(periodsRepo, { findOneBy });
      await expect(service.setStatus('missing', 'paid')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409s when the period is already resolved', async () => {
      const findOneBy = jest.fn().mockResolvedValue({ id: 'period-1', status: 'paid' });
      Object.assign(periodsRepo, { findOneBy });
      await expect(service.setStatus('period-1', 'comped')).rejects.toBeInstanceOf(ConflictException);
    });

    it('marks a pending period paid and stamps resolvedAt', async () => {
      const update = jest.fn().mockResolvedValue({ affected: 1 });
      const findOneBy = jest
        .fn()
        .mockResolvedValueOnce({ id: 'period-1', status: 'pending' })
        .mockResolvedValueOnce({ id: 'period-1', status: 'paid', resolvedAt: new Date() });
      Object.assign(periodsRepo, { findOneBy, update });

      const result = await service.setStatus('period-1', 'paid');
      expect(update).toHaveBeenCalledWith({ id: 'period-1' }, { status: 'paid', resolvedAt: expect.any(Date) });
      expect(result.status).toBe('paid');
    });
  });
});
