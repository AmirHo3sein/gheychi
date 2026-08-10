import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

// A minimal valid 1x1 transparent PNG (real magic-number bytes, not fake/placeholder
// content) -- needed because NestJS's FileTypeValidator does real magic-number sniffing
// via the `file-type` package, not a pure mimetype-string check.
const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('Salon photos (e2e)', () => {
  let app: INestApplication;
  let cookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09122220001');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send({
      name: 'Photo Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 2',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      categoryIds: [categoryId],
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
      .attach('file', MINIMAL_PNG, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);
    photoId = res.body.id;
    expect(res.body.isCover).toBe(true);
    expect(res.body.url).toContain('/uploads/');
  });

  it('serves the uploaded file back with X-Content-Type-Options: nosniff (defense-in-depth for /uploads)', async () => {
    const listRes = await request(app.getHttpServer()).get('/api/salons/mine/photos').set('Cookie', cookie).expect(200);
    const path = new URL(listRes.body[0].url).pathname;

    const fileRes = await request(app.getHttpServer()).get(path).expect(200);
    expect(fileRes.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects a non-image upload', () =>
    request(app.getHttpServer())
      .post('/api/salons/mine/photos')
      .set('Cookie', cookie)
      .attach('file', Buffer.from('not an image'), { filename: 'a.txt', contentType: 'text/plain' })
      .expect(422));

  it('rejects real image bytes declared under a spoofed, disallowed Content-Type (stored-XSS guard)', () =>
    // The magic-number validator alone would PASS this (the bytes really are a PNG) --
    // this is exactly the gap that let a crafted upload get persisted with an
    // attacker-chosen S3 Content-Type (e.g. text/html) despite carrying real image
    // content. file.mimetype must independently match the allowed set too.
    request(app.getHttpServer())
      .post('/api/salons/mine/photos')
      .set('Cookie', cookie)
      .attach('file', MINIMAL_PNG, { filename: 'a.png', contentType: 'text/html' })
      .expect(400));

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

  it('unsets isCover on the salon\'s other photos when a new one is set via PATCH', async () => {
    const firstRes = await request(app.getHttpServer())
      .post('/api/salons/mine/photos')
      .set('Cookie', cookie)
      .attach('file', MINIMAL_PNG, { filename: 'c1.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const firstId = firstRes.body.id;
    expect(firstRes.body.isCover).toBe(true);

    const secondRes = await request(app.getHttpServer())
      .post('/api/salons/mine/photos')
      .set('Cookie', cookie)
      .attach('file', MINIMAL_PNG, { filename: 'c2.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const secondId = secondRes.body.id;
    expect(secondRes.body.isCover).toBe(false);

    await request(app.getHttpServer())
      .patch(`/api/salons/mine/photos/${secondId}`)
      .set('Cookie', cookie)
      .send({ isCover: true })
      .expect(200);

    const listRes = await request(app.getHttpServer())
      .get('/api/salons/mine/photos')
      .set('Cookie', cookie)
      .expect(200);
    const first = listRes.body.find((p: { id: string }) => p.id === firstId);
    const second = listRes.body.find((p: { id: string }) => p.id === secondId);
    expect(first.isCover).toBe(false);
    expect(second.isCover).toBe(true);
  });

  it("404s a different owner editing/deleting this salon's photo (IDOR)", async () => {
    const uploadRes = await request(app.getHttpServer())
      .post('/api/salons/mine/photos')
      .set('Cookie', cookie)
      .attach('file', MINIMAL_PNG, { filename: 'owned.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const ownedPhotoId = uploadRes.body.id;

    const otherCookie = await loginAs(app, '09122220098');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', otherCookie).send({
      name: 'Stranger Photo Test Salon',
      genderTarget: 'women',
      address: 'Elsewhere St, No. 9',
      city: 'Tehran',
      lat: 35.71,
      lng: 51.41,
      categoryIds: [categoriesRes.body[0].id],
    });

    await request(app.getHttpServer())
      .patch(`/api/salons/mine/photos/${ownedPhotoId}`)
      .set('Cookie', otherCookie)
      .send({ sortOrder: 9 })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/salons/mine/photos/${ownedPhotoId}`)
      .set('Cookie', otherCookie)
      .expect(404);

    // The rejected cross-tenant attempts left the photo untouched.
    const listRes = await request(app.getHttpServer()).get('/api/salons/mine/photos').set('Cookie', cookie).expect(200);
    expect(listRes.body.find((p: { id: string }) => p.id === ownedPhotoId)).toBeDefined();
  });

  it('enforces the 30-photo cap', async () => {
    const before = await request(app.getHttpServer()).get('/api/salons/mine/photos').set('Cookie', cookie).expect(200);
    for (let i = before.body.length; i < 30; i++) {
      await request(app.getHttpServer())
        .post('/api/salons/mine/photos')
        .set('Cookie', cookie)
        .attach('file', MINIMAL_PNG, { filename: `cap-${i}.jpg`, contentType: 'image/jpeg' })
        .expect(201);
    }
    const res = await request(app.getHttpServer())
      .post('/api/salons/mine/photos')
      .set('Cookie', cookie)
      .attach('file', MINIMAL_PNG, { filename: 'over-cap.jpg', contentType: 'image/jpeg' })
      .expect(409);
    expect(res.body.message).toBe('حداکثر ۳۰ عکس مجاز است');
  });
});
