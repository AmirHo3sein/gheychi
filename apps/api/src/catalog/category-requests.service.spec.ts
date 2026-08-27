import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { UNIQUE_VIOLATION } from '../common/postgres-error-codes';
import { REDIS } from '../redis/redis.module';
import { Salon } from '../salons/salon.entity';
import { CategoryRequest } from './category-request.entity';
import { CategoryRequestsService } from './category-requests.service';
import { ServiceCategory } from './service-category.entity';

describe('CategoryRequestsService.createForSalon', () => {
  let service: CategoryRequestsService;
  let requests: { save: jest.Mock; create: jest.Mock; findOneBy: jest.Mock };
  let categories: { findOneBy: jest.Mock };
  let salons: { findOneBy: jest.Mock };
  let notifications: { emit: jest.Mock };

  beforeEach(async () => {
    requests = {
      save: jest.fn((row) => Promise.resolve({ id: 'req-1', ...row })),
      create: jest.fn((row) => row),
      findOneBy: jest.fn(),
    };
    categories = { findOneBy: jest.fn().mockResolvedValue(null) };
    salons = { findOneBy: jest.fn().mockResolvedValue({ id: 'salon-1', name: 'سالن نمونه' }) };
    notifications = { emit: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CategoryRequestsService,
        { provide: getRepositoryToken(CategoryRequest), useValue: requests },
        { provide: getRepositoryToken(ServiceCategory), useValue: categories },
        { provide: getRepositoryToken(Salon), useValue: salons },
        { provide: DataSource, useValue: {} },
        { provide: AdminNotificationsService, useValue: notifications },
        { provide: REDIS, useValue: { del: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(CategoryRequestsService);
  });

  it('creates the request and notifies admins with the salon name and requested name', async () => {
    const result = await service.createForSalon('user-1', 'salon-1', { name: 'ناخن‌کاری' });

    expect(result.id).toBe('req-1');
    expect(requests.create).toHaveBeenCalledWith(
      expect.objectContaining({ requesterId: 'user-1', salonId: 'salon-1', name: 'ناخن‌کاری' }),
    );
    expect(notifications.emit).toHaveBeenCalledWith(
      'category_requested',
      expect.any(String),
      expect.stringContaining('ناخن‌کاری'),
      '/category-requests',
    );
  });

  it('rejects (409) when a category with this name already exists, before touching the requests table', async () => {
    categories.findOneBy.mockResolvedValue({ id: 1, name: 'ناخن‌کاری' });

    await expect(service.createForSalon('user-1', 'salon-1', { name: 'ناخن‌کاری' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(requests.save).not.toHaveBeenCalled();
  });

  it('translates a duplicate-pending-request DB error (category_requests_salon_name_pending_uidx) into a clean 409', async () => {
    const err = new QueryFailedError('query', [], new Error('duplicate key'));
    (err as unknown as { code: string }).code = UNIQUE_VIOLATION;
    requests.save.mockRejectedValue(err);

    await expect(service.createForSalon('user-1', 'salon-1', { name: 'ناخن‌کاری' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('does not fail the request when the best-effort admin notification fails', async () => {
    notifications.emit.mockRejectedValue(new Error('notif down'));

    await expect(service.createForSalon('user-1', 'salon-1', { name: 'ناخن‌کاری' })).resolves.toBeDefined();
  });
});

describe('CategoryRequestsService.listForAdmin', () => {
  let service: CategoryRequestsService;
  let qb: {
    leftJoin: jest.Mock;
    select: jest.Mock;
    addSelect: jest.Mock;
    orderBy: jest.Mock;
    offset: jest.Mock;
    limit: jest.Mock;
    andWhere: jest.Mock;
    getRawMany: jest.Mock;
  };
  let requests: { createQueryBuilder: jest.Mock; count: jest.Mock };

  beforeEach(async () => {
    qb = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { id: 'req-1', status: 'pending', name: 'ناخن‌کاری', salonName: 'سالن نمونه', requesterPhone: '09120000000' },
      ]),
    };
    requests = { createQueryBuilder: jest.fn().mockReturnValue(qb), count: jest.fn().mockResolvedValue(1) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CategoryRequestsService,
        { provide: getRepositoryToken(CategoryRequest), useValue: requests },
        { provide: getRepositoryToken(ServiceCategory), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: AdminNotificationsService, useValue: { emit: jest.fn() } },
        { provide: REDIS, useValue: { del: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(CategoryRequestsService);
  });

  it('defaults to the pending status filter and returns joined salon name / requester phone', async () => {
    const result = await service.listForAdmin({});

    expect(qb.andWhere).toHaveBeenCalledWith('request.status = :status', { status: 'pending' });
    expect(requests.count).toHaveBeenCalledWith({ where: { status: 'pending' } });
    expect(result.items[0]!.salonName).toBe('سالن نمونه');
    expect(result.items[0]!.requesterPhone).toBe('09120000000');
    expect(result.total).toBe(1);
  });

  it('skips the status filter entirely when status=all', async () => {
    await service.listForAdmin({ status: 'all' });

    expect(qb.andWhere).not.toHaveBeenCalled();
    expect(requests.count).toHaveBeenCalledWith({ where: {} });
  });
});

describe('CategoryRequestsService.approve', () => {
  let service: CategoryRequestsService;
  let requests: { findOneBy: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let em: { save: jest.Mock; create: jest.Mock; update: jest.Mock; findOneBy: jest.Mock };
  let redis: { del: jest.Mock };

  beforeEach(async () => {
    requests = { findOneBy: jest.fn().mockResolvedValue({ id: 'req-1', status: 'pending' }) };
    em = {
      create: jest.fn((_cls: unknown, row: unknown) => row),
      save: jest.fn().mockResolvedValue({ id: 5, name: 'ناخن‌کاری', icon: 'nail' }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOneBy: jest.fn().mockResolvedValue({ id: 'req-1', status: 'approved', categoryId: 5 }),
    };
    dataSource = { transaction: jest.fn((cb) => cb(em)) };
    redis = { del: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CategoryRequestsService,
        { provide: getRepositoryToken(CategoryRequest), useValue: requests },
        { provide: getRepositoryToken(ServiceCategory), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: {} },
        { provide: DataSource, useValue: dataSource },
        { provide: AdminNotificationsService, useValue: { emit: jest.fn() } },
        { provide: REDIS, useValue: redis },
      ],
    }).compile();
    service = moduleRef.get(CategoryRequestsService);
  });

  it('404s when the request does not exist', async () => {
    requests.findOneBy.mockResolvedValue(null);

    await expect(service.approve('admin-1', 'req-1', { name: 'ناخن‌کاری', icon: 'nail' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('409s when the request is not pending, without opening a transaction', async () => {
    requests.findOneBy.mockResolvedValue({ id: 'req-1', status: 'approved' });

    await expect(service.approve('admin-1', 'req-1', { name: 'ناخن‌کاری', icon: 'nail' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('creates the category, resolves the request, and invalidates the categories cache', async () => {
    const result = await service.approve('admin-1', 'req-1', { name: 'ناخن‌کاری', icon: 'nail' });

    expect(em.save).toHaveBeenCalledWith(ServiceCategory, expect.objectContaining({ name: 'ناخن‌کاری', icon: 'nail' }));
    expect(em.update).toHaveBeenCalledWith(
      CategoryRequest,
      { id: 'req-1', status: 'pending' },
      expect.objectContaining({ status: 'approved', categoryId: 5, resolvedBy: 'admin-1' }),
    );
    expect(redis.del).toHaveBeenCalledWith('categories:list');
    expect(result.categoryId).toBe(5);
  });

  it('409s cleanly (not a raw Postgres error) when the admin-chosen name collides with an existing category', async () => {
    const err = new QueryFailedError('query', [], new Error('duplicate key'));
    (err as unknown as { code: string }).code = UNIQUE_VIOLATION;
    em.save.mockRejectedValue(err);

    await expect(service.approve('admin-1', 'req-1', { name: 'ناخن‌کاری', icon: 'nail' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(em.update).not.toHaveBeenCalled();
  });

  it('rolls back (no cache invalidation) when a concurrent admin already resolved the request inside the transaction', async () => {
    em.update.mockResolvedValue({ affected: 0 });

    await expect(service.approve('admin-1', 'req-1', { name: 'ناخن‌کاری', icon: 'nail' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(redis.del).not.toHaveBeenCalled();
  });
});

describe('CategoryRequestsService.reject', () => {
  let service: CategoryRequestsService;
  let requests: { findOneBy: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    requests = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'req-1', status: 'pending' }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CategoryRequestsService,
        { provide: getRepositoryToken(CategoryRequest), useValue: requests },
        { provide: getRepositoryToken(ServiceCategory), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: AdminNotificationsService, useValue: { emit: jest.fn() } },
        { provide: REDIS, useValue: { del: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(CategoryRequestsService);
  });

  it('404s when the request does not exist', async () => {
    requests.findOneBy.mockResolvedValue(null);

    await expect(service.reject('admin-1', 'req-1', { note: 'دلیل رد' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409s (a real, typed conflict) when a concurrent admin already resolved it, via the conditional update losing the race', async () => {
    requests.update.mockResolvedValue({ affected: 0 });

    await expect(service.reject('admin-1', 'req-1', { note: 'دلیل رد' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('records the resolution note, resolver, and timestamp', async () => {
    requests.findOneBy.mockResolvedValueOnce({ id: 'req-1', status: 'pending' }).mockResolvedValueOnce({
      id: 'req-1',
      status: 'rejected',
      resolutionNote: 'دلیل رد',
    });

    const result = await service.reject('admin-1', 'req-1', { note: 'دلیل رد' });

    expect(requests.update).toHaveBeenCalledWith(
      { id: 'req-1', status: 'pending' },
      expect.objectContaining({ status: 'rejected', resolutionNote: 'دلیل رد', resolvedBy: 'admin-1' }),
    );
    expect(result.resolutionNote).toBe('دلیل رد');
  });
});
