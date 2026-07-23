import { Controller, Get, HttpException, HttpStatus, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import Redis from 'ioredis';
import { AuthGuard } from '../auth/auth.guard';
import { REDIS } from '../redis/redis.module';
import { User } from '../users/user.entity';
import { PageQueryDto, ValidateCodeQueryDto } from './dto/referral.dto';
import { ReferralsService } from './referrals.service';

const VALIDATE_RATE_LIMIT_MAX = 20;
const VALIDATE_RATE_WINDOW_SEC = 3600;

@Controller('referrals')
export class ReferralsController {
  constructor(
    private readonly referrals: ReferralsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get('my-code')
  @UseGuards(AuthGuard)
  myCode(@Req() req: Request) {
    return this.referrals.getOrCreateMyCode((req.user as User).id);
  }

  // Deliberately public (no AuthGuard) -- someone entering a code at registration
  // isn't logged in yet. Otherwise cheap to enumerate codes (spec section 7), so it's
  // rate-limited by IP using the same Redis-backed idiom as OtpService.issue().
  @Get('validate')
  async validate(@Req() req: Request, @Query() query: ValidateCodeQueryDto) {
    const ip = req.ip ?? 'unknown';
    const rlKey = `referral:validate:rl:${ip}`;
    const count = await this.redis.incr(rlKey);
    if (count === 1) await this.redis.expire(rlKey, VALIDATE_RATE_WINDOW_SEC);
    if (count > VALIDATE_RATE_LIMIT_MAX) {
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.referrals.validateCode(query.code);
  }

  @Get('mine')
  @UseGuards(AuthGuard)
  mine(@Req() req: Request, @Query() query: PageQueryDto) {
    return this.referrals.listMine((req.user as User).id, query.page, query.pageSize);
  }

  @Get('mine/rewards')
  @UseGuards(AuthGuard)
  mineRewards(@Req() req: Request, @Query() query: PageQueryDto) {
    return this.referrals.getMyRewards((req.user as User).id, query.page, query.pageSize);
  }
}
