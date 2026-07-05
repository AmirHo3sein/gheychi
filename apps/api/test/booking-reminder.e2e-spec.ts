import { INestApplication } from '@nestjs/common';
import { BookingReminderJob } from '../src/booking/booking-reminder.job';
import { PushService } from '../src/push/push.service';
import { SMS_PROVIDER, SmsProvider } from '../src/sms/sms.provider';
import { createTestApp } from './utils/test-app';
import { resetDatabase, testDataSource } from './utils/db';

describe('Booking reminder job (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedConfirmedBooking(startsInHours: number, remindedAt: Date | null = null) {
    const ds = testDataSource();
    await ds.initialize();
    const [{ id: customerId }] = await ds.query(
      `INSERT INTO users (phone, role) VALUES ($1, 'customer') RETURNING id`,
      [`09${Math.floor(100000000 + Math.random() * 899999999)}`],
    );
    const [{ id: ownerId }] = await ds.query(
      `INSERT INTO users (phone, role) VALUES ($1, 'provider') RETURNING id`,
      [`09${Math.floor(100000000 + Math.random() * 899999999)}`],
    );
    const [{ id: salonId }] = await ds.query(
      `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
       VALUES ($1, 'Reminder Test Salon', $2, 'women', 'approved', 'addr', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.4, 35.7), 4326)::geography)
       RETURNING id`,
      [ownerId, 'reminder-test-' + Math.random().toString(36).slice(2, 7)],
    );
    const [{ id: categoryId }] = await ds.query(`SELECT id FROM service_categories LIMIT 1`);
    const [{ id: serviceId }] = await ds.query(
      `INSERT INTO salon_services (salon_id, category_id, name, price, duration_min, is_active)
       VALUES ($1, $2, 'Haircut', 300000, 30, true) RETURNING id`,
      [salonId, categoryId],
    );
    const startsAt = new Date(Date.now() + startsInHours * 60 * 60_000);
    const [{ id: bookingId }] = await ds.query(
      `INSERT INTO bookings (user_id, salon_id, service_id, starts_at, ends_at, price_snapshot, deposit_amount, status, reminded_at)
       VALUES ($1, $2, $3, $4, $4, 300000, 60000, 'confirmed', $5) RETURNING id`,
      [customerId, salonId, serviceId, startsAt.toISOString(), remindedAt],
    );
    await ds.destroy();
    return { bookingId, customerId, ownerId };
  }

  it('reminds a booking starting within the lead time and marks it reminded', async () => {
    const job = app.get(BookingReminderJob);
    const pushService = app.get(PushService);
    const sms = app.get<SmsProvider>(SMS_PROVIDER);
    const pushSpy = jest.spyOn(pushService, 'sendToUser');
    const smsSpy = jest.spyOn(sms, 'send');

    const { bookingId, customerId } = await seedConfirmedBooking(2); // default lead time is 3 hours

    const remindedCount = await job.run();
    expect(remindedCount).toBeGreaterThanOrEqual(1);
    expect(pushSpy).toHaveBeenCalledWith(customerId, expect.objectContaining({ title: expect.any(String) }));
    expect(smsSpy).toHaveBeenCalled();

    const ds = testDataSource();
    await ds.initialize();
    const [row] = await ds.query(`SELECT reminded_at FROM bookings WHERE id = $1`, [bookingId]);
    await ds.destroy();
    expect(row.reminded_at).not.toBeNull();
  });

  it('does not remind a booking outside the lead time window', async () => {
    const job = app.get(BookingReminderJob);
    const pushService = app.get(PushService);
    const pushSpy = jest.spyOn(pushService, 'sendToUser').mockClear();

    const { customerId } = await seedConfirmedBooking(48); // far in the future

    await job.run();
    expect(pushSpy).not.toHaveBeenCalledWith(customerId, expect.anything());
  });

  it('never reminds the same booking twice', async () => {
    const job = app.get(BookingReminderJob);
    await seedConfirmedBooking(2, new Date()); // already reminded

    const pushService = app.get(PushService);
    const pushSpy = jest.spyOn(pushService, 'sendToUser').mockClear();
    const remindedCount = await job.run();

    expect(remindedCount).toBe(0);
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
