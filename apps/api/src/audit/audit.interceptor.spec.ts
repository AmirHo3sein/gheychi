import 'reflect-metadata';
import { ExecutionContext, Logger, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { AuditLog } from './audit-log.entity';
import { AUDIT_ACTION, AuditAction } from './audit.decorator';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';

function mockContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => function handler() {},
    getClass: () => class Host {},
  } as unknown as ExecutionContext;
}

describe('AuditAction decorator', () => {
  it('stores { action, targetType } under the AUDIT_ACTION key on the handler', () => {
    class Dummy {
      @AuditAction('salon.status.set', 'salon')
      handler() {
        return 1;
      }
    }
    expect(Reflect.getMetadata(AUDIT_ACTION, Dummy.prototype.handler)).toEqual({
      action: 'salon.status.set',
      targetType: 'salon',
    });
  });
});

describe('AuditInterceptor', () => {
  let record: jest.Mock;
  let audit: AuditService;

  beforeEach(() => {
    record = jest.fn().mockResolvedValue(undefined);
    audit = { record } as unknown as AuditService;
  });

  function reflectorReturning(meta: unknown): Reflector {
    return { getAllAndOverride: jest.fn().mockReturnValue(meta) } as unknown as Reflector;
  }

  it('passes through untouched and records nothing when the handler has no @AuditAction metadata', async () => {
    const interceptor = new AuditInterceptor(reflectorReturning(undefined), audit);

    const result = await lastValueFrom(
      interceptor.intercept(mockContext({}), { handle: () => of('unchanged') }),
    );

    expect(result).toBe('unchanged');
    expect(record).not.toHaveBeenCalled();
  });

  it('records a success row with actor, target and payload after the handler resolves', async () => {
    const interceptor = new AuditInterceptor(
      reflectorReturning({ action: 'salon.status.set', targetType: 'salon' }),
      audit,
    );
    const req = { user: { id: 'admin-1' }, params: { id: 'salon-9' }, body: { status: 'approved' } };

    const result = await lastValueFrom(
      interceptor.intercept(mockContext(req), { handle: () => of({ id: 'salon-9' }) }),
    );

    expect(result).toEqual({ id: 'salon-9' });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      actorId: 'admin-1',
      action: 'salon.status.set',
      targetType: 'salon',
      targetId: 'salon-9',
      payload: { status: 'approved' },
      success: true,
    });
  });

  it('records success: false and rethrows the original error when the handler rejects', async () => {
    const interceptor = new AuditInterceptor(
      reflectorReturning({ action: 'salon.status.set', targetType: 'salon' }),
      audit,
    );
    const req = { user: { id: 'admin-1' }, params: { id: 'missing' }, body: { status: 'approved' } };

    await expect(
      lastValueFrom(
        interceptor.intercept(mockContext(req), { handle: () => throwError(() => new NotFoundException()) }),
      ),
    ).rejects.toThrow(NotFoundException);

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      actorId: 'admin-1',
      action: 'salon.status.set',
      targetType: 'salon',
      targetId: 'missing',
      payload: { status: 'approved' },
      success: false,
    });
  });

  it('records targetId: null and the raw body as payload for routes without an :id param', async () => {
    const interceptor = new AuditInterceptor(
      reflectorReturning({ action: 'config.update', targetType: 'config' }),
      audit,
    );
    const req = {
      user: { id: 'admin-1' },
      params: {},
      body: { updates: [{ key: 'commission_percent', value: 12 }] },
    };

    await lastValueFrom(interceptor.intercept(mockContext(req), { handle: () => of([]) }));

    expect(record).toHaveBeenCalledWith({
      actorId: 'admin-1',
      action: 'config.update',
      targetType: 'config',
      targetId: null,
      payload: { updates: [{ key: 'commission_percent', value: 12 }] },
      success: true,
    });
  });

  it('awaits the audit insert before emitting the response (pins the not-fire-and-forget invariant)', async () => {
    const order: string[] = [];
    let resolveInsert!: () => void;
    record.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveInsert = resolve;
        }).then(() => {
          order.push('recorded');
        }),
    );
    const interceptor = new AuditInterceptor(
      reflectorReturning({ action: 'salon.status.set', targetType: 'salon' }),
      audit,
    );
    const req = { user: { id: 'admin-1' }, params: { id: 'salon-9' }, body: { status: 'approved' } };

    const emission = lastValueFrom(
      interceptor.intercept(mockContext(req), { handle: () => of({ id: 'salon-9' }) }),
    ).then((result) => {
      order.push('emitted');
      return result;
    });

    // Let the interceptor reach the pending insert; the response must still be held back.
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual([]);

    resolveInsert();
    await expect(emission).resolves.toEqual({ id: 'salon-9' });
    expect(order).toEqual(['recorded', 'emitted']);
  });

  it('awaits the failure audit insert before the rethrown error reaches the subscriber', async () => {
    const order: string[] = [];
    let resolveInsert!: () => void;
    record.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveInsert = resolve;
        }).then(() => {
          order.push('recorded');
        }),
    );
    const interceptor = new AuditInterceptor(
      reflectorReturning({ action: 'salon.status.set', targetType: 'salon' }),
      audit,
    );
    const req = { user: { id: 'admin-1' }, params: { id: 'missing' }, body: { status: 'approved' } };

    const settled = lastValueFrom(
      interceptor.intercept(mockContext(req), { handle: () => throwError(() => new NotFoundException()) }),
    ).catch((err: unknown) => {
      order.push('errored');
      return err;
    });

    // Let the interceptor reach the pending insert; the error must still be held back.
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual([]);

    resolveInsert();
    await expect(settled).resolves.toBeInstanceOf(NotFoundException);
    expect(order).toEqual(['recorded', 'errored']);
  });
});

describe('AuditService.record', () => {
  it('inserts the row as given on the happy path', async () => {
    const repo = { insert: jest.fn().mockResolvedValue(undefined) };
    const service = new AuditService(
      repo as unknown as Repository<AuditLog>,
      { find: jest.fn() } as unknown as Repository<User>,
    );

    await service.record({
      actorId: 'admin-1',
      action: 'config.update',
      targetType: 'config',
      targetId: null,
      payload: { updates: [] },
      success: true,
    });

    expect(repo.insert).toHaveBeenCalledWith({
      actorId: 'admin-1',
      action: 'config.update',
      targetType: 'config',
      targetId: null,
      payload: { updates: [] },
      success: true,
    });
  });

  it('swallows insert failures (logger.error, no throw) so audit can never break the admin request', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const repo = { insert: jest.fn().mockRejectedValue(new Error('db down')) };
    const service = new AuditService(
      repo as unknown as Repository<AuditLog>,
      { find: jest.fn() } as unknown as Repository<User>,
    );

    await expect(
      service.record({
        actorId: 'admin-1',
        action: 'salon.status.set',
        targetType: 'salon',
        targetId: 's1',
        payload: { status: 'approved' },
        success: true,
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
