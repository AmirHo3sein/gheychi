import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { enableOnlinePayments, resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Salon earnings (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let cookie: string;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;

  function futureIso(hoursFromNow: number): string {
    return new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString();
  }

  beforeAll(async () => {
    await resetDatabase();
    // Money must actually be captured for commission to accrue (recordCommission reads the
    // paid Payment row, not booking.depositAmount) -- with the seeded flag off the "pay it
    // through the callback" step below would silently be a no-op.
    await enableOnlinePayments();
    app = await createTestApp();
    ds = app.get(DataSource);
    cookie = await loginAs(app, '09122220002');
    customerCookie = await loginAs(app, '09122220003');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send({
      name: 'Earnings Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 3',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      categoryIds: [categoryId],
    });
    salonId = salonRes.body.id;
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );
    // Deposit floor is 200,000; 20% of 1,000,000 = 200,000, so this exercises the
    // percentage path with a round number (easier to hand-verify the commission math),
    // matching invoicing.e2e-spec.ts's own fixture design.
    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', cookie)
      .send({ categoryId, name: 'Cut', price: 1_000_000, durationMin: 60 });
    serviceId = serviceRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns zeroed earnings for a brand-new salon with no bookings', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/salons/mine/earnings')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toEqual({ totalCollected: 0, commissionPercent: 10, commissionAmount: 0, netPayout: 0 });
  });

  it('rejects unauthenticated access', () =>
    request(app.getHttpServer()).get('/api/salons/mine/earnings').expect(401));

  it('excludes a paid-but-merely-confirmed booking -- it has not earned commission yet (no ledger row exists until completion)', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(24) })
      .expect(201);
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(302);

    // The deposit was genuinely captured (real money moved), but the booking is still
    // just 'confirmed' -- this is exactly the gap the old payments-based recomputation
    // got wrong (it counted this booking's deposit as "earnings" already).
    const res = await request(app.getHttpServer())
      .get('/api/salons/mine/earnings')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toEqual({ totalCollected: 0, commissionPercent: 10, commissionAmount: 0, netPayout: 0 });

    // Completing it is what finally accrues the ledger row and the earnings reported here.
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${created.body.booking.id}`)
      .set('Cookie', cookie)
      .send({ status: 'completed' })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get('/api/salons/mine/earnings')
      .set('Cookie', cookie)
      .expect(200);
    expect(after.body).toEqual({ totalCollected: 200_000, commissionPercent: 10, commissionAmount: 20_000, netPayout: 180_000 });
  });

  it('stays frozen at the rate that was live when the booking completed, even after the platform rate later changes', async () => {
    const before = await request(app.getHttpServer())
      .get('/api/salons/mine/earnings')
      .set('Cookie', cookie)
      .expect(200);

    // Bump the live platform commission rate -- must NOT retroactively alter what's
    // already been earned (financial_transactions.commission_amount is frozen).
    const adminCookie = await loginAsAdmin(app, '09122220098');
    await request(app.getHttpServer())
      .patch('/api/admin/config')
      .set('Cookie', adminCookie)
      .send({ updates: [{ key: 'commission_percent', value: 25 }] })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get('/api/salons/mine/earnings')
      .set('Cookie', cookie)
      .expect(200);
    expect(after.body.commissionAmount).toBe(before.body.commissionAmount); // unchanged
    expect(after.body.totalCollected).toBe(before.body.totalCollected); // unchanged
    expect(after.body.netPayout).toBe(before.body.netPayout); // unchanged
    expect(after.body.commissionPercent).toBe(25); // only the informational live-rate field moves
  });
});
