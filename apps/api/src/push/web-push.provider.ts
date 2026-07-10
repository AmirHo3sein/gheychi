import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { PushPayload, PushProvider, PushTarget } from './push.provider';

const PUSH_TIMEOUT_MS = 10_000;

@Injectable()
export class WebPushProvider implements PushProvider {
  private readonly logger = new Logger('Push');

  constructor(publicKey: string, privateKey: string, subject: string) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  async send(target: PushTarget, payload: PushPayload): Promise<void> {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        { timeout: PUSH_TIMEOUT_MS },
      );
    } catch (err) {
      this.logger.warn(`Push send failed for ${target.endpoint}: ${(err as Error).message}`);
      throw err;
    }
  }
}
