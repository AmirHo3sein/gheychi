import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { UNIQUE_VIOLATION } from '../common/postgres-error-codes';
import { SubscriptionCoupon } from './subscription-coupon.entity';
import { SubscriptionCouponsService } from './subscription-coupons.service';

describe('SubscriptionCouponsService', () => {
  let service: SubscriptionCouponsService;
  let repo: { save: jest.Mock; create: jest.Mock; find: jest.Mock; update: jest.Mock; findOneBy: jest.Mock };

  beforeEach(async () => {
    repo = {
      save: jest.fn((v) => Promise.resolve({ id: 'c1', ...v })),
      create: jest.fn((v) => v),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOneBy: jest.fn().mockResolvedValue({ id: 'c1', code: 'PLUS20', discountPercent: 20 }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [SubscriptionCouponsService, { provide: getRepositoryToken(SubscriptionCoupon), useValue: repo }],
    }).compile();
    service = moduleRef.get(SubscriptionCouponsService);
  });

  describe('create', () => {
    it('normalizes the code to uppercase+trimmed', async () => {
      await service.create({ code: '  plus20  ', discountPercent: 20 });
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ code: 'PLUS20' }));
    });

    it('translates a unique-violation into a 409', async () => {
      const err = new QueryFailedError('query', [], new Error('duplicate key'));
      (err as unknown as { code: string }).code = UNIQUE_VIOLATION;
      repo.save.mockRejectedValueOnce(err);
      await expect(service.create({ code: 'PLUS20', discountPercent: 20 })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    it('404s when the coupon does not exist', async () => {
      repo.update.mockResolvedValueOnce({ affected: 0 });
      await expect(service.update('missing', { discountPercent: 30 })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('only patches fields that were actually provided', async () => {
      await service.update('c1', { isActive: false });
      expect(repo.update).toHaveBeenCalledWith({ id: 'c1' }, { isActive: false });
    });
  });

  describe('deactivate', () => {
    it('404s when the coupon does not exist', async () => {
      repo.update.mockResolvedValueOnce({ affected: 0 });
      await expect(service.deactivate('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('flips isActive to false', async () => {
      await service.deactivate('c1');
      expect(repo.update).toHaveBeenCalledWith({ id: 'c1' }, { isActive: false });
    });
  });
});
