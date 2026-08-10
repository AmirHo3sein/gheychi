import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { ServiceCategory } from '../catalog/service-category.entity';
import { CitiesService } from '../cities/cities.service';
import { UsersService } from '../users/users.service';
import { SalonCategory } from './salon-category.entity';
import { Salon } from './salon.entity';
import { SalonsService } from './salons.service';

describe('SalonsService', () => {
  let service: SalonsService;
  let repo: { findOneBy: jest.Mock; save: jest.Mock; update: jest.Mock };
  let salonCategoriesRepo: { createQueryBuilder: jest.Mock };
  let serviceCategoriesRepo: { count: jest.Mock };
  let dataSourceTransaction: jest.Mock;
  let notifications: { emit: jest.Mock };
  let usersService: { promoteToProvider: jest.Mock; findById: jest.Mock };
  let citiesService: { findIdByName: jest.Mock };
  let analytics: { track: jest.Mock };
  let emSave: jest.Mock;
  let emCreate: jest.Mock;
  let emInsert: jest.Mock;
  let emDelete: jest.Mock;
  // The rows attachCategories' queryBuilder resolves to for the "just wrote this
  // salon's categories" salon -- tests set this per-case.
  let categoryRows: Array<{ salon_id: string; id: number; name: string; icon: string }>;

  function fakeQueryBuilder() {
    const qb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(() => Promise.resolve(categoryRows)),
    };
    return qb;
  }

  beforeEach(async () => {
    repo = { findOneBy: jest.fn(), save: jest.fn((s) => s), update: jest.fn() };
    categoryRows = [];
    salonCategoriesRepo = { createQueryBuilder: jest.fn(() => fakeQueryBuilder()) };
    serviceCategoriesRepo = { count: jest.fn().mockResolvedValue(2) }; // matches a 2-id categoryIds input by default
    // Mimics the real repo assigning a generated id on insert -- createForOwner's own
    // salon_submitted analytics call (see the 'analytics' describe block below) reads
    // salon.id off this return value, same as the real em.save would produce.
    emSave = jest.fn((_entity, obj) => ({ id: 'new-salon-id', ...obj }));
    emCreate = jest.fn((_entity, obj) => obj);
    emInsert = jest.fn().mockResolvedValue(undefined);
    emDelete = jest.fn().mockResolvedValue(undefined);
    dataSourceTransaction = jest.fn((cb: (em: unknown) => unknown) =>
      cb({ save: emSave, create: emCreate, insert: emInsert, delete: emDelete }),
    );
    notifications = { emit: jest.fn().mockResolvedValue(undefined) };
    usersService = {
      promoteToProvider: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue({ id: 'owner-1', status: 'active' }),
    };
    // Default: no canonical match (null) unless a test opts in -- keeps every
    // pre-existing test's em.create()/save() assertions about cityId explicit rather
    // than accidentally depending on this mock's default.
    citiesService = { findIdByName: jest.fn().mockResolvedValue(null) };
    analytics = { track: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SalonsService,
        { provide: getRepositoryToken(Salon), useValue: repo },
        { provide: getRepositoryToken(SalonCategory), useValue: salonCategoriesRepo },
        { provide: getRepositoryToken(ServiceCategory), useValue: serviceCategoriesRepo },
        { provide: DataSource, useValue: { transaction: dataSourceTransaction } },
        { provide: UsersService, useValue: usersService },
        { provide: AdminNotificationsService, useValue: notifications },
        { provide: CitiesService, useValue: citiesService },
        { provide: AnalyticsService, useValue: analytics },
      ],
    }).compile();
    service = moduleRef.get(SalonsService);
  });

  describe('createForOwner', () => {
    const DTO = {
      name: 'سالن جدید', genderTarget: 'women' as const, address: 'خیابان تست', city: 'تهران',
      lat: 35.7, lng: 51.4, categoryIds: [1, 2],
    };

    it('404s -- rejects with a clear message when a categoryId does not exist', async () => {
      repo.findOneBy.mockResolvedValue(null);
      serviceCategoriesRepo.count.mockResolvedValue(1); // only 1 of the 2 submitted ids is real

      await expect(service.createForOwner('u1', DTO)).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSourceTransaction).not.toHaveBeenCalled();
    });

    it('inserts one salon_categories row per submitted id, inside the same transaction as the salon insert', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await service.createForOwner('u1', DTO);

      expect(emInsert).toHaveBeenCalledWith(
        SalonCategory,
        expect.arrayContaining([
          expect.objectContaining({ categoryId: 1 }),
          expect.objectContaining({ categoryId: 2 }),
        ]),
      );
    });

    it('rejects with a conflict when the owner already has a salon, without touching categories', async () => {
      repo.findOneBy.mockResolvedValue({ id: 'existing' } as Salon);

      await expect(service.createForOwner('u1', DTO)).rejects.toBeInstanceOf(ConflictException);
      expect(serviceCategoriesRepo.count).not.toHaveBeenCalled();
    });

    it('resolves and stores cityId when the submitted city matches a canonical name, without warning', async () => {
      repo.findOneBy.mockResolvedValue(null);
      citiesService.findIdByName.mockResolvedValue(7);
      const warnSpy = jest.spyOn(service['logger'], 'warn');

      await service.createForOwner('u1', DTO);

      expect(citiesService.findIdByName).toHaveBeenCalledWith('تهران');
      expect(emCreate).toHaveBeenCalledWith(Salon, expect.objectContaining({ cityId: 7 }));
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('leaves cityId null (never blocks creation) and logs a warning when the city has no canonical match', async () => {
      repo.findOneBy.mockResolvedValue(null);
      citiesService.findIdByName.mockResolvedValue(null);
      const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation();

      const result = await service.createForOwner('u1', DTO);

      expect(emCreate).toHaveBeenCalledWith(Salon, expect.objectContaining({ cityId: null }));
      expect(result).toBeTruthy();
      // Non-blocking by design (see resolveCityId's own comment): a non-canonical city
      // still creates the salon fine, but is no longer purely silent -- it's now an
      // ops-visible warning naming both the bad value and the owner.
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('تهران'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('u1'));
    });

    describe('analytics', () => {
      it('tracks salon_submitted only after the transaction commits, with no PII', async () => {
        repo.findOneBy.mockResolvedValue(null);

        await service.createForOwner('u1', DTO);

        expect(analytics.track).toHaveBeenCalledWith(
          'salon_submitted',
          { salonId: 'new-salon-id', categoryCount: 2, genderTarget: 'women', hasDescription: false },
          { userId: 'u1' },
        );
      });

      it('still creates the salon when the analytics provider fails (never affects the request)', async () => {
        repo.findOneBy.mockResolvedValue(null);
        analytics.track.mockRejectedValue(new Error('analytics vendor down'));

        await expect(service.createForOwner('u1', DTO)).resolves.toBeTruthy();
      });
    });
  });

  describe('updateMine', () => {
    it('applies a genderTarget change', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', ownerId: 'u1', genderTarget: 'women' } as Salon);
      const result = await service.updateMine('u1', { genderTarget: 'men' });
      expect(result.genderTarget).toBe('men');
    });

    it('re-resolves cityId when city is included in the update', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', ownerId: 'u1', city: 'اصفهان', cityId: 3 } as unknown as Salon);
      citiesService.findIdByName.mockResolvedValue(9);
      const warnSpy = jest.spyOn(service['logger'], 'warn');

      const result = await service.updateMine('u1', { city: 'مشهد' });

      expect(citiesService.findIdByName).toHaveBeenCalledWith('مشهد');
      expect(result.cityId).toBe(9);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('leaves cityId null (never blocks the update) and logs a warning when the new city has no canonical match', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', ownerId: 'u1', city: 'اصفهان', cityId: 3 } as unknown as Salon);
      citiesService.findIdByName.mockResolvedValue(null);
      const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation();

      const result = await service.updateMine('u1', { city: 'یک شهر نامعتبر' });

      expect(result.cityId).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('یک شهر نامعتبر'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('s1'));
    });

    it('never touches cityId when city is omitted from the update', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', ownerId: 'u1', city: 'اصفهان', cityId: 3 } as unknown as Salon);

      const result = await service.updateMine('u1', { name: 'اسم جدید' });

      expect(citiesService.findIdByName).not.toHaveBeenCalled();
      expect(result.cityId).toBe(3);
    });

    it('leaves categories untouched when categoryIds is omitted from the update', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', ownerId: 'u1' } as Salon);

      await service.updateMine('u1', { name: 'اسم جدید' });

      expect(emDelete).not.toHaveBeenCalled();
      expect(emInsert).not.toHaveBeenCalled();
    });

    it('replaces categories wholesale (delete-all-then-reinsert) when categoryIds is provided', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', ownerId: 'u1' } as Salon);

      await service.updateMine('u1', { categoryIds: [3, 4] });

      expect(emDelete).toHaveBeenCalledWith(SalonCategory, { salonId: 's1' });
      expect(emInsert).toHaveBeenCalledWith(
        SalonCategory,
        expect.arrayContaining([
          expect.objectContaining({ salonId: 's1', categoryId: 3 }),
          expect.objectContaining({ salonId: 's1', categoryId: 4 }),
        ]),
      );
    });

    it('rejects an invalid categoryId before writing anything', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', ownerId: 'u1' } as Salon);
      serviceCategoriesRepo.count.mockResolvedValue(1); // 2 submitted, only 1 real

      await expect(service.updateMine('u1', { categoryIds: [3, 4] })).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSourceTransaction).not.toHaveBeenCalled();
    });

    it('returns the salon enriched with its current category tags', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', ownerId: 'u1' } as Salon);
      serviceCategoriesRepo.count.mockResolvedValue(1); // matches the single id submitted below
      categoryRows = [{ salon_id: 's1', id: 3, name: 'کوتاهی مو', icon: 'scissors' }];

      const result = await service.updateMine('u1', { categoryIds: [3] });

      expect(result.categories).toEqual([{ id: 3, name: 'کوتاهی مو', icon: 'scissors' }]);
    });
  });

  describe('findMine / findPublicBySlug -- category enrichment', () => {
    it('findMine attaches an empty categories array for a salon with none tagged', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', ownerId: 'u1' } as Salon);
      categoryRows = [];

      const result = await service.findMine('u1');

      expect(result.categories).toEqual([]);
    });

    it('findPublicBySlug attaches every tagged category', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', slug: 'test-salon', status: 'approved' } as Salon);
      categoryRows = [
        { salon_id: 's1', id: 1, name: 'کوتاهی مو', icon: 'scissors' },
        { salon_id: 's1', id: 2, name: 'رنگ مو', icon: 'palette' },
      ];

      const result = await service.findPublicBySlug('test-salon');

      expect(result.categories).toHaveLength(2);
      expect(result.categories.map((c) => c.id)).toEqual([1, 2]);
    });

    it('orders category tags alphabetically by name, matching search.service.ts\'s own ordering', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', ownerId: 'u1' } as Salon);
      categoryRows = [];

      await service.findMine('u1');

      const qb = salonCategoriesRepo.createQueryBuilder.mock.results[0]!.value;
      expect(qb.orderBy).toHaveBeenCalledWith('cat.name', 'ASC');
    });
  });

  describe('resubmitMine notification hook', () => {
    const rejected = { id: 's1', ownerId: 'u1', name: 'سالن نمونه', status: 'rejected' } as Salon;
    const pending = {
      id: 's1',
      ownerId: 'u1',
      name: 'سالن نمونه',
      status: 'pending',
      rejectionReason: null,
    } as Salon;

    it('emits salon_resubmitted after a successful resubmit', async () => {
      // resubmitMine reads the salon twice: once before the conditional update,
      // once after it to return the fresh row.
      repo.findOneBy.mockResolvedValueOnce(rejected).mockResolvedValueOnce(pending);
      repo.update.mockResolvedValue({ affected: 1 });

      const result = await service.resubmitMine('u1');

      expect(result.status).toBe('pending');
      expect(notifications.emit).toHaveBeenCalledTimes(1);
      expect(notifications.emit).toHaveBeenCalledWith(
        'salon_resubmitted',
        'سالن «سالن نمونه» دوباره برای بررسی ارسال شد',
        'مالک سالن پس از رد شدن، اطلاعات را ویرایش و درخواست بررسی مجدد ثبت کرده است.',
        '/salons/s1',
      );
    });

    it('does not emit when the conditional update loses the race (409)', async () => {
      repo.findOneBy.mockResolvedValueOnce(rejected);
      repo.update.mockResolvedValue({ affected: 0 });

      await expect(service.resubmitMine('u1')).rejects.toBeInstanceOf(ConflictException);
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('swallows an emit failure — the resubmission still succeeds', async () => {
      repo.findOneBy.mockResolvedValueOnce(rejected).mockResolvedValueOnce(pending);
      repo.update.mockResolvedValue({ affected: 1 });
      notifications.emit.mockRejectedValueOnce(new Error('notification insert failed'));

      const result = await service.resubmitMine('u1');
      expect(result.status).toBe('pending');
    });
  });

  // Moved here from admin-salons.controller.spec.ts when the admin moderation logic moved
  // out of AdminSalonsController (a raw-repository-call handler) and into this service,
  // alongside every other salon business rule. The controller is now a thin delegator --
  // see admin-salons.controller.spec.ts for the (much shorter) delegation-only coverage.
  describe('setStatus (admin moderation)', () => {
    beforeEach(() => {
      repo.findOneBy.mockResolvedValue({ id: 's1' });
      repo.update.mockResolvedValue({ affected: 1 });
    });

    it('records suspended_cause=admin on a direct suspension', async () => {
      await service.setStatus('s1', { status: 'suspended', reason: 'تخلف از قوانین پلتفرم' });
      expect(repo.update).toHaveBeenCalledWith(
        { id: 's1' },
        { status: 'suspended', rejectionReason: 'تخلف از قوانین پلتفرم', suspendedCause: 'admin' },
      );
    });

    it('clears suspended_cause on approval', async () => {
      await service.setStatus('s1', { status: 'approved' });
      expect(repo.update).toHaveBeenCalledWith(
        { id: 's1' },
        { status: 'approved', rejectionReason: null, suspendedCause: null },
      );
    });

    it('leaves suspended_cause untouched on rejection', async () => {
      await service.setStatus('s1', { status: 'rejected', reason: 'مدارک ناقص است' });
      expect(repo.update).toHaveBeenCalledWith(
        { id: 's1' },
        { status: 'rejected', rejectionReason: 'مدارک ناقص است' },
      );
    });

    it('404s when the salon does not exist', async () => {
      repo.update.mockResolvedValueOnce({ affected: 0 });
      await expect(service.setStatus('missing', { status: 'approved' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('admin intent wins: a direct suspension overwrites a prior cascade cause of owner_suspended', async () => {
      // Simulates the owner-suspension cascade: the salon is already suspended because
      // its owner was suspended (suspended_cause='owner_suspended'). An admin then
      // suspends it directly for an unrelated reason. The update must be sent
      // unconditionally with suspendedCause: 'admin' -- NOT skipped or merged based on
      // the current value, and NOT read-before-write -- so that reactivating the owner
      // afterward does NOT auto-restore this salon (only the cascade checks for
      // suspended_cause='owner_suspended' before restoring).
      repo.findOneBy.mockResolvedValueOnce({ id: 's1', status: 'suspended', suspendedCause: 'admin' });

      const result = await service.setStatus('s1', { status: 'suspended', reason: 'تخلف مجدد' });

      expect(repo.findOneBy).not.toHaveBeenCalledWith({ id: 's1', suspendedCause: 'owner_suspended' });
      expect(repo.update).toHaveBeenCalledWith(
        { id: 's1' },
        { status: 'suspended', rejectionReason: 'تخلف مجدد', suspendedCause: 'admin' },
      );
      expect(result).toEqual({ id: 's1', status: 'suspended', suspendedCause: 'admin' });
    });

    it('refuses to approve a pending salon whose owner account is suspended', async () => {
      repo.findOneBy.mockResolvedValueOnce({ id: 's1', ownerId: 'owner-1', status: 'pending' });
      usersService.findById.mockResolvedValueOnce({ id: 'owner-1', status: 'suspended' });

      await expect(service.setStatus('s1', { status: 'approved' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    // The admin panel toasts this message verbatim into a fully Persian RTL screen.
    it('rejects that approval with a Persian message', async () => {
      repo.findOneBy.mockResolvedValueOnce({ id: 's1', ownerId: 'owner-1', status: 'pending' });
      usersService.findById.mockResolvedValueOnce({ id: 'owner-1', status: 'suspended' });

      await expect(service.setStatus('s1', { status: 'approved' })).rejects.toThrow(
        'تایید این آرایشگاه ممکن نیست؛ حساب مالک آن معلق است',
      );
    });
  });

  describe('setFeatured (admin moderation)', () => {
    it('sets isFeatured and featuredUntil', async () => {
      repo.update.mockResolvedValue({ affected: 1 });
      repo.findOneBy.mockResolvedValue({ id: 's1', isFeatured: true });

      await service.setFeatured('s1', { isFeatured: true, featuredUntil: '2026-09-01T00:00:00.000Z' });

      expect(repo.update).toHaveBeenCalledWith(
        { id: 's1' },
        { isFeatured: true, featuredUntil: new Date('2026-09-01T00:00:00.000Z') },
      );
    });

    it('clears featuredUntil to null when omitted', async () => {
      repo.update.mockResolvedValue({ affected: 1 });
      repo.findOneBy.mockResolvedValue({ id: 's1', isFeatured: false });

      await service.setFeatured('s1', { isFeatured: false });

      expect(repo.update).toHaveBeenCalledWith({ id: 's1' }, { isFeatured: false, featuredUntil: null });
    });

    it('404s when the salon does not exist', async () => {
      repo.update.mockResolvedValue({ affected: 0 });
      await expect(service.setFeatured('missing', { isFeatured: true })).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
