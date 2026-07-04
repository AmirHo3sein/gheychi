import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Schedule (e2e)', () => {
  let app: INestApplication;
  let cookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09123330000');
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send({
      name: 'Sched Salon',
      genderTarget: 'women',
      address: 'Azadi St, No. 5',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.35,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('replaces the weekly hours', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/salons/mine/hours')
      .set('Cookie', cookie)
      .send({ hours: [
        { weekday: 6, openTime: '09:00', closeTime: '18:00' },
        { weekday: 0, openTime: '09:00', closeTime: '13:00' },
        { weekday: 0, openTime: '15:00', closeTime: '20:00' },
      ]})
      .expect(200);
    expect(res.body.length).toBe(3);

    const res2 = await request(app.getHttpServer())
      .put('/api/salons/mine/hours')
      .set('Cookie', cookie)
      .send({ hours: [{ weekday: 1, openTime: '10:00', closeTime: '19:00' }] })
      .expect(200);
    expect(res2.body.length).toBe(1);

    const list = await request(app.getHttpServer())
      .get('/api/salons/mine/hours')
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body.length).toBe(1);
  });

  it('rejects an inverted range', () =>
    request(app.getHttpServer())
      .put('/api/salons/mine/hours')
      .set('Cookie', cookie)
      .send({ hours: [{ weekday: 1, openTime: '18:00', closeTime: '09:00' }] })
      .expect(400));

  it('adds and removes a closed-day exception', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/salons/mine/exceptions')
      .set('Cookie', cookie)
      .send({ date: '2026-08-01' })
      .expect(201);
    expect(created.body.isClosed).toBe(true);

    await request(app.getHttpServer())
      .delete(`/api/salons/mine/exceptions/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(204);

    const list = await request(app.getHttpServer())
      .get('/api/salons/mine/exceptions')
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body.length).toBe(0);
  });
});
