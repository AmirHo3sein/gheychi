import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';
import { createApprovedSalonWithService } from './factories/salon.factory';

describe('Salon-side booking management (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;
  let confirmedBookingId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09122020007');
    ({ salonId, serviceId } = await createApprovedSalonWithService(app, ownerCookie, { name: 'Provider Bookings Salon' }));

    customerCookie = await loginAs(app, '09123030008');
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() })
      .expect(201);
    confirmedBookingId = created.body.booking.id;
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(302);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the salon\'s bookings for the owner', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/salons/mine/bookings')
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(res.body.map((b: { id: string }) => b.id)).toContain(confirmedBookingId);
  });

  it('rejects a non-owner from listing the salon\'s bookings', () =>
    request(app.getHttpServer())
      .get('/api/salons/mine/bookings')
      .set('Cookie', customerCookie)
      .expect(404)); // customer has no salon of their own -- SalonOwnerGuard 404s via findMine

  it('marks a confirmed booking completed', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${confirmedBookingId}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);
    expect(res.body.status).toBe('completed');
  });

  it('rejects marking an already-completed booking again', () =>
    request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${confirmedBookingId}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'no_show' })
      .expect(400));

  it('rejects an invalid status value', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString() })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${created.body.booking.id}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'bogus' })
      .expect(400);
  });
});

describe('Manual/offline bookings (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09122020009');
    // Deliberately capacity 1 -- a manual booking must genuinely occupy the salon's only
    // chair, blocking a subsequent online booking for the same slot.
    ({ salonId, serviceId } = await createApprovedSalonWithService(app, ownerCookie, {
      name: 'Manual Bookings Salon',
      address: 'Somewhere St, No. 2',
      capacity: 1,
    }));

    customerCookie = await loginAs(app, '09123030009');
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a non-owner from recording a manual booking', () =>
    request(app.getHttpServer())
      .post('/api/salons/mine/bookings')
      .set('Cookie', customerCookie)
      .send({ phone: '09121110000', serviceId, startsAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() })
      .expect(404)); // customer has no salon of their own -- SalonOwnerGuard 404s via findMine

  it('rejects an invalid phone number', () =>
    request(app.getHttpServer())
      .post('/api/salons/mine/bookings')
      .set('Cookie', ownerCookie)
      .send({ phone: '123', serviceId, startsAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() })
      .expect(400));

  it('records a walk-in customer by phone as a confirmed, source=manual booking with no deposit', async () => {
    const startsAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const res = await request(app.getHttpServer())
      .post('/api/salons/mine/bookings')
      .set('Cookie', ownerCookie)
      .send({ phone: '09121110001', name: 'مشتری حضوری', serviceId, startsAt, notes: 'تماس تلفنی' })
      .expect(201);

    expect(res.body).toMatchObject({
      status: 'confirmed',
      source: 'manual',
      depositAmount: 0,
      customerPhone: '09121110001',
      customerName: 'مشتری حضوری',
      notes: 'تماس تلفنی',
    });

    const list = await request(app.getHttpServer())
      .get('/api/salons/mine/bookings')
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(list.body.find((b: { id: string }) => b.id === res.body.id)).toMatchObject({ source: 'manual', customerPhone: '09121110001' });
  });

  it('blocks a subsequent ONLINE booking for the same now-occupied slot', async () => {
    const startsAt = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
    await request(app.getHttpServer())
      .post('/api/salons/mine/bookings')
      .set('Cookie', ownerCookie)
      .send({ phone: '09121110002', serviceId, startsAt })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt })
      .expect(409);
  });

  it('reuses an existing customer\'s account by phone without overwriting their real name', async () => {
    const phone = '09121110003';
    // First manual booking creates the shadow account and names it.
    const first = await request(app.getHttpServer())
      .post('/api/salons/mine/bookings')
      .set('Cookie', ownerCookie)
      .send({ phone, name: 'اسم واقعی', serviceId, startsAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString() })
      .expect(201);
    expect(first.body.customerName).toBe('اسم واقعی');

    // A second manual booking for the SAME phone, with a different typed name, must not
    // clobber the name already on record for that customer.
    const second = await request(app.getHttpServer())
      .post('/api/salons/mine/bookings')
      .set('Cookie', ownerCookie)
      .send({ phone, name: 'اسم اشتباه', serviceId, startsAt: new Date(Date.now() + 96 * 60 * 60_000).toISOString() })
      .expect(201);
    expect(second.body.customerName).toBe('اسم واقعی');
    expect(second.body.customerPhone).toBe(phone);
  });
});
