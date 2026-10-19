import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PushSubscription } from './push-subscription.entity';
import { PUSH_PROVIDER, PushAudience, PushPayload, PushProvider } from './push.provider';

@Injectable()
export class PushService {
  constructor(
    @InjectRepository(PushSubscription) private readonly subs: Repository<PushSubscription>,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
  ) {}

  /** `audience` picks the app: a customer's own notifications vs. their salon's (owner). */
  async sendToUser(userId: string, payload: PushPayload, audience: PushAudience = 'customer'): Promise<void> {
    const subscriptions = await this.subs.find({ where: { userId, audience } });
    // Best-effort, per the design spec's error-handling section: a push failure on one
    // device (or all of them) never throws back to the caller.
    await Promise.all(subscriptions.map((s) => this.provider.send(s, payload).catch(() => {})));
  }
}
