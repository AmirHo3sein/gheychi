import { Logger } from '@nestjs/common';
import { LoggerErrorTrackingService } from './logger-error-tracking.service';

describe('LoggerErrorTrackingService', () => {
  let service: LoggerErrorTrackingService;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new LoggerErrorTrackingService();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('logs one structured JSON line with the error message/name/stack and given context', () => {
    const error = new Error('booking lookup failed');

    service.captureException(error, { requestId: 'req-1', userId: 'u-1', route: 'GET /api/bookings/mine' });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [line] = errorSpy.mock.calls[0]!;
    const parsed = JSON.parse(line as string);
    expect(parsed).toMatchObject({
      message: 'booking lookup failed',
      name: 'Error',
      requestId: 'req-1',
      userId: 'u-1',
      route: 'GET /api/bookings/mine',
    });
    expect(parsed.stack).toEqual(expect.stringContaining('Error: booking lookup failed'));
  });

  it('defaults every context field to undefined when no context is given', () => {
    service.captureException(new Error('boom'));

    const [line] = errorSpy.mock.calls[0]!;
    const parsed = JSON.parse(line as string);
    expect(parsed.requestId).toBeUndefined();
    expect(parsed.userId).toBeUndefined();
    expect(parsed.route).toBeUndefined();
    expect(parsed.extra).toBeUndefined();
  });

  it('wraps a non-Error thrown value in an Error before logging', () => {
    service.captureException('a plain string was thrown');

    const [line] = errorSpy.mock.calls[0]!;
    const parsed = JSON.parse(line as string);
    expect(parsed.message).toBe('a plain string was thrown');
    expect(parsed.name).toBe('Error');
  });

  it('redacts a known-sensitive field in `extra` even if a caller accidentally includes one', () => {
    service.captureException(new Error('payment failed'), {
      extra: { bookingId: 'b-1', jwt: 'eyJhbGciOiJIUzI1NiJ9.secretpayload.sig' },
    });

    const [line] = errorSpy.mock.calls[0]!;
    expect(line).not.toContain('eyJhbGciOiJIUzI1NiJ9.secretpayload.sig');
    const parsed = JSON.parse(line as string);
    expect(parsed.extra).toEqual({ bookingId: 'b-1', jwt: '[redacted]' });
  });
});
