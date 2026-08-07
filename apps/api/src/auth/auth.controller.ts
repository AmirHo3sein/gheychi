import {
  Body, Controller, ForbiddenException, Get, HttpCode, Inject, Logger, Patch, Post, Req, Res, UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { ReferralApplyStatus, ReferralsService } from '../referrals/referrals.service';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthGuard, SESSION_COOKIE } from './auth.guard';
import { RequestOtpDto, UpdateProfileDto, VerifyOtpDto } from './dto/auth.dto';
import { OtpService } from './otp.service';

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
  ) {}

  @Post('request-otp')
  async requestOtp(@Body() dto: RequestOtpDto, @Req() req: Request) {
    const { code, expiresInSec, resendsRemaining } = await this.otp.issue(dto.phone, req.ip ?? 'unknown');
    await this.sms.sendOtp(dto.phone, code);
    // expiresInSec/resendsRemaining let the login screens show an honest expiry countdown
    // and warn before the last allowed resend, instead of each hardcoding its own guess.
    return { ok: true, expiresInSec, resendsRemaining };
  }

  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto, @Res({ passthrough: true }) res: Response) {
    const valid = await this.otp.verify(dto.phone, dto.code);
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

    if (user.status === 'suspended') throw new ForbiddenException('This account has been suspended');
    const token = await this.jwt.signAsync({ sub: user.id, role: user.role });
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
  @UseGuards(AuthGuard)
  me(@Req() req: Request) {
    return publicUser(req.user as User);
  }

  @Patch('profile')
  @UseGuards(AuthGuard)
  async updateProfile(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    const updated = await this.users.updateProfile((req.user as User).id, dto);
    return publicUser(updated);
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE);
  }
}
