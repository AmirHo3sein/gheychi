import { HttpException, HttpStatus } from '@nestjs/common';
import { BOOKING_CREATE_RATE_LIMIT_MAX, BOOKING_CREATE_RATE_WINDOW_SEC, BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

describe('BookingsController.create -- per-user rate limit', () => {
  let incr: jest.Mock;
  let expire: jest.Mock;
  let ttl: jest.Mock;
  let createHold: jest.Mock;
  let controller: BookingsController;
  const req = { user: { id: 'user-1' } } as never;
  const dto = { salonId: 's', serviceId: 'v', startsAt: '2030-01-01T00:00:00.000Z' };

  beforeEach(() => {
    incr = jest.fn().mockResolvedValue(1);
    expire = jest.fn().mockResolvedValue(1);
    ttl = jest.fn().mockResolvedValue(500);
    createHold = jest.fn().mockResolvedValue({ booking: { id: 'b1' } });
    controller = new BookingsController({ createHold } as unknown as BookingsService, { incr, expire, ttl } as never);
  });

  it('starts a per-user window on the first attempt and delegates', async () => {
    await expect(controller.create(req, dto)).resolves.toEqual({ booking: { id: 'b1' } });

    expect(incr).toHaveBeenCalledWith('booking:create:rl:user-1');
    expect(expire).toHaveBeenCalledWith('booking:create:rl:user-1', BOOKING_CREATE_RATE_WINDOW_SEC);
    expect(createHold).toHaveBeenCalledWith('user-1', dto);
  });

  it('does not reset the window on later attempts', async () => {
    incr.mockResolvedValue(2);

    await controller.create(req, dto);

    expect(expire).not.toHaveBeenCalled();
  });

  // INCR and EXPIRE are two calls: a crash between them leaves a counter that never expires, and
  // since later attempts skip EXPIRE that user would be locked out of booking permanently.
  it('repairs a counter that has no expiry so the user is never locked out forever', async () => {
    incr.mockResolvedValue(7);
    ttl.mockResolvedValue(-1);

    await controller.create(req, dto);

    expect(expire).toHaveBeenCalledWith('booking:create:rl:user-1', BOOKING_CREATE_RATE_WINDOW_SEC);
  });

  it('allows exactly the maximum, then answers 429 without creating anything', async () => {
    incr.mockResolvedValue(BOOKING_CREATE_RATE_LIMIT_MAX);
    await expect(controller.create(req, dto)).resolves.toBeDefined();

    incr.mockResolvedValue(BOOKING_CREATE_RATE_LIMIT_MAX + 1);
    createHold.mockClear();
    const err = await controller.create(req, dto).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(createHold).not.toHaveBeenCalled();
  });
});
