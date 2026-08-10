import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { IS_PUBLIC_KEY } from './public.decorator';

export const SESSION_COOKIE = 'session';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Registered globally via APP_GUARD (app.module.ts) -- runs on every route by default,
    // so a route must opt OUT explicitly with @Public() rather than opting in with
    // @UseGuards(AuthGuard). Checked first, before touching the request at all, so a
    // public route never even looks at the session cookie.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync(token);
      const user = await this.users.findById(payload.sub);
      if (!user) throw new UnauthorizedException();
      if (user.status === 'suspended') throw new ForbiddenException('This account has been suspended');
      req.user = user;
      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      throw new UnauthorizedException();
    }
  }
}
