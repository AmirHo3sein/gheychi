import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { PushService } from '../push/push.service';
import { SalonsService } from '../salons/salons.service';
import { SMS_PROVIDER } from '../sms/sms.provider';
import { UsersService } from '../users/users.service';
import { Booking } from './booking.entity';
import { BookingReminderJob } from './booking-reminder.job';

const NOW = new Date('2026-08-01T10:00:00.000Z');
const BOOKING = {
  id: 'booking-1',
  salonId: 'salon-1',
  userId: 'user-1',
  startsAt: new Date('2026-08-01T12:00:00.000Z'),
};
const SALON = { id: 'salon-1', name: 'Test Salon', address: 'Addr' };
const CUSTOMER = { id: 'user-1', phone: '09120000000' };

describe('BookingReminderJob', () => {
  let job: BookingReminderJob;
  let bookingsFind: jest.Mock;
  let bookingsUpdate: jest.Mock;
  let smsSend: jest.Mock;
  let pushSendToUser: jest.Mock;
  let alertsRaise: jest.Mock;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(NOW);

    bookingsFind = jest.fn().mockResolvedValue([{ ...BOOKING }]);
    bookingsUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    smsSend = jest.fn().mockResolvedValue(undefined);
    pushSendToUser = jest.fn().mockResolvedValue(undefined);
    alertsRaise = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingReminderJob,
        { provide: getRepositoryToken(Booking), useValue: { find: bookingsFind, update: bookingsUpdate } },
        { provide: PlatformConfigService, useValue: { getReminderLeadHours: jest.fn().mockResolvedValue(3) } },
        { provide: SalonsService, useValue: { findById: jest.fn().mockResolvedValue(SALON) } },
        { provide: UsersService, useValue: { findById: jest.fn().mockResolvedValue(CUSTOMER) } },
        { provide: SMS_PROVIDER, useValue: { send: smsSend } },
        { provide: PushService, useValue: { sendToUser: pushSendToUser } },
        { provide: AlertsService, useValue: { raise: alertsRaise } },
        { provide: CronJobRunner, useValue: { run: jest.fn((_name: string, fn: () => Promise<void>) => fn()) } },
      ],
    }).compile();

    job = moduleRef.get(BookingReminderJob);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('claims the booking, sends both channels, and counts it as reminded', async () => {
    const count = await job.run();

    expect(count).toBe(1);
    expect(bookingsUpdate).toHaveBeenCalledWith({ id: 'booking-1', remindedAt: IsNull() }, { remindedAt: NOW });
    expect(smsSend).toHaveBeenCalledWith(CUSTOMER.phone, expect.stringContaining(SALON.name));
    expect(pushSendToUser).toHaveBeenCalledWith(
      CUSTOMER.id,
      expect.objectContaining({ data: { type: 'booking', bookingId: BOOKING.id } }),
    );
    expect(alertsRaise).not.toHaveBeenCalled();
  });

  it('skips a booking a concurrent run already claimed (CAS miss)', async () => {
    bookingsUpdate.mockResolvedValue({ affected: 0 });

    const count = await job.run();

    expect(count).toBe(0);
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('skips a booking whose startsAt has already passed', async () => {
    bookingsFind.mockResolvedValue([{ ...BOOKING, startsAt: new Date(NOW.getTime() - 1000) }]);

    const count = await job.run();

    expect(count).toBe(0);
    expect(bookingsUpdate).not.toHaveBeenCalled();
  });

  it('bounds the query to a batch size via take', async () => {
    await job.run();

    expect(bookingsFind).toHaveBeenCalledWith(expect.objectContaining({ take: expect.any(Number) }));
  });

  describe('SMS failure (the real, reportable delivery signal)', () => {
    beforeEach(() => {
      smsSend.mockRejectedValue(new Error('gateway down'));
    });

    it('does NOT count the booking as reminded', async () => {
      const count = await job.run();
      expect(count).toBe(0);
    });

    it('releases the claim (CAS-guarded on the exact timestamp) so the next tick retries', async () => {
      await job.run();

      expect(bookingsUpdate).toHaveBeenCalledWith({ id: 'booking-1', remindedAt: NOW }, { remindedAt: null });
    });

    it('logs the failure instead of swallowing it silently', async () => {
      const errorSpy = jest.spyOn(job['logger'], 'error').mockImplementation();
      await job.run();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('gateway down'));
    });

    it('raises an operator alert', async () => {
      await job.run();
      expect(alertsRaise).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'reminder-failed:booking-1', severity: 'warning' }),
      );
    });
  });

  it('still counts the booking as reminded when only push fails (push is best-effort and never gates the claim)', async () => {
    pushSendToUser.mockRejectedValue(new Error('no subscriptions'));

    const count = await job.run();

    expect(count).toBe(1);
    expect(alertsRaise).not.toHaveBeenCalled();
    // The claim (remindedAt = now) is never reverted for a push-only failure.
    expect(bookingsUpdate).not.toHaveBeenCalledWith(expect.anything(), { remindedAt: null });
  });

  it('logs and skips (without reverting the claim) when the salon lookup 404s', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingReminderJob,
        { provide: getRepositoryToken(Booking), useValue: { find: bookingsFind, update: bookingsUpdate } },
        { provide: PlatformConfigService, useValue: { getReminderLeadHours: jest.fn().mockResolvedValue(3) } },
        { provide: SalonsService, useValue: { findById: jest.fn().mockResolvedValue(null) } },
        { provide: UsersService, useValue: { findById: jest.fn().mockResolvedValue(CUSTOMER) } },
        { provide: SMS_PROVIDER, useValue: { send: smsSend } },
        { provide: PushService, useValue: { sendToUser: pushSendToUser } },
        { provide: AlertsService, useValue: { raise: alertsRaise } },
        { provide: CronJobRunner, useValue: { run: jest.fn((_name: string, fn: () => Promise<void>) => fn()) } },
      ],
    }).compile();
    const jobWithNoSalon = moduleRef.get(BookingReminderJob);
    const warnSpy = jest.spyOn(jobWithNoSalon['logger'], 'warn').mockImplementation();

    const count = await jobWithNoSalon.run();

    expect(count).toBe(0);
    expect(smsSend).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('booking-1'));
  });

  it('handleCron delegates to run() through the job runner', async () => {
    const runSpy = jest.spyOn(job, 'run').mockResolvedValue(3);

    await job.handleCron();

    expect(runSpy).toHaveBeenCalled();
  });
});
