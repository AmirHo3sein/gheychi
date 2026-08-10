import { Logger } from '@nestjs/common';
import { ConsoleAnalyticsProvider } from './console-analytics.provider';

describe('ConsoleAnalyticsProvider', () => {
  it('logs the event as structured JSON carrying name, properties, userId, requestId, and timestamp', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const provider = new ConsoleAnalyticsProvider();
    const timestamp = new Date('2026-08-10T12:00:00.000Z');

    await provider.track({
      name: 'booking_started',
      properties: { salonId: 'salon-1', serviceId: 'service-1' },
      userId: 'user-1',
      requestId: 'req-1',
      timestamp,
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [logged] = logSpy.mock.calls[0] as [string];
    expect(JSON.parse(logged)).toEqual({
      name: 'booking_started',
      properties: { salonId: 'salon-1', serviceId: 'service-1' },
      userId: 'user-1',
      requestId: 'req-1',
      timestamp: timestamp.toISOString(),
    });

    logSpy.mockRestore();
  });

  it('logs cleanly with no userId/requestId (context is optional)', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const provider = new ConsoleAnalyticsProvider();
    const timestamp = new Date('2026-08-10T12:00:00.000Z');

    await provider.track({ name: 'booking_started', properties: {}, timestamp });

    const [logged] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(logged) as Record<string, unknown>;
    expect(parsed.name).toBe('booking_started');
    expect(parsed.userId).toBeUndefined();
    expect(parsed.requestId).toBeUndefined();

    logSpy.mockRestore();
  });
});
