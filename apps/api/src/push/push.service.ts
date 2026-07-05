import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PushSubscription } from './push-subscription.entity';
import { PUSH_PROVIDER, PushPayload, PushProvider } from './push.provider';

@Injectable()
export class PushService {
  constructor(
    @InjectRepository(PushSubscription) private readonly subs: Repository<PushSubscription>,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
  ) {}

  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    const subscriptions = await this.subs.find({ where: { userId } });
    // Best-effort, per the design spec's error-handling section: a push failure on one
    // device (or all of them) never throws back to the caller.
    await Promise.all(subscriptions.map((s) => this.provider.send(s, payload).catch(() => {})));
  }
}
