import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, IsNull } from 'typeorm';
import { AdminNotification } from './admin-notification.entity';
import { AdminNotificationsService } from './admin-notifications.service';

describe('AdminNotificationsService', () => {
  let service: AdminNotificationsService;
  let repo: {
    insert: jest.Mock;
    findAndCount: jest.Mock;
    countBy: jest.Mock;
    findOneBy: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      insert: jest.fn(),
      findAndCount: jest.fn(),
      countBy: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn((n) => n),
      update: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminNotificationsService,
        { provide: getRepositoryToken(AdminNotification), useValue: repo },
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
    it('counts only rows with no read_at', async () => {
      repo.countBy.mockResolvedValue(3);
      await expect(service.unreadCount()).resolves.toBe(3);
      expect(repo.countBy).toHaveBeenCalledWith({ readAt: IsNull() });
    });
  });

  describe('list', () => {
    it('returns the standard envelope with default paging', async () => {
      repo.findAndCount.mockResolvedValue([[{ id: 'n1' }], 1]);
      const result = await service.list({});
      expect(result).toEqual({ items: [{ id: 'n1' }], total: 1, page: 1, pageSize: 20 });
      expect(repo.findAndCount).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: 'DESC' },
        skip: 0,
        take: 20,
      });
    });

    it('filters to unread rows when unread=true and applies paging', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);
      await service.list({ unread: 'true', page: 2, pageSize: 10 });
      expect(repo.findAndCount).toHaveBeenCalledWith({
        where: { readAt: IsNull() },
        order: { createdAt: 'DESC' },
        skip: 10,
        take: 10,
      });
    });
  });

  describe('markRead', () => {
    it('stamps read_at on an unread notification', async () => {
      repo.findOneBy.mockResolvedValue({ id: 'n1', readAt: null });
      const result = await service.markRead('n1');
      expect(result.readAt).toBeInstanceOf(Date);
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('is idempotent: an already-read notification is returned unchanged without a write', async () => {
      const readAt = new Date('2026-07-10T10:00:00Z');
      repo.findOneBy.mockResolvedValue({ id: 'n1', readAt });
      const result = await service.markRead('n1');
      expect(result.readAt).toBe(readAt);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('404s on an unknown id', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.markRead('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('markAllRead', () => {
    it('stamps read_at on every unread row in one update', async () => {
      await service.markAllRead();
      expect(repo.update).toHaveBeenCalledWith({ readAt: IsNull() }, { readAt: expect.any(Date) });
    });
  });
});
