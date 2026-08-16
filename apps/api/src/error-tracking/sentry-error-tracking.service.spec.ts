import * as Sentry from '@sentry/node';
import { SentryErrorTrackingService } from './sentry-error-tracking.service';

jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
}));

describe('SentryErrorTrackingService', () => {
  const init = Sentry.init as jest.Mock;
  const captureException = Sentry.captureException as jest.Mock;

  beforeEach(() => {
    init.mockClear();
    captureException.mockClear();
  });

  it('initializes the SDK once, in the constructor, with tracing disabled and OTel setup skipped', () => {
    new SentryErrorTrackingService('https://key@sentry.example/1');

    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@sentry.example/1',
        tracesSampleRate: 0,
        skipOpenTelemetrySetup: true,
      }),
    );
  });

  it('forwards the error and maps requestId/route to tags, userId to a Sentry user', () => {
    const service = new SentryErrorTrackingService('https://key@sentry.example/1');
    const error = new Error('booking lookup failed');

    service.captureException(error, { requestId: 'req-1', userId: 'u-1', route: 'GET /api/bookings/mine' });

    expect(captureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        tags: { requestId: 'req-1', route: 'GET /api/bookings/mine' },
        user: { id: 'u-1' },
      }),
    );
  });

  it('wraps a non-Error thrown value in a real Error before forwarding it', () => {
    const service = new SentryErrorTrackingService('https://key@sentry.example/1');

    service.captureException('a plain string was thrown');

    const [forwarded] = captureException.mock.calls[0]!;
    expect(forwarded).toBeInstanceOf(Error);
    expect(forwarded.message).toBe('a plain string was thrown');
  });

  it('omits `user` entirely when no userId is given, rather than sending an empty object', () => {
    const service = new SentryErrorTrackingService('https://key@sentry.example/1');

    service.captureException(new Error('boom'));

    const [, hint] = captureException.mock.calls[0]!;
    expect(hint.user).toBeUndefined();
  });

  it('redacts a known-sensitive field in `extra` even if a caller accidentally includes one', () => {
    const service = new SentryErrorTrackingService('https://key@sentry.example/1');

    service.captureException(new Error('payment failed'), {
      extra: { bookingId: 'b-1', jwt: 'eyJhbGciOiJIUzI1NiJ9.secretpayload.sig' },
    });

    const [, hint] = captureException.mock.calls[0]!;
    expect(hint.extra).toEqual({ bookingId: 'b-1', jwt: '[redacted]' });
  });
});
