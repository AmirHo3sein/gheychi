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
  // In-memory fakes rather than exact-call-order mockResolvedValueOnce chains -- getForSalon
  // now internally calls getEntitlements (which re-reads both repos), so the number of
  // findOneBy calls per public method is an implementation detail this suite shouldn't pin.
  let subscriptionsById: Record<string, Record<string, unknown>>;
  let plansById: Record<string, Record<string, unknown>>;

  beforeEach(async () => {
    subscriptionsById = {};
    plansById = {};
    subRepo = {
      findOneBy: jest.fn(({ salonId }: { salonId: string }) => Promise.resolve(subscriptionsById[salonId] ?? null)),
      update: jest.fn(({ salonId }: { salonId: string }, patch: Record<string, unknown>) => {
        Object.assign(subscriptionsById[salonId], patch);
        return Promise.resolve(undefined);
      }),
    };
    planRepo = {
      findOneBy: jest.fn((where: { id?: string; isDefault?: boolean }) => {
        if (where.id !== undefined) return Promise.resolve(plansById[where.id] ?? null);
        return Promise.resolve(Object.values(plansById).find((p) => p.isDefault) ?? null);
      }),
    };

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
      plansById.free = { id: 'free', isDefault: true, entitlements: {} };
      await expect(service.getDefaultPlan()).resolves.toEqual(plansById.free);
    });

    it('throws InternalServerErrorException if somehow no plan is default', async () => {
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
    beforeEach(() => {
      plansById.free = { id: 'free', isDefault: true, entitlements: { crmCap: 50 } };
    });

    it('returns the salon plan entitlements when the subscription is active', async () => {
      plansById.plus = { id: 'plus', isDefault: false, entitlements: { smsQuota: 100 } };
      subscriptionsById.s1 = { salonId: 's1', planId: 'plus', status: 'active', entitlementOverrides: null };

      await expect(service.getEntitlements('s1')).resolves.toEqual({ smsQuota: 100 });
    });

    it('merges a salon-specific override on top of the plan entitlements, override winning per key', async () => {
      plansById.plus = { id: 'plus', isDefault: false, entitlements: { smsQuota: 100, crmCap: 10 } };
      subscriptionsById.s1 = {
        salonId: 's1',
        planId: 'plus',
        status: 'active',
        entitlementOverrides: { smsQuota: 500 },
      };

      await expect(service.getEntitlements('s1')).resolves.toEqual({ smsQuota: 500, crmCap: 10 });
    });

    it('falls back to the default plan (no overrides applied) when the subscription is canceled', async () => {
      plansById.plus = { id: 'plus', isDefault: false, entitlements: { smsQuota: 100 } };
      subscriptionsById.s1 = {
        salonId: 's1',
        planId: 'plus',
        status: 'canceled',
        entitlementOverrides: { smsQuota: 999 },
      };

      await expect(service.getEntitlements('s1')).resolves.toEqual({ crmCap: 50 });
    });

    it('falls back to the default plan when the salon has no subscription row at all', async () => {
      await expect(service.getEntitlements('s1')).resolves.toEqual({ crmCap: 50 });
    });
  });

  describe('getForSalon', () => {
    it('404s when the salon has no subscription row', async () => {
      await expect(service.getForSalon('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reports the plan the subscription nominally references, plus what is actually resolved', async () => {
      plansById.free = { id: 'free', isDefault: true, entitlements: {} };
      plansById.plus = { id: 'plus', isDefault: false, entitlements: { smsQuota: 100 } };
      subscriptionsById.s1 = { salonId: 's1', planId: 'plus', status: 'canceled', entitlementOverrides: null };

      const result = await service.getForSalon('s1');

      // Nominal plan is still 'plus' even though the subscription is canceled -- distinct
      // from resolvedEntitlements, which correctly falls back to the default plan's.
      expect(result.plan).toEqual(plansById.plus);
      expect(result.resolvedEntitlements).toEqual({});
    });
  });

  describe('assignPlan', () => {
    it('404s when the target plan does not exist', async () => {
      await expect(service.assignPlan('s1', 'missing-plan')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to assign an inactive plan', async () => {
      plansById.p1 = { id: 'p1', isActive: false };
      await expect(service.assignPlan('s1', 'p1')).rejects.toBeInstanceOf(ConflictException);
      expect(subRepo.update).not.toHaveBeenCalled();
    });

    it('404s when the salon has no subscription row to update', async () => {
      plansById.p1 = { id: 'p1', isActive: true, entitlements: {} };
      await expect(service.assignPlan('s1', 'p1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates the plan and reactivates a previously canceled subscription', async () => {
      plansById.free = { id: 'free', isDefault: true, entitlements: {} };
      plansById.p1 = { id: 'p1', isActive: true, entitlements: {} };
      subscriptionsById.s1 = {
        salonId: 's1',
        planId: 'free',
        status: 'canceled',
        canceledAt: new Date(),
        entitlementOverrides: null,
      };

      const result = await service.assignPlan('s1', 'p1');

      expect(subRepo.update).toHaveBeenCalledWith({ salonId: 's1' }, { planId: 'p1', status: 'active', canceledAt: null });
      expect(result.subscription.status).toBe('active');
      expect(result.subscription.canceledAt).toBeNull();
    });
  });

  describe('cancel', () => {
    it('404s when the salon has no subscription row', async () => {
      await expect(service.cancel('s1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects canceling an already-canceled subscription', async () => {
      plansById.free = { id: 'free', isDefault: true, entitlements: {} };
      subscriptionsById.s1 = { salonId: 's1', planId: 'free', status: 'canceled', entitlementOverrides: null };
      await expect(service.cancel('s1')).rejects.toBeInstanceOf(ConflictException);
      expect(subRepo.update).not.toHaveBeenCalled();
    });

    it('marks an active subscription canceled with a timestamp', async () => {
      plansById.free = { id: 'free', isDefault: true, entitlements: {} };
      subscriptionsById.s1 = {
        salonId: 's1',
        planId: 'free',
        status: 'active',
        canceledAt: null,
        entitlementOverrides: null,
      };

      await service.cancel('s1');

      expect(subRepo.update).toHaveBeenCalledWith(
        { salonId: 's1' },
        { status: 'canceled', canceledAt: expect.any(Date), entitlementOverrides: null },
      );
    });
  });

  describe('setOverrides', () => {
    it('404s when the salon has no subscription row', async () => {
      await expect(service.setOverrides('s1', { smsQuota: 10 })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('sets the override bag and reflects it in the resolved entitlements', async () => {
      plansById.free = { id: 'free', isDefault: true, entitlements: { crmCap: 5 } };
      subscriptionsById.s1 = { salonId: 's1', planId: 'free', status: 'active', entitlementOverrides: null };

      const result = await service.setOverrides('s1', { crmCap: 999 });

      expect(subRepo.update).toHaveBeenCalledWith({ salonId: 's1' }, { entitlementOverrides: { crmCap: 999 } });
      expect(result.resolvedEntitlements).toEqual({ crmCap: 999 });
    });

    it('clears every override when passed null', async () => {
      plansById.free = { id: 'free', isDefault: true, entitlements: { crmCap: 5 } };
      subscriptionsById.s1 = { salonId: 's1', planId: 'free', status: 'active', entitlementOverrides: { crmCap: 999 } };

      const result = await service.setOverrides('s1', null);

      expect(subRepo.update).toHaveBeenCalledWith({ salonId: 's1' }, { entitlementOverrides: null });
      expect(result.resolvedEntitlements).toEqual({ crmCap: 5 });
    });
  });
});
