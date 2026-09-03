import { Body, Controller, Delete, ForbiddenException, HttpCode, Post, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { User } from '../users/user.entity';
import { SubscribePushDto, UnsubscribePushDto } from './dto/push.dto';
import { PushSubscription } from './push-subscription.entity';

@Controller('push')
export class PushController {
  constructor(
    @InjectRepository(PushSubscription) private readonly subs: Repository<PushSubscription>,
  ) {}

  @Post('subscribe')
  async subscribe(@Req() req: Request, @Body() dto: SubscribePushDto) {
    const userId = (req.user as User).id;
    const existing = await this.subs.findOneBy({ endpoint: dto.endpoint });
    if (existing) {
      // Re-pointing an endpoint to a DIFFERENT user is refused. A browser push endpoint is
      // an opaque, unguessable URL, but it is not a secret the way a token is -- it is
      // handed to whatever page holds the subscription. Allowing a re-point meant anyone
      // who learned another user's endpoint could claim it: the victim silently stopped
      // receiving push, and the attacker's notifications landed on the victim's device.
      // The legitimate case this used to serve -- the same person re-subscribing on the
      // same device -- is unaffected, since the userId matches.
      if (existing.userId !== userId) throw new ForbiddenException();
      await this.subs.update({ endpoint: dto.endpoint }, { userId, p256dh: dto.p256dh, auth: dto.auth });
      return { ok: true };
    }
    try {
      await this.subs.save(this.subs.create({ userId, ...dto }));
    } catch (err) {
      // The pre-check above handles the common case, but the endpoint's UNIQUE
      // constraint is the actual source of truth -- two truly concurrent
      // subscribe calls for the same brand-new endpoint can both pass the check
      // above before either inserts. Fall back to the update the loser "meant"
      // to do rather than letting it surface as an unhandled 500.
      if (isUniqueViolation(err)) {
        await this.subs.update({ endpoint: dto.endpoint }, { userId, p256dh: dto.p256dh, auth: dto.auth });
      } else {
        throw err;
      }
    }
    return { ok: true };
  }

  @Delete('subscribe')
  @HttpCode(204)
  async unsubscribe(@Req() req: Request, @Body() dto: UnsubscribePushDto) {
    await this.subs.delete({ endpoint: dto.endpoint, userId: (req.user as User).id });
  }
}
