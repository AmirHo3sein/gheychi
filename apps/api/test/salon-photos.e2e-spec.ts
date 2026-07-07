import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Salon photos (e2e)', () => {
  let app: INestApplication;
  let cookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09122220001');
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send({
      name: 'Photo Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 2',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  let photoId: string;

  it('uploads a photo, marking the first one as cover', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/salons/mine/photos')
      .set('Cookie', cookie)
      .attach('file', Buffer.from('fake-image-bytes'), { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);
    photoId = res.body.id;
    expect(res.body.isCover).toBe(true);
    expect(res.body.url).toContain('/uploads/');
  });

  it('rejects a non-image upload', () =>
    request(app.getHttpServer())
      .post('/api/salons/mine/photos')
      .set('Cookie', cookie)
      .attach('file', Buffer.from('not an image'), { filename: 'a.txt', contentType: 'text/plain' })
      .expect(422));

  it('lists photos for the caller salon', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/salons/mine/photos')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.length).toBe(1);
  });

  it('updates sortOrder/isCover', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/salons/mine/photos/${photoId}`)
      .set('Cookie', cookie)
      .send({ sortOrder: 3 })
      .expect(200);
    expect(res.body.sortOrder).toBe(3);
  });

  it('deletes a photo', async () => {
    await request(app.getHttpServer())
      .delete(`/api/salons/mine/photos/${photoId}`)
      .set('Cookie', cookie)
      .expect(204);
    const res = await request(app.getHttpServer())
      .get('/api/salons/mine/photos')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.length).toBe(0);
  });

  it('rejects unauthenticated access', () =>
    request(app.getHttpServer()).get('/api/salons/mine/photos').expect(401));
});
