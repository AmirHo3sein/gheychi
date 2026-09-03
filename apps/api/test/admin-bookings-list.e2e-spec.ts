import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createApprovedSalonWithService } from './factories/salon.factory';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { enableOnlinePayments, resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

interface AdminBookingRowBody {
  id: string;
  startsAt: string;
  status: string;
  confirmationMode: string;
  source: string;
  attributionSource: string | null;
  priceSnapshot: number;
  depositAmount: number;
  salonId: string;
  salonName: string | null;
  serviceName: string | null;
  workerName: string | null;
  userId: string;
  customerName: string | null;
  customerPhone: string | null;
  payment: { status: string; amount: number; refundRequestedAt: string | null } | null;
  commissionAmount: number | null;
}

describe('Admin booking list (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminCookie: string;
  let ownerACookie: string;
  let ownerBCookie: string;
  let customerCookie: string;

  let salonAId: string;
  let salonBId: string;
  let customerId: string;

  // The completed+paid booking at salon A (has a Payment row AND a commission ledger row).
  let paidBookingId: string;
  // The still-unpaid hold at salon A (Payment row in 'initiated', no commission).
  let pendingBookingId: string;
  // The owner-recorded walk-in at salon B (source='manual', NO Payment row at all).
  let manualBookingId: string;

  function futureIso(hoursFromNow: number): string {
    return new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString();
  }

  function list(query: string, cookie = adminCookie) {
    return request(app.getHttpServer()).get(`/api/admin/bookings${query}`).set('Cookie', cookie);
  }

  const byId = (items: AdminBookingRowBody[], id: string) => items.find((b) => b.id === id);

  beforeAll(async () => {
    await resetDatabase();
    // Commission only accrues against money the platform actually captured
    // (InvoicingService.recordCommission reads the *paid* Payment row), so the flag has to
    // be on or the "pay it through the callback" step below is silently a no-op and the
    // commissionAmount assertion would be testing nothing.
    await enableOnlinePayments();
    app = await createTestApp();
    ds = app.get(DataSource);

    adminCookie = await loginAsAdmin(app, '09153330001');
    ownerACookie = await loginAs(app, '09153330002');
    ownerBCookie = await loginAs(app, '09153330003');
    customerCookie = await loginAs(app, '09153330004');

    const salonA = await createApprovedSalonWithService(
      app,
      ownerACookie,
      { name: 'Admin List Salon A', city: 'Tehran' },
      { name: 'Cut A', price: 1_000_000, durationMin: 60 },
    );
    salonAId = salonA.salonId;
    const salonB = await createApprovedSalonWithService(
      app,
      ownerBCookie,
      { name: 'Admin List Salon B', city: 'Shiraz' },
      { name: 'Cut B', price: 400_000, durationMin: 60 },
    );
    salonBId = salonB.salonId;

    // 1. A booking that goes all the way to completed: pending_payment -> paid callback ->
    //    confirmed -> completed, which is what writes the financial_transactions row.
    const paid = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId: salonAId, serviceId: salonA.serviceId, startsAt: futureIso(24), attributionSource: 'qr' })
      .expect(201);
    paidBookingId = paid.body.booking.id;
    customerId = paid.body.booking.userId;
    const authority = new URL(paid.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer())
      .get('/api/payments/callback')
      .query({ Authority: authority, Status: 'OK' })
      .expect(302);
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${paidBookingId}`)
      .set('Cookie', ownerACookie)
      .send({ status: 'completed' })
      .expect(200);

    // 2. A hold left unpaid -- Payment row exists but is still 'initiated'.
    const pending = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId: salonAId, serviceId: salonA.serviceId, startsAt: futureIso(48) })
      .expect(201);
    pendingBookingId = pending.body.booking.id;

    // 3. An owner-recorded walk-in at the OTHER salon: source='manual' and, by design, no
    //    Payment row -- the case the row shape must render as payment:null, not "0 paid".
    const manual = await request(app.getHttpServer())
      .post('/api/salons/mine/bookings')
      .set('Cookie', ownerBCookie)
      .send({ phone: '09153330005', name: 'مشتری حضوری', serviceId: salonB.serviceId, startsAt: futureIso(72) })
      .expect(201);
    manualBookingId = manual.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns every booking across every salon, newest appointment first', async () => {
    const res = await list('').expect(200);
    const items: AdminBookingRowBody[] = res.body.items;
    expect(res.body.total).toBe(3);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(20);
    // startsAt DESC: the walk-in (+72h), the unpaid hold (+48h), the completed one (+24h).
    expect(items.map((b) => b.id)).toEqual([manualBookingId, pendingBookingId, paidBookingId]);
  });

  it('carries the customer, salon, service, money and payment state on the row itself', async () => {
    const res = await list('').expect(200);
    const row = byId(res.body.items, paidBookingId)!;

    expect(row).toMatchObject({
      salonId: salonAId,
      salonName: 'Admin List Salon A',
      serviceName: 'Cut A',
      customerPhone: '09153330004',
      userId: customerId,
      status: 'completed',
      confirmationMode: 'automatic',
      source: 'online',
      attributionSource: 'qr',
      priceSnapshot: 1_000_000,
    });
    // 20% of 1,000,000 clears the 200,000 deposit floor.
    expect(row.depositAmount).toBe(200_000);
    expect(row.payment).toMatchObject({ status: 'paid', amount: 200_000 });
    // The commission ledger row written when the booking was marked completed: 10% of the
    // 200,000 actually captured, read straight off the row with no second request.
    expect(row.commissionAmount).toBe(20_000);
  });

  it('reports a booking with no payment row as payment:null / commissionAmount:null, never zero', async () => {
    const res = await list('').expect(200);
    const row = byId(res.body.items, manualBookingId)!;
    expect(row.source).toBe('manual');
    expect(row.payment).toBeNull();
    expect(row.commissionAmount).toBeNull();
    // The walk-in's shadow account still resolves to a real name/phone.
    expect(row.customerName).toBe('مشتری حضوری');
    expect(row.customerPhone).toBe('09153330005');
  });

  it('filters by salonId', async () => {
    const res = await list(`?salonId=${salonBId}`).expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items.map((b: AdminBookingRowBody) => b.id)).toEqual([manualBookingId]);
  });

  it('filters by userId', async () => {
    const res = await list(`?userId=${customerId}`).expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.every((b: AdminBookingRowBody) => b.userId === customerId)).toBe(true);
  });

  it('filters by booking status', async () => {
    const res = await list('?status=completed').expect(200);
    expect(res.body.items.map((b: AdminBookingRowBody) => b.id)).toEqual([paidBookingId]);
  });

  it('filters by source, distinguishing an owner-recorded walk-in from an online checkout', async () => {
    const manualRes = await list('?source=manual').expect(200);
    expect(manualRes.body.items.map((b: AdminBookingRowBody) => b.id)).toEqual([manualBookingId]);

    const onlineRes = await list('?source=online').expect(200);
    expect(onlineRes.body.total).toBe(2);
    expect(onlineRes.body.items.map((b: AdminBookingRowBody) => b.id)).not.toContain(manualBookingId);
  });

  it('filters by confirmationMode', async () => {
    // Every salon here runs the automatic workflow, so this must return all three -- and,
    // more importantly, manual_approval must return none rather than silently ignoring the
    // filter and returning everything.
    const automatic = await list('?confirmationMode=automatic').expect(200);
    expect(automatic.body.total).toBe(3);
    const manualApproval = await list('?confirmationMode=manual_approval').expect(200);
    expect(manualApproval.body.total).toBe(0);
  });

  it('filters by payment status, and excludes bookings with no payment row from every value', async () => {
    const paidRes = await list('?paymentStatus=paid').expect(200);
    expect(paidRes.body.items.map((b: AdminBookingRowBody) => b.id)).toEqual([paidBookingId]);

    const initiatedRes = await list('?paymentStatus=initiated').expect(200);
    expect(initiatedRes.body.items.map((b: AdminBookingRowBody) => b.id)).toEqual([pendingBookingId]);

    // The dispute-handling case this filter exists for: nothing is stuck owing a refund.
    const refundRes = await list('?paymentStatus=refund_pending').expect(200);
    expect(refundRes.body.total).toBe(0);
  });

  it('filters by an inclusive startsAt range', async () => {
    const all = await list('').expect(200);
    const target = byId(all.body.items, pendingBookingId)!;

    // A window with both bounds set exactly to the booking's own startsAt must still
    // include it -- proving both comparisons are >=/<=, not >/<.
    const exact = await list(`?from=${encodeURIComponent(target.startsAt)}&to=${encodeURIComponent(target.startsAt)}`).expect(200);
    expect(exact.body.items.map((b: AdminBookingRowBody) => b.id)).toEqual([pendingBookingId]);

    // An open-ended lower bound just past it drops it and keeps only the later walk-in.
    const from = new Date(new Date(target.startsAt).getTime() + 1000).toISOString();
    const after = await list(`?from=${encodeURIComponent(from)}`).expect(200);
    expect(after.body.items.map((b: AdminBookingRowBody) => b.id)).toEqual([manualBookingId]);
  });

  it('paginates, reporting the true total across all pages with no overlap', async () => {
    const page1 = await list('?page=1&pageSize=2').expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.total).toBe(3);
    expect(page1.body.page).toBe(1);
    expect(page1.body.pageSize).toBe(2);

    const page2 = await list('?page=2&pageSize=2').expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.total).toBe(3);

    const seen = [...page1.body.items, ...page2.body.items].map((b: AdminBookingRowBody) => b.id);
    expect(new Set(seen).size).toBe(3);
  });

  it('rejects a pageSize past the ceiling rather than serving the whole table', async () => {
    await list('?pageSize=5000').expect(400);
  });

  it('rejects an unknown status value instead of silently ignoring the filter', async () => {
    await list('?status=totally_made_up').expect(400);
  });

  it('403s a logged-in non-admin caller', async () => {
    await list('', customerCookie).expect(403);
  });

  it('surfaces a stuck refund_pending payment, the case this list exists for', async () => {
    // Drive the payment into refund_pending directly: the point under test is that the
    // list SURFACES the state (with its refundRequestedAt), not how it got there -- the
    // real producers (cancel(), reconciliation, RefundRetryJob) have their own suites.
    await ds.query(
      `UPDATE payments SET status = 'refund_pending', refund_requested_at = now() WHERE booking_id = $1`,
      [paidBookingId],
    );

    const res = await list('?paymentStatus=refund_pending').expect(200);
    const items: AdminBookingRowBody[] = res.body.items;
    expect(items.map((b) => b.id)).toEqual([paidBookingId]);
    expect(items[0].payment?.status).toBe('refund_pending');
    expect(items[0].payment?.refundRequestedAt).not.toBeNull();
  });
});
