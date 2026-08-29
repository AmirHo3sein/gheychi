import { ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Plan } from './plan.entity';
import { SalonSubscription } from './salon-subscription.entity';
import { SubscriptionsService } from './subscriptions.service';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let subRepo: { findOneBy: jest.Mock; update: jest.Mock };
  let planRepo: { findOneBy: jest.Mock };

  beforeEach(async () => {
    subRepo = { findOneBy: jest.fn(), update: jest.fn().mockResolvedValue(undefined) };
    planRepo = { findOneBy: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: getRepositoryToken(SalonSubscription), useValue: subRepo },
        { provide: getRepositoryToken(Plan), useValue: planRepo },
      ],
    }).compile();
    service = moduleRef.get(SubscriptionsService);
  });

  describe('getDefaultPlan', () => {
    it('returns the plan flagged as default', async () => {
      planRepo.findOneBy.mockResolvedValue({ id: 'free', isDefault: true });
      await expect(service.getDefaultPlan()).resolves.toEqual({ id: 'free', isDefault: true });
      expect(planRepo.findOneBy).toHaveBeenCalledWith({ isDefault: true });
    });

    it('throws InternalServerErrorException if somehow no plan is default', async () => {
      planRepo.findOneBy.mockResolvedValue(null);
      await expect(service.getDefaultPlan()).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('createDefaultSubscription', () => {
    it('inserts a subscription for the default plan, via the given EntityManager', async () => {
      const emFindOneBy = jest.fn().mockResolvedValue({ id: 'free-plan' });
      const emInsert = jest.fn().mockResolvedValue(undefined);
      const em = { findOneBy: emFindOneBy, insert: emInsert } as never;

      await service.createDefaultSubscription('salon-1', em);

      expect(emInsert).toHaveBeenCalledWith(
        SalonSubscription,
        expect.objectContaining({ salonId: 'salon-1', planId: 'free-plan', status: 'active' }),
      );
    });

    it('throws InternalServerErrorException rather than inserting with no plan at all', async () => {
      const em = { findOneBy: jest.fn().mockResolvedValue(null), insert: jest.fn() } as never;
      await expect(service.createDefaultSubscription('salon-1', em)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      expect((em as { insert: jest.Mock }).insert).not.toHaveBeenCalled();
    });
  });

  describe('getEntitlements', () => {
    it('returns the salon plan entitlements when the subscription is active', async () => {
      subRepo.findOneBy.mockResolvedValue({ salonId: 's1', planId: 'plus', status: 'active' });
      planRepo.findOneBy.mockResolvedValue({ id: 'plus', entitlements: { smsQuota: 100 } });

      await expect(service.getEntitlements('s1')).resolves.toEqual({ smsQuota: 100 });
      expect(planRepo.findOneBy).toHaveBeenCalledWith({ id: 'plus' });
    });

    it('falls back to the default plan when the subscription is canceled', async () => {
      subRepo.findOneBy.mockResolvedValue({ salonId: 's1', planId: 'plus', status: 'canceled' });
      planRepo.findOneBy.mockResolvedValue({ id: 'free', isDefault: true, entitlements: {} });

      const result = await service.getEntitlements('s1');

      expect(result).toEqual({});
      expect(planRepo.findOneBy).toHaveBeenCalledWith({ isDefault: true });
    });

    it('falls back to the default plan when the salon has no subscription row at all', async () => {
      subRepo.findOneBy.mockResolvedValue(null);
      planRepo.findOneBy.mockResolvedValue({ id: 'free', isDefault: true, entitlements: { crmCap: 50 } });

      await expect(service.getEntitlements('s1')).resolves.toEqual({ crmCap: 50 });
    });
  });

  describe('assignPlan', () => {
    it('404s when the target plan does not exist', async () => {
      planRepo.findOneBy.mockResolvedValue(null);
      await expect(service.assignPlan('s1', 'missing-plan')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to assign an inactive plan', async () => {
      planRepo.findOneBy.mockResolvedValue({ id: 'p1', isActive: false });
      await expect(service.assignPlan('s1', 'p1')).rejects.toBeInstanceOf(ConflictException);
      expect(subRepo.update).not.toHaveBeenCalled();
    });

    it('404s when the salon has no subscription row to update', async () => {
      planRepo.findOneBy.mockResolvedValue({ id: 'p1', isActive: true });
      subRepo.findOneBy.mockResolvedValueOnce(null);
      await expect(service.assignPlan('s1', 'p1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates the plan and reactivates a previously canceled subscription', async () => {
      planRepo.findOneBy.mockResolvedValue({ id: 'p1', isActive: true, entitlements: {} });
      subRepo.findOneBy
        .mockResolvedValueOnce({ salonId: 's1', status: 'canceled' }) // existence check
        .mockResolvedValueOnce({ salonId: 's1', planId: 'p1', status: 'active' }); // getForSalon re-read

      await service.assignPlan('s1', 'p1');

      expect(subRepo.update).toHaveBeenCalledWith({ salonId: 's1' }, { planId: 'p1', status: 'active', canceledAt: null });
    });
  });

  describe('cancel', () => {
    it('404s when the salon has no subscription row', async () => {
      subRepo.findOneBy.mockResolvedValue(null);
      await expect(service.cancel('s1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects canceling an already-canceled subscription', async () => {
      subRepo.findOneBy.mockResolvedValue({ salonId: 's1', status: 'canceled' });
      await expect(service.cancel('s1')).rejects.toBeInstanceOf(ConflictException);
      expect(subRepo.update).not.toHaveBeenCalled();
    });

    it('marks an active subscription canceled with a timestamp', async () => {
      planRepo.findOneBy.mockResolvedValue({ id: 'p1' });
      subRepo.findOneBy
        .mockResolvedValueOnce({ salonId: 's1', planId: 'p1', status: 'active' }) // existence check
        .mockResolvedValueOnce({ salonId: 's1', planId: 'p1', status: 'canceled' }); // getForSalon re-read

      await service.cancel('s1');

      expect(subRepo.update).toHaveBeenCalledWith(
        { salonId: 's1' },
        { status: 'canceled', canceledAt: expect.any(Date) },
      );
    });
  });
});
