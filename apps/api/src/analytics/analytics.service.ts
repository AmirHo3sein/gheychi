import { Inject, Injectable } from '@nestjs/common';
import { ANALYTICS_PROVIDER, AnalyticsProvider } from './analytics.provider';

export interface AnalyticsContext {
  userId?: string;
  requestId?: string;
}

/**
 * The one seam every product/business-logic call site talks to for product
 * analytics -- never a provider or a vendor SDK directly (see AnalyticsProvider's
 * own doc comment for the vendor-swap story). Mirrors PushService's own shape:
 * a thin service that injects the provider token and normalizes the call.
 *
 * `properties` must never carry a phone number, payment authority, JWT, OTP, or any
 * other credential/PII -- a bare id reference (userId, bookingId, salonId, ...) is
 * fine, the value itself never is. This is a call-site discipline, not something
 * this class can enforce mechanically, so review it at every new call site.
 */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(ANALYTICS_PROVIDER) private readonly provider: AnalyticsProvider) {}

  async track(event: string, properties: Record<string, unknown> = {}, context: AnalyticsContext = {}): Promise<void> {
    await this.provider.track({
      name: event,
      properties,
      userId: context.userId,
      requestId: context.requestId,
      timestamp: new Date(),
    });
  }
}
