import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AdminNotification } from './admin-notification.entity';
import { AdminNotificationsService } from './admin-notifications.service';

const ADMIN_ID = 'admin-1';

describe('AdminNotificationsService', () => {
  let service: AdminNotificationsService;
  let repo: { insert: jest.Mock; findOneBy: jest.Mock };
  let query: jest.Mock;

  beforeEach(async () => {
    repo = { insert: jest.fn(), findOneBy: jest.fn() };
    query = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminNotificationsService,
        { provide: getRepositoryToken(AdminNotification), useValue: repo },
        { provide: DataSource, useValue: { query } },
      ],
    }).compile();
    service = moduleRef.get(AdminNotificationsService);
  });

  describe('emit', () => {
    it('inserts via its own repository when no manager is given', async () => {
      await service.emit('salon_resubmitted', 'عنوان اعلان', 'متن اعلان', '/salons/s1');
      expect(repo.insert).toHaveBeenCalledWith({
        type: 'salon_resubmitted',
        title: 'عنوان اعلان',
        body: 'متن اعلان',
        link: '/salons/s1',
      });
    });

    it('inserts through the provided EntityManager instead of its own repository', async () => {
      const managerInsert = jest.fn();
      const manager = {
        getRepository: jest.fn().mockReturnValue({ insert: managerInsert }),
      } as unknown as EntityManager;

      await service.emit('report_created', 'گزارش جدید ثبت شد', null, '/reports', manager);

      expect(manager.getRepository).toHaveBeenCalledWith(AdminNotification);
      expect(managerInsert).toHaveBeenCalledWith({
        type: 'report_created',
        title: 'گزارش جدید ثبت شد',
        body: null,
        link: '/reports',
      });
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('propagates insert failures to the caller (callers decide whether to swallow)', async () => {
      repo.insert.mockRejectedValueOnce(new Error('db down'));
      await expect(service.emit('salon_resubmitted', 'عنوان اعلان', null, null)).rejects.toThrow('db down');
    });
  });

  describe('unreadCount', () => {
    it('counts rows with no matching read for THIS admin', async () => {
      query.mockResolvedValue([{ count: 3 }]);

      await expect(service.unreadCount(ADMIN_ID)).resolves.toBe(3);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('r.read_at IS NULL'), [ADMIN_ID]);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('r.admin_id = $1'), [ADMIN_ID]);
    });
  });

  describe('list', () => {
    it('returns the standard envelope with default paging, scoped to the caller', async () => {
      query
        .mockResolvedValueOnce([{ id: 'n1', type: 't', title: 'T', body: null, link: null, created_at: new Date('2026-01-01'), read_at: null }])
        .mockResolvedValueOnce([{ count: 1 }]);

      const result = await service.list({}, ADMIN_ID);

      expect(result).toEqual({
        items: [{ id: 'n1', type: 't', title: 'T', body: null, link: null, readAt: null, createdAt: new Date('2026-01-01') }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      const [listSql, listParams] = query.mock.calls[0];
      expect(listSql).not.toContain('WHERE r.read_at IS NULL');
      expect(listParams).toEqual([ADMIN_ID, 20, 0]);
    });

    it('filters to unread rows when unread=true and applies paging', async () => {
      query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);

      await service.list({ unread: 'true', page: 2, pageSize: 10 }, ADMIN_ID);

      const [listSql, listParams] = query.mock.calls[0];
      expect(listSql).toContain('WHERE r.read_at IS NULL');
      expect(listParams).toEqual([ADMIN_ID, 10, 10]);
    });

    it("never lets one admin's read state leak into another admin's unread count", async () => {
      // The join is filtered on r.admin_id = $1 with $1 bound per-caller -- a read row
      // belonging to a DIFFERENT admin simply never matches this join, regardless of
      // how many other admins have read the same notification.
      query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 5 }]);

      await service.list({ unread: 'true' }, 'admin-2');

      expect(query.mock.calls[0][1][0]).toBe('admin-2');
    });
  });

  describe('markRead', () => {
    it('upserts a read row for THIS admin and returns the notification with readAt set', async () => {
      repo.findOneBy.mockResolvedValue({
        id: 'n1',
        type: 't',
        title: 'T',
        body: null,
        link: null,
        createdAt: new Date('2026-01-01'),
      });
      const readAt = new Date('2026-07-10T10:00:00Z');
      query.mockResolvedValue([{ read_at: readAt }]);

      const result = await service.markRead('n1', ADMIN_ID);

      expect(result.readAt).toBe(readAt);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (notification_id, admin_id)'), ['n1', ADMIN_ID]);
    });

    it('is idempotent: a second read by the same admin returns the original read_at unchanged', async () => {
      repo.findOneBy.mockResolvedValue({ id: 'n1', type: 't', title: 'T', body: null, link: null, createdAt: new Date() });
      const originalReadAt = new Date('2026-07-10T10:00:00Z');
      query.mockResolvedValue([{ read_at: originalReadAt }]);

      const result = await service.markRead('n1', ADMIN_ID);

      expect(result.readAt).toBe(originalReadAt);
    });

    it('404s on an unknown id', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.markRead('00000000-0000-0000-0000-000000000000', ADMIN_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('markAllRead', () => {
    it('inserts a read row for every notification not yet read by THIS admin', async () => {
      await service.markAllRead(ADMIN_ID);

      expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE NOT EXISTS'), [ADMIN_ID]);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('r.admin_id = $1'), [ADMIN_ID]);
    });
  });
});
