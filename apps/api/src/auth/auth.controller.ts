import {
  Body, Controller, Get, HttpCode, Inject, Patch, Post, Req, Res, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
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
  constructor(
    private readonly otp: OtpService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  @Post('request-otp')
  async requestOtp(@Body() dto: RequestOtpDto) {
    const code = await this.otp.issue(dto.phone);
    await this.sms.sendOtp(dto.phone, code);
    return { ok: true };
  }

  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto, @Res({ passthrough: true }) res: Response) {
    const valid = await this.otp.verify(dto.phone, dto.code);
    if (!valid) throw new UnauthorizedException('Invalid or expired code');

    const { user, isNew } = await this.users.findOrCreateByPhone(dto.phone);
    const token = await this.jwt.signAsync({ sub: user.id, role: user.role });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: THIRTY_DAYS_MS,
    });
    return { user: publicUser(user), isNewUser: isNew };
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
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE);
  }
}
