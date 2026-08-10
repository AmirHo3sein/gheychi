import { Injectable, Logger } from '@nestjs/common';
import { AnalyticsEvent, AnalyticsProvider } from './analytics.provider';

// The default (and, in this environment, only) AnalyticsProvider -- there is no real
// analytics vendor account to send events to, so this simply makes every tracked
// event observable in the logs as structured JSON, exactly like ConsoleSmsProvider/
// ConsolePushProvider stand in for their own real vendors. Never throws: a logging
// call failing is not something AnalyticsService's callers should ever see either.
@Injectable()
export class ConsoleAnalyticsProvider implements AnalyticsProvider {
  private readonly logger = new Logger('Analytics');

  async track(event: AnalyticsEvent): Promise<void> {
    this.logger.log(JSON.stringify(event));
  }
}
