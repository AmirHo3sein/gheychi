import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { ServiceCategory } from '../catalog/service-category.entity';
import { CitiesService } from '../cities/cities.service';
import { EntitlementsService } from '../subscriptions/entitlements.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { UsersService } from '../users/users.service';
import { SalonCategory } from './salon-category.entity';
import { SalonSlugHistory } from './salon-slug-history.entity';
import { Salon } from './salon.entity';
import { SalonsService } from './salons.service';

describe('SalonsService', () => {
  let service: SalonsService;
  let repo: { findOneBy: jest.Mock; findOne: jest.Mock; save: jest.Mock; update: jest.Mock };
  let salonCategoriesRepo: { createQueryBuilder: jest.Mock };
  let serviceCategoriesRepo: { count: jest.Mock };
  let slugHistoryRepo: { findOneBy: jest.Mock };
  let dataSourceTransaction: jest.Mock;
  let notifications: { emit: jest.Mock };
  let usersService: { promoteToProvider: jest.Mock; findById: jest.Mock };
  let citiesService: { findIdByName: jest.Mock };
  let analytics: { track: jest.Mock };
  let subscriptions: { createDefaultSubscription: jest.Mock };
  let entitlements: { requireFeature: jest.Mock };
  let emSave: jest.Mock;
  let emCreate: jest.Mock;
  let emInsert: jest.Mock;
  let emDelete: jest.Mock;
  let emUpdate: jest.Mock;
  let emFindOneBy: jest.Mock;
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
    repo = { findOneBy: jest.fn(), findOne: jest.fn(), save: jest.fn((s) => s), update: jest.fn() };
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
    emUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    // Default: the target handle carries no salon_slug_history reservation at all -- the
    // ordinary "renaming to a never-before-used handle" case. Reclaim/hijack tests override.
    emFindOneBy = jest.fn().mockResolvedValue(null);
    dataSourceTransaction = jest.fn((cb: (em: unknown) => unknown) =>
      cb({ save: emSave, create: emCreate, insert: emInsert, delete: emDelete, update: emUpdate, findOneBy: emFindOneBy }),
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
    slugHistoryRepo = { findOneBy: jest.fn().mockResolvedValue(null) };
    analytics = { track: jest.fn().mockResolvedValue(undefined) };
    subscriptions = { createDefaultSubscription: jest.fn().mockResolvedValue(undefined) };
    // Default: entitlement granted, matching the registry's customHandle default (true) --
    // every pre-existing updateHandle test exercises the owner path and must keep passing
    // unless it explicitly opts into the denied case.
    entitlements = { requireFeature: jest.fn().mockResolvedValue(undefined) };

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
        { provide: SubscriptionsService, useValue: subscriptions },
        { provide: getRepositoryToken(SalonSlugHistory), useValue: slugHistoryRepo },
        { provide: EntitlementsService, useValue: entitlements },
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

    it('creates the initial subscription for the new salon, inside the same transaction', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await service.createForOwner('u1', DTO);

      // The em passed through is the exact transaction callback's own em (save/create/
      // insert/delete come from the same object) -- proves this isn't a second, separate
      // transaction that could commit independently of the salon insert.
      expect(subscriptions.createDefaultSubscription).toHaveBeenCalledWith(
        'new-salon-id',
        expect.objectContaining({ save: emSave, insert: emInsert }),
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

  describe('updateHandle', () => {
    it('rejects a reserved word without touching the database', async () => {
      await expect(service.updateHandle('s1', 'mine')).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.findOneBy).not.toHaveBeenCalled();
    });

    it('404s when the salon does not exist', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.updateHandle('missing', 'my-salon')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('translates a duplicate handle into a clean conflict', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', slug: 'old-handle' });
      const driverError = Object.assign(new Error('duplicate'), { code: '23505' });
      emUpdate.mockRejectedValue(new QueryFailedError('', [], driverError));

      await expect(service.updateHandle('s1', 'taken-handle')).rejects.toBeInstanceOf(ConflictException);
    });

    it('updates the slug and returns the salon with the new handle', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', slug: 'old-handle' });

      const result = await service.updateHandle('s1', 'my-new-handle');

      expect(emUpdate).toHaveBeenCalledWith(Salon, { id: 's1', slug: 'old-handle' }, { slug: 'my-new-handle' });
      expect(result.slug).toBe('my-new-handle');
    });

    // The CAS guard: two concurrent renames of the SAME salon must not silently let the
    // loser overwrite the winner's already-committed slug based on a stale read.
    it('rejects with a clean, retryable conflict when the salon\'s slug already moved since it was read', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', slug: 'old-handle' });
      emUpdate.mockResolvedValue({ affected: 0 });

      await expect(service.updateHandle('s1', 'my-new-handle')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.updateHandle('s1', 'my-new-handle')).rejects.toThrow(
        'نشانی سالن هم‌زمان توسط عملیات دیگری تغییر کرده است؛ دوباره تلاش کنید',
      );
      // The throw happens inside the transaction callback before any reservation lookup
      // or history write is attempted.
      expect(emFindOneBy).not.toHaveBeenCalled();
      expect(emInsert).not.toHaveBeenCalled();
    });

    // The whole point of the table: a printed QR code outlives any rename, and the handle it
    // points at must stay spoken for so nobody else can inherit that traffic.
    it('records the released handle in salon_slug_history, inside the same transaction as the rename', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', slug: 'old-handle' });

      await service.updateHandle('s1', 'my-new-handle');

      expect(dataSourceTransaction).toHaveBeenCalledTimes(1);
      expect(emInsert).toHaveBeenCalledWith(SalonSlugHistory, { slug: 'old-handle', salonId: 's1' });
    });

    // Ordering is load-bearing, not incidental -- see updateHandle's own comment: the UPDATE
    // must serialize on the salons.slug unique index BEFORE the reservation is read, or a
    // concurrent release could slip a handle out from under its own reservation.
    it('writes the salons UPDATE before reading the reservation', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', slug: 'old-handle' });

      await service.updateHandle('s1', 'my-new-handle');

      expect(emUpdate.mock.invocationCallOrder[0]).toBeLessThan(emFindOneBy.mock.invocationCallOrder[0]!);
    });

    it('lets a salon reclaim one of its own former handles, and drops that history row', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', slug: 'current-handle' });
      emFindOneBy.mockResolvedValue({ slug: 'old-handle', salonId: 's1' });

      const result = await service.updateHandle('s1', 'old-handle');

      expect(result.slug).toBe('old-handle');
      // Live again, so it is no longer history -- leaving the row would keep the handle
      // permanently "released" and make it redirect to itself.
      expect(emDelete).toHaveBeenCalledWith(SalonSlugHistory, { slug: 'old-handle' });
      expect(emInsert).toHaveBeenCalledWith(SalonSlugHistory, { slug: 'current-handle', salonId: 's1' });
    });

    it('refuses a handle reserved to a DIFFERENT salon, with a Persian message and no reservation dropped', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', slug: 'current-handle' });
      emFindOneBy.mockResolvedValue({ slug: 'rivals-old-handle', salonId: 's2' });

      await expect(service.updateHandle('s1', 'rivals-old-handle')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.updateHandle('s1', 'rivals-old-handle')).rejects.toThrow(
        'این آدرس پیش‌تر متعلق به سالن دیگری بوده و قابل استفاده نیست',
      );
      // The throw happens inside the transaction callback, so the UPDATE above it rolls back
      // with it -- nothing here may delete the other salon's reservation.
      expect(emDelete).not.toHaveBeenCalled();
    });

    // Admin override is this feature's documented recourse (an inappropriate handle, a typo
    // an owner can't undo) and must not be blockable by the reservation it exists to unwind.
    it('lets an admin take a handle reserved to another salon, still recording the caller\'s own released handle', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', slug: 'current-handle' });
      emFindOneBy.mockResolvedValue({ slug: 'rivals-old-handle', salonId: 's2' });

      const result = await service.updateHandle('s1', 'rivals-old-handle', true);

      expect(result.slug).toBe('rivals-old-handle');
      expect(emDelete).toHaveBeenCalledWith(SalonSlugHistory, { slug: 'rivals-old-handle' });
      expect(emInsert).toHaveBeenCalledWith(SalonSlugHistory, { slug: 'current-handle', salonId: 's1' });
    });

    it('is a no-op when the submitted handle is the one already in use -- no history written', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', slug: 'same-handle' });

      const result = await service.updateHandle('s1', 'same-handle');

      expect(result.slug).toBe('same-handle');
      expect(dataSourceTransaction).not.toHaveBeenCalled();
      expect(emInsert).not.toHaveBeenCalled();
    });

    describe('entitlements.customHandle gate', () => {
      it('rejects the owner path with a 403 when the entitlement is denied, and never touches the salon row', async () => {
        entitlements.requireFeature.mockRejectedValue(new ForbiddenException('ویرایش نشانی اختصاصی در پلن فعلی سالن شما فعال نیست'));

        await expect(service.updateHandle('s1', 'my-new-handle')).rejects.toBeInstanceOf(ForbiddenException);
        expect(entitlements.requireFeature).toHaveBeenCalledWith('s1', 'customHandle', expect.any(String));
        expect(repo.findOneBy).not.toHaveBeenCalled();
      });

      it('lets the owner path through when the entitlement is granted (true or absent, both resolved by EntitlementsService)', async () => {
        repo.findOneBy.mockResolvedValue({ id: 's1', slug: 'old-handle' });

        const result = await service.updateHandle('s1', 'my-new-handle');

        expect(entitlements.requireFeature).toHaveBeenCalledWith('s1', 'customHandle', expect.any(String));
        expect(result.slug).toBe('my-new-handle');
      });

      it('never checks the entitlement on the admin-override path, even when it would be denied', async () => {
        entitlements.requireFeature.mockRejectedValue(new ForbiddenException('denied'));
        repo.findOneBy.mockResolvedValue({ id: 's1', slug: 'old-handle' });

        const result = await service.updateHandle('s1', 'my-new-handle', true);

        expect(entitlements.requireFeature).not.toHaveBeenCalled();
        expect(result.slug).toBe('my-new-handle');
      });
    });
  });

  describe('resolveCanonicalSlug', () => {
    it('reports a live approved handle as canonical, without touching history', async () => {
      repo.findOne.mockResolvedValue({ id: 's1' });

      await expect(service.resolveCanonicalSlug('live-handle')).resolves.toEqual({
        slug: 'live-handle',
        moved: false,
      });
      expect(slugHistoryRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('resolves a former handle to the salon\'s current one', async () => {
      repo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ slug: 'new-handle' });
      slugHistoryRepo.findOneBy.mockResolvedValue({ slug: 'old-handle', salonId: 's1' });

      await expect(service.resolveCanonicalSlug('old-handle')).resolves.toEqual({ slug: 'new-handle', moved: true });
    });

    it('404s for a handle that is neither live nor history', async () => {
      repo.findOne.mockResolvedValue(null);
      slugHistoryRepo.findOneBy.mockResolvedValue(null);

      await expect(service.resolveCanonicalSlug('never-existed')).rejects.toBeInstanceOf(NotFoundException);
    });

    // A former handle whose salon is no longer publicly visible must 404 like any other
    // unapproved salon -- redirecting to a page that itself 404s would leak its existence.
    it('404s when the history row points at a salon that is no longer approved', async () => {
      repo.findOne.mockResolvedValue(null);
      slugHistoryRepo.findOneBy.mockResolvedValue({ slug: 'old-handle', salonId: 's1' });

      await expect(service.resolveCanonicalSlug('old-handle')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
