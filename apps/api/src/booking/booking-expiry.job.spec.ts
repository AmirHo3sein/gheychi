import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { WalletService } from '../wallet/wallet.service';
import { Booking } from './booking.entity';
import { BookingExpiryJob } from './booking-expiry.job';

describe('BookingExpiryJob', () => {
  let job: BookingExpiryJob;
  let transaction: jest.Mock;
  let execute: jest.Mock;
  let emDelete: jest.Mock;
  let emFind: jest.Mock;
  let queryBuilder: {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    returning: jest.Mock;
    execute: jest.Mock;
  };

  beforeEach(async () => {
    execute = jest.fn().mockResolvedValue({ raw: [] });
    queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
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

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingExpiryJob,
        { provide: getRepositoryToken(Booking), useValue: { manager: { transaction } } },
        { provide: PlatformConfigService, useValue: { getBookingHoldTtlMinutes: jest.fn().mockResolvedValue(15) } },
        { provide: WalletService, useValue: { credit: jest.fn() } },
        { provide: CronJobRunner, useValue: { run: jest.fn((_name: string, fn: () => Promise<void>) => fn()) } },
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
