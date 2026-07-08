import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { UsersService } from '../users/users.service';

function mockContext(cookies: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ cookies }) }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  it('throws ForbiddenException (not UnauthorizedException) for a suspended user with an otherwise-valid token', async () => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1' }) } as unknown as JwtService;
    const users = {
      findById: jest.fn().mockResolvedValue({ id: 'u1', status: 'suspended' }),
    } as unknown as UsersService;
    const guard = new AuthGuard(jwt, users);

    await expect(guard.canActivate(mockContext({ session: 'valid-token' }))).rejects.toThrow(ForbiddenException);
  });

  it('still throws UnauthorizedException for a missing/invalid token', async () => {
    const jwt = { verifyAsync: jest.fn().mockRejectedValue(new Error('bad token')) } as unknown as JwtService;
    const users = {} as UsersService;
    const guard = new AuthGuard(jwt, users);

    await expect(guard.canActivate(mockContext({ session: 'garbage' }))).rejects.toThrow(UnauthorizedException);
  });
});
