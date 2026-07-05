import { Injectable, Logger } from '@nestjs/common';
import { PushPayload, PushProvider, PushTarget } from './push.provider';

@Injectable()
export class ConsolePushProvider implements PushProvider {
  private readonly logger = new Logger('Push');

  async send(target: PushTarget, payload: PushPayload): Promise<void> {
    this.logger.log(`Push to ${target.endpoint}: ${payload.title} — ${payload.body}`);
  }
}
