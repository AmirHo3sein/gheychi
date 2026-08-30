import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AnalyticsEventRecord } from './analytics-event.entity';
import { PostgresAnalyticsProvider } from './postgres-analytics.provider';

function makeProvider(overrides?: { insert?: jest.Mock }) {
  const events = { insert: jest.fn().mockResolvedValue(undefined), ...overrides };
  const provider = new PostgresAnalyticsProvider(events as unknown as Repository<AnalyticsEventRecord>);
  return { provider, events };
}

describe('PostgresAnalyticsProvider', () => {
  it('inserts one row mapping name/properties/userId/timestamp onto the analytics_events columns, lifting salonId out of properties too', async () => {
    const { provider, events } = makeProvider();
    const timestamp = new Date('2026-08-10T12:00:00.000Z');

    await provider.track({
      name: 'booking_started',
      properties: { salonId: 'salon-1', serviceId: 'service-1' },
      userId: 'user-1',
      requestId: 'req-1',
      timestamp,
    });

    expect(events.insert).toHaveBeenCalledWith({
      eventName: 'booking_started',
      properties: { salonId: 'salon-1', serviceId: 'service-1' },
      userId: 'user-1',
      salonId: 'salon-1',
      createdAt: timestamp,
    });
  });

  it('defaults properties to null, userId to null, and salonId to null when absent -- requestId is never persisted', async () => {
    const { provider, events } = makeProvider();
    const timestamp = new Date('2026-08-10T12:00:00.000Z');

    await provider.track({ name: 'search_performed', properties: {}, timestamp });

    const inserted = events.insert.mock.calls[0][0];
    expect(inserted.userId).toBeNull();
    expect(inserted.salonId).toBeNull();
    expect(inserted).not.toHaveProperty('requestId');
  });

  it('does not mistake a non-string salonId (or any other stray shape) in properties for a real one', async () => {
    const { provider, events } = makeProvider();

    await provider.track({ name: 'weird_event', properties: { salonId: 12345 }, timestamp: new Date() });

    expect(events.insert.mock.calls[0][0].salonId).toBeNull();
  });

  it('swallows an insert failure instead of throwing -- an analytics outage must never break the real operation', async () => {
    const { provider, events } = makeProvider({ insert: jest.fn().mockRejectedValue(new Error('connection refused')) });

    await expect(
      provider.track({ name: 'booking_started', properties: {}, timestamp: new Date() }),
    ).resolves.toBeUndefined();
  });

  it('logs the failure through Nest Logger on insert failure', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { provider } = makeProvider({ insert: jest.fn().mockRejectedValue(new Error('connection refused')) });

    await provider.track({ name: 'payment_succeeded', properties: {}, timestamp: new Date() });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist analytics event payment_succeeded: connection refused'),
      expect.any(String),
    );
    errorSpy.mockRestore();
  });
});
