import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function mockContext(user: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardWithRequiredRoles(required: string[] | undefined): RolesGuard {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('passes through when the route has no @Roles() metadata at all', () => {
    const guard = guardWithRequiredRoles(undefined);
    expect(guard.canActivate(mockContext({ id: 'u1', role: 'customer' }))).toBe(true);
  });

  it('passes through when @Roles() was applied with an empty list', () => {
    const guard = guardWithRequiredRoles([]);
    expect(guard.canActivate(mockContext({ id: 'u1', role: 'customer' }))).toBe(true);
  });

  it('passes a caller whose role is in the required list', () => {
    const guard = guardWithRequiredRoles(['admin']);
    expect(guard.canActivate(mockContext({ id: 'u1', role: 'admin' }))).toBe(true);
  });

  it('throws ForbiddenException for a caller whose role is not in the required list', () => {
    const guard = guardWithRequiredRoles(['admin']);
    expect(() => guard.canActivate(mockContext({ id: 'u1', role: 'customer' }))).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when the route requires a role but the request has no user at all', () => {
    const guard = guardWithRequiredRoles(['admin']);
    expect(() => guard.canActivate(mockContext(undefined))).toThrow(ForbiddenException);
  });
});
