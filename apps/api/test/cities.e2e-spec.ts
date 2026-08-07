import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Cities (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/cities returns the seeded canonical list, Tehran first, with the expected public shape', async () => {
    const res = await request(app.getHttpServer()).get('/api/cities').expect(200);

    expect(res.body.length).toBeGreaterThan(80);
    expect(res.body[0]).toEqual({
      id: expect.any(Number),
      name: 'تهران',
      slug: 'tehran',
      province: 'تهران',
      lat: expect.any(Number),
      lng: expect.any(Number),
    });
    expect(res.body[0].lat).toBeCloseTo(35.6892, 1);
    expect(res.body[0].lng).toBeCloseTo(51.389, 1);
    // sortOrder/createdAt are internal-only -- never exposed publicly.
    expect(res.body[0]).not.toHaveProperty('sortOrder');
    expect(res.body[0]).not.toHaveProperty('createdAt');
  });

  it('every seeded city has plausible Iran-bounded coordinates', async () => {
    const res = await request(app.getHttpServer()).get('/api/cities').expect(200);
    for (const city of res.body) {
      expect(city.lat).toBeGreaterThan(24);
      expect(city.lat).toBeLessThan(40);
      expect(city.lng).toBeGreaterThan(43);
      expect(city.lng).toBeLessThan(63);
    }
  });

  it('a newly-created salon gets cityId auto-linked when its city matches a canonical name', async () => {
    const cookie = await loginAs(app, '09150500001');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);

    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send({
      name: 'City Link Test Salon', genderTarget: 'women', address: 'خیابان تست، پلاک ۱',
      city: 'تهران', lat: 35.7, lng: 51.4, categoryIds: [categoriesRes.body[0].id],
    }).expect(201);

    expect(salonRes.body.city).toBe('تهران');
    expect(salonRes.body.cityId).toEqual(expect.any(Number));
  });

  it('a salon in a city with no canonical match still creates fine, with cityId left null', async () => {
    const cookie = await loginAs(app, '09150500002');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);

    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send({
      name: 'Unlisted Town Salon', genderTarget: 'women', address: 'خیابان تست، پلاک ۲',
      city: 'یک روستای کوچک و ناشناخته', lat: 35.7, lng: 51.4, categoryIds: [categoriesRes.body[0].id],
    }).expect(201);

    expect(salonRes.body.city).toBe('یک روستای کوچک و ناشناخته');
    expect(salonRes.body.cityId).toBeNull();
  });

  it('re-resolves cityId when a salon updates its city to a canonical name', async () => {
    const cookie = await loginAs(app, '09150500003');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send({
      name: 'Moving Salon', genderTarget: 'women', address: 'خیابان تست، پلاک ۳',
      city: 'یک روستای دیگر', lat: 35.7, lng: 51.4, categoryIds: [categoriesRes.body[0].id],
    }).expect(201);

    const updateRes = await request(app.getHttpServer())
      .patch('/api/salons/mine')
      .set('Cookie', cookie)
      .send({ city: 'مشهد' })
      .expect(200);

    expect(updateRes.body.city).toBe('مشهد');
    expect(updateRes.body.cityId).toEqual(expect.any(Number));
  });
});
