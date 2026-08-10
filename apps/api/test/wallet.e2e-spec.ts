import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Wallet ledger + admin manual adjustment (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let customerCookie: string;
  let customerUserId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122320001');
    customerCookie = await loginAs(app, '09122320002');

    const users = await request(app.getHttpServer())
      .get('/api/admin/users?phone=09122320002')
      .set('Cookie', adminCookie)
      .expect(200);
    customerUserId = users.body.items[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts with no balances for a fresh user', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/wallet/mine')
      .set('Cookie', customerCookie)
      .expect(200);
    expect(res.body).toEqual({ balances: [] });
  });

  it('a non-admin gets 403 on both admin wallet endpoints', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/wallet/transactions')
      .set('Cookie', customerCookie)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/admin/wallet/adjust')
      .set('Cookie', customerCookie)
      .send({ userId: customerUserId, amount: 1000, reason: 'should be blocked' })
      .expect(403);
  });

  it('rejects an adjustment with no reason', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/wallet/adjust')
      .set('Cookie', adminCookie)
      .send({ userId: customerUserId, amount: 1000, reason: '' })
      .expect(400);
  });

  it('rejects an adjustment with a whitespace-only reason', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/wallet/adjust')
      .set('Cookie', adminCookie)
      .send({ userId: customerUserId, amount: 1000, reason: '   ' })
      .expect(400);
  });

  it('rejects a zero-amount adjustment', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/wallet/adjust')
      .set('Cookie', adminCookie)
      .send({ userId: customerUserId, amount: 0, reason: 'no-op' })
      .expect(400);
  });

  it('admin credits a user, and GET /wallet/mine (as that user) shows the correct balance and history', async () => {
    const adjustRes = await request(app.getHttpServer())
      .post('/api/admin/wallet/adjust')
      .set('Cookie', adminCookie)
      .send({ userId: customerUserId, amount: 100000, reason: 'promo credit' })
      .expect(201);
    expect(adjustRes.body.balanceAfter).toBe(100000);

    const balances = await request(app.getHttpServer())
      .get('/api/wallet/mine')
      .set('Cookie', customerCookie)
      .expect(200);
    expect(balances.body).toEqual({ balances: [{ currency: 'toman', balance: 100000 }] });

    const txs = await request(app.getHttpServer())
      .get('/api/wallet/mine/transactions')
      .set('Cookie', customerCookie)
      .expect(200);
    expect(txs.body.total).toBe(1);
    expect(txs.body.items[0]).toMatchObject({
      userId: customerUserId,
      currency: 'toman',
      amount: 100000,
      balanceAfter: 100000,
      type: 'admin_adjustment',
      reason: 'promo credit',
    });
  });

  it('a successful admin adjustment writes a real audit_log row with the reason and a before/after balance diff', async () => {
    const log = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ action: 'wallet.adjust' })
      .expect(200);

    const row = log.body.items.find(
      (item: { payload: { userId?: string; reason?: string } | null }) =>
        item.payload?.userId === customerUserId && item.payload?.reason === 'promo credit',
    );
    expect(row).toBeDefined();
    expect(row.targetType).toBe('wallet');
    expect(row.success).toBe(true);
    // Fresh user had no wallet_balances row at all, so "before" reports 0 --
    // "after" reports the real post-credit balance, not just the requested amount.
    expect(row.payload.before).toEqual({ userId: customerUserId, currency: 'toman', balance: 0 });
    expect(row.payload.after).toEqual({ userId: customerUserId, currency: 'toman', balance: 100000 });
  });

  it('admin attempts to debit more than the balance and gets a clean 400, balance unchanged', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/wallet/adjust')
      .set('Cookie', adminCookie)
      .send({ userId: customerUserId, amount: -999999, reason: 'oops, too much' })
      .expect(400);

    const balances = await request(app.getHttpServer())
      .get('/api/wallet/mine')
      .set('Cookie', customerCookie)
      .expect(200);
    // Still exactly what the prior credit test left it at -- the rejected debit
    // must not have partially applied.
    expect(balances.body).toEqual({ balances: [{ currency: 'toman', balance: 100000 }] });
  });

  it('admin can partially debit within the balance', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/wallet/adjust')
      .set('Cookie', adminCookie)
      .send({ userId: customerUserId, amount: -40000, reason: 'correcting an over-credit' })
      .expect(201);
    expect(res.body.balanceAfter).toBe(60000);

    const balances = await request(app.getHttpServer())
      .get('/api/wallet/mine')
      .set('Cookie', customerCookie)
      .expect(200);
    expect(balances.body).toEqual({ balances: [{ currency: 'toman', balance: 60000 }] });
  });

  it('admin global ledger search filters by userId and paginates', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/admin/wallet/transactions?userId=${customerUserId}&pageSize=1&page=1`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(1);
    // Newest first.
    expect(res.body.items[0]).toMatchObject({ userId: customerUserId, amount: -40000 });
    expect(res.body.items[0].userPhone).toBe('09122320002');
  });

  it('a customer cannot see another user\'s wallet -- /wallet/mine is always scoped to the caller', async () => {
    const otherCookie = await loginAs(app, '09122320003');
    const res = await request(app.getHttpServer()).get('/api/wallet/mine').set('Cookie', otherCookie).expect(200);
    expect(res.body).toEqual({ balances: [] });
  });

  // WalletService.debit()'s row lock (.setLock('pessimistic_write'), proven invoked by
  // the mocked unit test in wallet.service.spec.ts) is the only thing standing between
  // two concurrent debits and a negative balance -- this is the real-Postgres proof it
  // actually serializes them. Each debit below is individually within the seeded
  // balance, but the two together are not.
  it('concurrency: two simultaneous debits together exceeding the balance -- exactly one succeeds, balance never goes negative', async () => {
    const racerCookie = await loginAs(app, '09122320099');
    const racerUsers = await request(app.getHttpServer())
      .get('/api/admin/users?phone=09122320099')
      .set('Cookie', adminCookie)
      .expect(200);
    const racerId = racerUsers.body.items[0].id;

    await request(app.getHttpServer())
      .post('/api/admin/wallet/adjust')
      .set('Cookie', adminCookie)
      .send({ userId: racerId, amount: 100000, reason: 'race test seed' })
      .expect(201);

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/admin/wallet/adjust')
        .set('Cookie', adminCookie)
        .send({ userId: racerId, amount: -70000, reason: 'race debit A' }),
      request(app.getHttpServer())
        .post('/api/admin/wallet/adjust')
        .set('Cookie', adminCookie)
        .send({ userId: racerId, amount: -70000, reason: 'race debit B' }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 400]);

    const balances = await request(app.getHttpServer()).get('/api/wallet/mine').set('Cookie', racerCookie).expect(200);
    const balance = balances.body.balances.find((b: { currency: string }) => b.currency === 'toman')?.balance ?? 0;
    // Never negative, and never double-debited: exactly one 70,000 debit landed.
    expect(balance).toBe(30000);
  });
});
