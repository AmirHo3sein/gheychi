import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { MonthlyInvoiceGenerationJob } from '../src/invoicing/monthly-invoice-generation.job';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Commission ledger + monthly invoicing (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let adminCookie: string;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;
  let bookingId: string;
  let ds: DataSource;

  function futureIso(hoursFromNow: number): string {
    return new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString();
  }

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);

    adminCookie = await loginAsAdmin(app, '09151110001');
    ownerCookie = await loginAs(app, '09151110002');
    customerCookie = await loginAs(app, '09151110003');

    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Invoicing Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 5,
    });
    salonId = salonRes.body.id;

    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId: categoriesRes.body[0].id, name: 'Cut', price: 1_000_000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );

    // Deposit floor is 200,000; 20% of 1,000,000 = 200,000, so this exercises the
    // percentage path with a round number (easier to hand-verify the commission math).
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(24) })
      .expect(201);
    bookingId = created.body.booking.id;

    // Pay it through the mock gateway callback (same idiom as bookings.e2e-spec.ts's
    // retry-payment test) so the booking reaches 'confirmed' -- updateStatus only
    // accepts a confirmed booking.
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(302);
  });

  afterAll(async () => {
    await app.close();
  });

  it('accrues a commission_accrued ledger row, at the frozen live rate, when the booking is marked completed', async () => {
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${bookingId}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);

    const [row] = await ds.query(
      `SELECT booking_id, salon_id, type, gross_amount, commission_rate, commission_amount, net_amount
       FROM financial_transactions WHERE booking_id = $1`,
      [bookingId],
    );
    expect(row).toBeDefined();
    expect(row.type).toBe('commission_accrued');
    expect(Number(row.gross_amount)).toBe(200_000); // the deposit, not the 1,000,000 price
    expect(Number(row.commission_rate)).toBe(10); // seeded commission_percent
    expect(Number(row.commission_amount)).toBe(20_000);
    expect(Number(row.net_amount)).toBe(180_000);
  });

  it('does not accrue a second row if updateStatus is somehow called again (CAS-guarded, 400 on a non-confirmed booking)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${bookingId}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(400);

    const rows = await ds.query(`SELECT id FROM financial_transactions WHERE booking_id = $1`, [bookingId]);
    expect(rows).toHaveLength(1);
  });

  describe('monthly invoice generation + admin/provider read + payment recording', () => {
    beforeAll(async () => {
      // The real commission row above was written moments ago (this month, still
      // open) -- backdate it to a definitely-closed month so the job actually picks
      // it up, exactly like a real month rolling over would.
      await ds.query(`UPDATE financial_transactions SET created_at = '2020-01-15T10:00:00.000Z' WHERE booking_id = $1`, [
        bookingId,
      ]);
      const job = app.get(MonthlyInvoiceGenerationJob);
      const result = await job.run();
      expect(result.invoicesTouched).toBe(1);
      expect(result.itemsCreated).toBe(1);
    });

    it('is idempotent -- running the job again does not create a duplicate invoice or item', async () => {
      const job = app.get(MonthlyInvoiceGenerationJob);
      const result = await job.run();
      expect(result).toEqual({ invoicesTouched: 0, itemsCreated: 0 });

      const invoices = await ds.query(`SELECT id FROM invoices WHERE salon_id = $1`, [salonId]);
      expect(invoices).toHaveLength(1);
    });

    it('lists the invoice via GET /admin/invoices, with the salon name attached', async () => {
      const res = await request(app.getHttpServer()).get('/api/admin/invoices').set('Cookie', adminCookie).expect(200);
      const invoice = res.body.items.find((i: { salonId: string }) => i.salonId === salonId);
      expect(invoice).toBeDefined();
      expect(invoice.salonName).toBe('Invoicing Test Salon');
      expect(invoice.totalGrossAmount).toBe(200_000);
      expect(invoice.totalCommissionAmount).toBe(20_000);
      expect(invoice.totalNetPayable).toBe(180_000);
      expect(invoice.status).toBe('issued');
    });

    it('a non-admin gets 403 on the admin invoices endpoint', () =>
      request(app.getHttpServer()).get('/api/admin/invoices').set('Cookie', ownerCookie).expect(403));

    it('lists the invoice via GET /salons/mine/invoices for the owning provider', async () => {
      const res = await request(app.getHttpServer()).get('/api/salons/mine/invoices').set('Cookie', ownerCookie).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].totalNetPayable).toBe(180_000);
    });

    it('returns the invoice detail with its one item via GET /admin/invoices/:id', async () => {
      const list = await request(app.getHttpServer()).get('/api/admin/invoices').set('Cookie', adminCookie).expect(200);
      const invoiceId = list.body.items.find((i: { salonId: string }) => i.salonId === salonId).id;

      const res = await request(app.getHttpServer()).get(`/api/admin/invoices/${invoiceId}`).set('Cookie', adminCookie).expect(200);
      expect(res.body.invoice.id).toBe(invoiceId);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].netAmount).toBe(180_000);
    });

    it('records a partial payment, then a final payment that marks the invoice paid', async () => {
      const list = await request(app.getHttpServer()).get('/api/admin/invoices').set('Cookie', adminCookie).expect(200);
      const invoiceId = list.body.items.find((i: { salonId: string }) => i.salonId === salonId).id;

      const partial = await request(app.getHttpServer())
        .patch(`/api/admin/invoices/${invoiceId}/payment`)
        .set('Cookie', adminCookie)
        .send({ amount: 100_000, method: 'bank_transfer', referenceNumber: 'REF-1' })
        .expect(200);
      expect(partial.body.status).toBe('partially_paid');
      expect(partial.body.paidTotal).toBe(100_000);

      const final = await request(app.getHttpServer())
        .patch(`/api/admin/invoices/${invoiceId}/payment`)
        .set('Cookie', adminCookie)
        .send({ amount: 80_000, method: 'cash' })
        .expect(200);
      expect(final.body.status).toBe('paid');
      expect(final.body.paidTotal).toBe(180_000);
      expect(final.body.paidAt).not.toBeNull();

      const payments = await request(app.getHttpServer())
        .get(`/api/admin/invoices/${invoiceId}/payments`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(payments.body).toHaveLength(2);

      // The owning provider sees the final paid status too.
      const mine = await request(app.getHttpServer()).get('/api/salons/mine/invoices').set('Cookie', ownerCookie).expect(200);
      expect(mine.body[0].status).toBe('paid');
    });

    it('a non-admin gets 403 recording a payment', async () => {
      const list = await request(app.getHttpServer()).get('/api/admin/invoices').set('Cookie', adminCookie).expect(200);
      const invoiceId = list.body.items.find((i: { salonId: string }) => i.salonId === salonId).id;

      await request(app.getHttpServer())
        .patch(`/api/admin/invoices/${invoiceId}/payment`)
        .set('Cookie', ownerCookie)
        .send({ amount: 1000, method: 'cash' })
        .expect(403);
    });
  });
});
