import {
  Body, Controller, ForbiddenException, Get, HttpCode, Inject, Logger, Patch, Post, Req, Res, UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { AnalyticsService } from '../analytics/analytics.service';
import { ReferralApplyStatus, ReferralsService } from '../referrals/referrals.service';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { SESSION_COOKIE } from './auth.guard';
import { RequestOtpDto, UpdateProfileDto, VerifyOtpDto } from './dto/auth.dto';
import { OtpService } from './otp.service';
import { Public } from './public.decorator';
import { SessionRevocationService } from './session-revocation.service';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function publicUser(user: User) {
  const { id, phone, name, gender, role } = user;
  return { id, phone, name, gender, role };
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly otp: OtpService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly referrals: ReferralsService,
    private readonly dataSource: DataSource,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    // Appended at the end, same convention as BookingsService/PaymentsService's own
    // constructors -- every existing positional `new AuthController(...)` call site
    // only needs an arg added at the tail, not threaded through the middle.
    private readonly analytics: AnalyticsService,
    private readonly revocations: SessionRevocationService,
  ) {}

  @Post('request-otp')
  @Public()
  async requestOtp(@Body() dto: RequestOtpDto, @Req() req: Request) {
    const { code, expiresInSec, resendsRemaining } = await this.otp.issue(dto.phone, req.ip ?? 'unknown');
    await this.sms.sendOtp(dto.phone, code);
    // expiresInSec/resendsRemaining let the login screens show an honest expiry countdown
    // and warn before the last allowed resend, instead of each hardcoding its own guess.
    return { ok: true, expiresInSec, resendsRemaining };
  }

  @Post('verify-otp')
  @Public()
  async verifyOtp(@Body() dto: VerifyOtpDto, @Res({ passthrough: true }) res: Response, @Req() req: Request) {
    const valid = await this.otp.verify(dto.phone, dto.code, req.ip ?? 'unknown');
    if (!valid) throw new UnauthorizedException('Invalid or expired code');

    let user: User;
    let isNew: boolean;
    let referralStatus: ReferralApplyStatus | undefined;

    if (dto.referralCode) {
      // Wrapped in one transaction so the new user row and its referral redemption
      // commit atomically -- ReferralsService.applyReferralAtRegistration relies on
      // running inside this same transaction (spec section 3/4).
      const result = await this.dataSource.transaction(async (em) => {
        const created = await this.users.findOrCreateByPhone(dto.phone, em);
        let status: ReferralApplyStatus | undefined;

        if (created.isNew) {
          // referralCode is only ever read here, structurally unreachable for an
          // existing account (R2). A SAVEPOINT wraps the ENTIRE call (not just the
          // service's own internal insert) so that literally any unexpected failure
          // inside referral resolution -- not just the one unique-violation race the
          // service itself handles -- rolls back cleanly without poisoning this
          // transaction. Registration must NEVER fail because of a referral-code
          // problem (spec section 4).
          await em.query('SAVEPOINT registration_referral');
          try {
            const applied = await this.referrals.applyReferralAtRegistration(created.user.id, dto.referralCode!, em);
            status = applied.status;
            await em.query('RELEASE SAVEPOINT registration_referral');
          } catch (err) {
            await em.query('ROLLBACK TO SAVEPOINT registration_referral');
            this.logger.error(
              `Referral code application failed for new user ${created.user.id}: ` +
                (err instanceof Error ? err.message : String(err)),
            );
            status = 'invalid_code';
          }
        }

        return { ...created, referralStatus: status };
      });
      user = result.user;
      isNew = result.isNew;
      referralStatus = result.referralStatus;
    } else {
      const created = await this.users.findOrCreateByPhone(dto.phone);
      user = created.user;
      isNew = created.isNew;
    }

    // Fires only for a genuinely brand-new row (isNew), never on a returning user's
    // login -- the account row (and, when present, its referral redemption) has
    // already committed above, so this is reporting something that truly happened,
    // same "already committed, cannot fail the request" guarantee as
    // BookingsService's booking_cancelled call. Best-effort and never awaited: an
    // analytics outage must add zero latency/failure risk to registration. No PII:
    // role is an enum and hasReferralCode is a boolean, never the phone or the code
    // itself.
    if (isNew) {
      void this.analytics
        .track('user_registered', { role: user.role, hasReferralCode: Boolean(dto.referralCode) }, { userId: user.id })
        .catch(() => {});
    }

    if (user.status === 'suspended') throw new ForbiddenException('This account has been suspended');
    // `jti` makes this specific session revocable (see SessionRevocationService) -- without
    // one, logout could only clear the caller's own cookie and a copied token stayed live
    // for its full 30 days.
    const token = await this.jwt.signAsync({ sub: user.id, role: user.role, jti: randomUUID() });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: THIRTY_DAYS_MS,
    });
    return {
      user: publicUser(user),
      isNewUser: isNew,
      ...(referralStatus !== undefined ? { referralStatus } : {}),
    };
  }

  @Get('me')
  me(@Req() req: Request) {
    return publicUser(req.user as User);
  }

  @Patch('profile')
  async updateProfile(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    const updated = await this.users.updateProfile((req.user as User).id, dto);
    return publicUser(updated);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Clearing the cookie only ends the session in THIS browser. Revoking the token's own
    // jti is what actually ends it everywhere -- the point of logging out on a shared or
    // stolen device. Decoded rather than re-verified: the request already passed AuthGuard,
    // and a token we cannot decode is one there is nothing to revoke for.
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const payload = this.jwt.decode(token) as { jti?: string; exp?: number } | null;
      if (payload?.jti && payload.exp) {
        await this.revocations.revoke(payload.jti, payload.exp);
      }
    }
    res.clearCookie(SESSION_COOKIE);
  }
}
