import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';
import { Salon } from '../src/salons/salon.entity';

describe('Salon resubmit after rejection (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let adminCookie: string;
  let salonId: string;
  let categoryId: number;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122250001');
    ownerCookie = await loginAs(app, '09122250002');

    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    categoryId = categoriesRes.body[0].id;

    const createRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Resubmit Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 8',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      categoryIds: [categoryId],
    });
    salonId = createRes.body.id;

    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'rejected', reason: 'اطلاعات ناقص است' })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a resubmit from a non-rejected status', async () => {
    const otherOwnerCookie = await loginAs(app, '09122250003');
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', otherOwnerCookie).send({
      name: 'Pending Salon, not rejected',
      genderTarget: 'men',
      address: 'Somewhere St, No. 9',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      categoryIds: [categoryId],
    });
    await request(app.getHttpServer())
      .post('/api/salons/mine/resubmit')
      .set('Cookie', otherOwnerCookie)
      .expect(400);
  });

  it('flips a rejected salon back to pending and clears the reason', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/salons/mine/resubmit')
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(res.body.status).toBe('pending');
    expect(res.body.rejectionReason).toBeNull();
  });

  it('rejects an unauthenticated caller', async () =>
    request(app.getHttpServer()).post('/api/salons/mine/resubmit').expect(401));

  it('returns 409 when a concurrent admin action changes the salon status before the write lands', async () => {
    const raceOwnerCookie = await loginAs(app, '09122250004');
    const createRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', raceOwnerCookie).send({
      name: 'Race Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 10',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      categoryIds: [categoryId],
    });
    const raceSalonId = createRes.body.id;
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${raceSalonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'rejected', reason: 'اطلاعات ناقص است' })
      .expect(200);

    // A real concurrent admin action only sometimes lands in the exact window between
    // resubmitMine's read (findOneBy) and its conditioned update, so it can't be relied
    // on to reproduce deterministically. Instead, intercept the findOneBy call that reads
    // the salon by id -- SalonOwnerGuard's own findOneBy({ownerId}) lookup runs first (to
    // resolve req.salonId) and must pass through untouched; resubmitMine's own
    // findOneBy({id}) status read is the one whose read/update window this test needs to
    // race -- and have an admin approve the salon from inside that intercept, i.e. after
    // the read but before resubmitMine's own update runs. That's exactly the lost-update
    // race resubmitMine's conditioned update is meant to catch.
    const salonRepo = app.get<Repository<Salon>>(getRepositoryToken(Salon));
    const originalFindOneBy = salonRepo.findOneBy.bind(salonRepo);
    const findOneBySpy = jest.spyOn(salonRepo, 'findOneBy').mockImplementation(
      async (...args: Parameters<typeof salonRepo.findOneBy>) => {
        const salon = await originalFindOneBy(...args);
        const where = args[0] as Record<string, unknown>;
        if ('id' in where) {
          findOneBySpy.mockRestore();
          await request(app.getHttpServer())
            .patch(`/api/admin/salons/${raceSalonId}/status`)
            .set('Cookie', adminCookie)
            .send({ status: 'approved' })
            .expect(200);
        }
        return salon;
      },
    );

    await request(app.getHttpServer())
      .post('/api/salons/mine/resubmit')
      .set('Cookie', raceOwnerCookie)
      .expect(409);

    const ds = app.get(DataSource);
    const [row] = await ds.query('SELECT status FROM salons WHERE id = $1', [raceSalonId]);
    expect(row.status).toBe('approved'); // the admin's concurrent write wins, not the stale resubmit
  });

  it('created an admin notification for the one successful resubmit, visible via the admin endpoints', async () => {
    const countRes = await request(app.getHttpServer())
      .get('/api/admin/notifications/unread-count')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(countRes.body).toEqual({ count: 1 });

    const listRes = await request(app.getHttpServer())
      .get('/api/admin/notifications?unread=true')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(listRes.body.total).toBe(1);
    const item = listRes.body.items[0];
    expect(item.type).toBe('salon_resubmitted');
    expect(item.title).toBe('سالن «Resubmit Test Salon» دوباره برای بررسی ارسال شد');
    expect(item.link).toBe(`/salons/${salonId}`);

    await request(app.getHttpServer())
      .patch(`/api/admin/notifications/${item.id}/read`)
      .set('Cookie', adminCookie)
      .expect(200);
    const afterRead = await request(app.getHttpServer())
      .get('/api/admin/notifications/unread-count')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(afterRead.body).toEqual({ count: 0 });
  });
});
