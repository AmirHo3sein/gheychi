import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { SessionRevocationService } from './session-revocation.service';
import { UsersService } from '../users/users.service';

function mockContext(cookies: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ cookies }) }),
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
  } as unknown as ExecutionContext;
}

function mockReflector(isPublic = false): Reflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(isPublic) } as unknown as Reflector;
}

// A revocation service that says "not revoked" -- the default state for every session that
// has not been logged out. The revoked path has its own dedicated tests below.
function notRevoked() {
  return { isRevoked: jest.fn().mockResolvedValue(false), revoke: jest.fn() } as unknown as SessionRevocationService;
}

describe('AuthGuard', () => {
  it('throws ForbiddenException (not UnauthorizedException) for a suspended user with an otherwise-valid token', async () => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1' }) } as unknown as JwtService;
    const users = {
      findById: jest.fn().mockResolvedValue({ id: 'u1', status: 'suspended' }),
    } as unknown as UsersService;
    const guard = new AuthGuard(jwt, users, mockReflector(), notRevoked());

    await expect(guard.canActivate(mockContext({ session: 'valid-token' }))).rejects.toThrow(ForbiddenException);
  });

  it('rejects a token whose jti has been revoked, without even loading the user', async () => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1', jti: 'jti-1' }) } as unknown as JwtService;
    const users = { findById: jest.fn() } as unknown as UsersService;
    const revocations = { isRevoked: jest.fn().mockResolvedValue(true), revoke: jest.fn() } as unknown as SessionRevocationService;
    const guard = new AuthGuard(jwt, users, mockReflector(), revocations);

    await expect(guard.canActivate(mockContext({ session: 'revoked-token' }))).rejects.toThrow(UnauthorizedException);
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('accepts a legacy token minted before jti existed -- deploying revocation must not log everyone out', async () => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1' }) } as unknown as JwtService;
    const users = { findById: jest.fn().mockResolvedValue({ id: 'u1', status: 'active' }) } as unknown as UsersService;
    const revocations = { isRevoked: jest.fn(), revoke: jest.fn() } as unknown as SessionRevocationService;
    const guard = new AuthGuard(jwt, users, mockReflector(), revocations);

    await expect(guard.canActivate(mockContext({ session: 'legacy-token' }))).resolves.toBe(true);
    expect(revocations.isRevoked).not.toHaveBeenCalled();
  });

  it('refuses the request when the revocation check itself fails (fail-closed, never fail-open)', async () => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1', jti: 'jti-1' }) } as unknown as JwtService;
    const users = { findById: jest.fn() } as unknown as UsersService;
    const revocations = { isRevoked: jest.fn().mockRejectedValue(new Error('redis down')), revoke: jest.fn() } as unknown as SessionRevocationService;
    const guard = new AuthGuard(jwt, users, mockReflector(), revocations);

    await expect(guard.canActivate(mockContext({ session: 'token' }))).rejects.toThrow(UnauthorizedException);
  });

  it('still throws UnauthorizedException for a missing/invalid token', async () => {
    const jwt = { verifyAsync: jest.fn().mockRejectedValue(new Error('bad token')) } as unknown as JwtService;
    const users = {} as UsersService;
    const guard = new AuthGuard(jwt, users, mockReflector(), notRevoked());

    await expect(guard.canActivate(mockContext({ session: 'garbage' }))).rejects.toThrow(UnauthorizedException);
  });

  it('skips the auth check entirely and returns true when @Public() metadata is present', async () => {
    const jwt = { verifyAsync: jest.fn() } as unknown as JwtService;
    const users = { findById: jest.fn() } as unknown as UsersService;
    const reflector = mockReflector(true);
    const guard = new AuthGuard(jwt, users, reflector, notRevoked());

    await expect(guard.canActivate(mockContext({}))).resolves.toBe(true);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
    expect(users.findById).not.toHaveBeenCalled();
  });
});
