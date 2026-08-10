import { AnalyticsService } from './analytics.service';
import { AnalyticsProvider } from './analytics.provider';

describe('AnalyticsService', () => {
  it('normalizes event/properties/context into the provider event shape, defaulting properties and context', async () => {
    const track = jest.fn().mockResolvedValue(undefined);
    const provider: AnalyticsProvider = { track };
    const service = new AnalyticsService(provider);

    await service.track('booking_started', { salonId: 'salon-1' }, { userId: 'user-1', requestId: 'req-1' });

    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'booking_started',
        properties: { salonId: 'salon-1' },
        userId: 'user-1',
        requestId: 'req-1',
        timestamp: expect.any(Date),
      }),
    );
  });

  it('defaults properties to {} and context fields to undefined when omitted', async () => {
    const track = jest.fn().mockResolvedValue(undefined);
    const provider: AnalyticsProvider = { track };
    const service = new AnalyticsService(provider);

    await service.track('booking_cancelled');

    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'booking_cancelled', properties: {}, userId: undefined, requestId: undefined }),
    );
  });

  it('propagates a provider failure to its own caller -- callers are responsible for the fire-and-forget .catch(() => {})', async () => {
    const track = jest.fn().mockRejectedValue(new Error('vendor down'));
    const provider: AnalyticsProvider = { track };
    const service = new AnalyticsService(provider);

    await expect(service.track('booking_started')).rejects.toThrow('vendor down');
  });
});
