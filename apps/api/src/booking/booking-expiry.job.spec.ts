import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { WalletService } from '../wallet/wallet.service';
import { Booking } from './booking.entity';
import { BookingEventsService } from './booking-events.service';
import { BookingExpiryJob } from './booking-expiry.job';
import { PaymentsService } from './payments.service';

const HOLD_TTL_MINUTES = 15;

describe('BookingExpiryJob', () => {
  let job: BookingExpiryJob;
  let transaction: jest.Mock;
  let execute: jest.Mock;
  let emDelete: jest.Mock;
  let emFind: jest.Mock;
  let recordEvent: jest.Mock;
  let recordManyEvents = jest.fn().mockResolvedValue(undefined);
  let notifyPaymentExpired: jest.Mock;
  let queryBuilder: {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    setParameters: jest.Mock;
    returning: jest.Mock;
    execute: jest.Mock;
  };

  // The due-row predicate is SQL handed to a fake query builder, so a unit test can't
  // execute it -- what it CAN pin is the shape the job asks for: both arms present, OR'd,
  // and each bound to the right value. That is enough to catch a regression that drops
  // either arm (silently stranding one whole generation of bookings) or that re-derives
  // the legacy cutoff from something other than the configured hold TTL.
  const duePredicate = () => String(queryBuilder.andWhere.mock.calls[0][0]).replace(/\s+/g, ' ').trim();
  const boundParams = () => queryBuilder.setParameters.mock.calls[0][0] as { now: Date; cutoff: Date };

  beforeEach(async () => {
    execute = jest.fn().mockResolvedValue({ raw: [] });
    queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute,
    };
    emDelete = jest.fn().mockResolvedValue(undefined);
    // releaseBookingHold's own dedicated spec covers its behavior in depth -- here it
    // just needs to run for real against a fake `em`, matching PaymentReconciliationJob's
    // own spec's approach, rather than being mocked out at the module level.
    emFind = jest.fn().mockResolvedValue([]);
    transaction = jest.fn(async (cb: (em: unknown) => unknown) =>
      cb({ createQueryBuilder: () => queryBuilder, delete: emDelete, find: emFind }),
    );
    recordEvent = jest.fn().mockResolvedValue(undefined);
    notifyPaymentExpired = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingExpiryJob,
        { provide: getRepositoryToken(Booking), useValue: { manager: { transaction } } },
        {
          provide: PlatformConfigService,
          useValue: { getBookingHoldTtlMinutes: jest.fn().mockResolvedValue(HOLD_TTL_MINUTES) },
        },
        { provide: WalletService, useValue: { credit: jest.fn() } },
        { provide: CronJobRunner, useValue: { run: jest.fn((_name: string, fn: () => Promise<void>) => fn()) } },
        { provide: BookingEventsService, useValue: { record: recordEvent, recordMany: recordManyEvents } },
        { provide: PaymentsService, useValue: { notifyPaymentExpired } },
      ],
    }).compile();

    job = moduleRef.get(BookingExpiryJob);
  });

  it('expires pending_payment bookings older than the configured hold TTL', async () => {
    execute.mockResolvedValue({ raw: [{ id: 'booking-1' }, { id: 'booking-2' }] });

    const expiredCount = await job.run();

    expect(expiredCount).toBe(2);
    expect(queryBuilder.update).toHaveBeenCalledWith(Booking);
    expect(queryBuilder.set).toHaveBeenCalledWith({ status: 'expired' });
    expect(queryBuilder.where).toHaveBeenCalledWith('status = :status', { status: 'pending_payment' });
  });

  it('expires a booking on its own snapshotted payment deadline, however recent created_at is', async () => {
    execute.mockResolvedValue({ raw: [{ id: 'booking-1' }] });
    const before = Date.now();

    const expiredCount = await job.run();

    expect(expiredCount).toBe(1);
    // The snapshot arm carries no created_at term of its own, so a hold whose deadline has
    // passed is due even when it was created seconds ago -- and, symmetrically, an edit to
    // booking_hold_ttl_minutes can no longer move a deadline already in flight.
    expect(duePredicate()).toContain('(payment_expires_at IS NOT NULL AND payment_expires_at <= :now)');
    const { now } = boundParams();
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('still expires a legacy booking with no snapshot via the configured hold-TTL cutoff', async () => {
    execute.mockResolvedValue({ raw: [{ id: 'legacy-1' }] });
    const before = Date.now();

    const expiredCount = await job.run();

    expect(expiredCount).toBe(1);
    // Rows predating payment_expires_at keep their old deadline exactly: the second arm is
    // OR'd in, and its cutoff is still now minus the live booking_hold_ttl_minutes.
    expect(duePredicate()).toContain('OR (payment_expires_at IS NULL AND created_at < :cutoff)');
    const { cutoff } = boundParams();
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - HOLD_TTL_MINUTES * 60_000);
    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() - HOLD_TTL_MINUTES * 60_000);
  });

  it('notifies the customer once per expired booking, and one failing notification does not sink the run', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    execute.mockResolvedValue({ raw: [{ id: 'booking-1' }, { id: 'booking-2' }] });
    notifyPaymentExpired.mockRejectedValueOnce(new Error('sms provider down'));

    const expiredCount = await job.run();

    // The expiry is already committed by then, so the second booking is still notified and
    // the run still reports both -- the failure is logged, never swallowed silently.
    expect(expiredCount).toBe(2);
    expect(notifyPaymentExpired).toHaveBeenCalledTimes(2);
    expect(notifyPaymentExpired).toHaveBeenNthCalledWith(1, 'booking-1');
    expect(notifyPaymentExpired).toHaveBeenNthCalledWith(2, 'booking-2');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('booking-1'));
    errorSpy.mockRestore();
  });

  it('releases the coupon/wallet hold for every booking it expires', async () => {
    execute.mockResolvedValue({ raw: [{ id: 'booking-1' }, { id: 'booking-2' }] });

    await job.run();

    expect(emDelete).toHaveBeenCalledWith(expect.anything(), { bookingId: expect.anything() });
    expect(emFind).toHaveBeenCalledWith(
      Booking,
      expect.objectContaining({ where: expect.anything(), select: ['id', 'userId', 'walletAmountUsed'] }),
    );
  });

  it('returns 0 and skips the hold-release step entirely when nothing expired', async () => {
    execute.mockResolvedValue({ raw: [] });

    const expiredCount = await job.run();

    expect(expiredCount).toBe(0);
    // releaseBookingHold no-ops on an empty id list -- nothing to release.
    expect(emDelete).not.toHaveBeenCalled();
  });

  it('runs the expiry update and the hold release inside the same transaction', async () => {
    await job.run();

    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('handleCron delegates to run() through the shared CronJobRunner', async () => {
    const runSpy = jest.spyOn(job, 'run').mockResolvedValue(3);

    await job.handleCron();

    expect(runSpy).toHaveBeenCalled();
  });
});
