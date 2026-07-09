import { Between, In, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { AuditLog } from './audit-log.entity';
import { AuditService } from './audit.service';

function makeService(overrides?: {
  logs?: { findAndCount: jest.Mock };
  users?: { find: jest.Mock };
}) {
  const logs = {
    insert: jest.fn(),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    ...overrides?.logs,
  };
  const users = overrides?.users ?? { find: jest.fn().mockResolvedValue([]) };
  const service = new AuditService(
    logs as unknown as Repository<AuditLog>,
    users as unknown as Repository<User>,
  );
  return { service, logs, users };
}

describe('AuditService.listForAdmin', () => {
  it('defaults to page 1 / pageSize 20, newest first, with no filters', async () => {
    const { service, logs, users } = makeService();

    const result = await service.listForAdmin({});

    expect(logs.findAndCount).toHaveBeenCalledWith({
      where: {},
      order: { createdAt: 'DESC' },
      skip: 0,
      take: 20,
    });
    expect(users.find).not.toHaveBeenCalled();
    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('applies actorId/action/targetType/from/to filters and explicit paging', async () => {
    const { service, logs } = makeService();

    await service.listForAdmin({
      actorId: 'u1',
      action: 'salon.status.set',
      targetType: 'salon',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
      page: 3,
      pageSize: 50,
    });

    expect(logs.findAndCount).toHaveBeenCalledWith({
      where: {
        actorId: 'u1',
        action: 'salon.status.set',
        targetType: 'salon',
        createdAt: Between(new Date('2026-01-01T00:00:00.000Z'), new Date('2026-02-01T00:00:00.000Z')),
      },
      order: { createdAt: 'DESC' },
      skip: 100,
      take: 50,
    });
  });

  it('joins actor phone/name onto each item via a second IN lookup', async () => {
    const row = {
      id: 'log-1',
      actorId: 'u1',
      action: 'salon.status.set',
      targetType: 'salon',
      targetId: 's1',
      payload: { status: 'approved' },
      success: true,
      createdAt: new Date('2026-07-10T10:00:00.000Z'),
    };
    const { service, users } = makeService({
      logs: { findAndCount: jest.fn().mockResolvedValue([[row], 1]) },
      users: { find: jest.fn().mockResolvedValue([{ id: 'u1', phone: '09121112233', name: 'مدیر سامانه' }]) },
    });

    const result = await service.listForAdmin({});

    expect(users.find).toHaveBeenCalledWith({ where: { id: In(['u1']) }, select: ['id', 'phone', 'name'] });
    expect(result.items[0]).toEqual({ ...row, actorPhone: '09121112233', actorName: 'مدیر سامانه' });
    expect(result.total).toBe(1);
  });

  it('returns null actor fields when the actor row cannot be found', async () => {
    const row = {
      id: 'log-2',
      actorId: 'ghost',
      action: 'config.update',
      targetType: 'config',
      targetId: null,
      payload: null,
      success: true,
      createdAt: new Date('2026-07-10T11:00:00.000Z'),
    };
    const { service } = makeService({
      logs: { findAndCount: jest.fn().mockResolvedValue([[row], 1]) },
    });

    const result = await service.listForAdmin({});

    expect(result.items[0].actorPhone).toBeNull();
    expect(result.items[0].actorName).toBeNull();
  });
});
