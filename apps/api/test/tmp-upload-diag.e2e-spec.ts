import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';
import { createApprovedSalon } from './factories/salon.factory';

const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('tmp upload diagnostic', () => {
  let app: INestApplication;
  let cookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09199990001');
    await createApprovedSalon(app, cookie, { name: 'Diag Salon' });
  });

  afterAll(async () => { await app.close(); });

  it('prints the upload response', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/salons/mine/photos')
      .set('Cookie', cookie)
      .attach('file', MINIMAL_PNG, { filename: 'a.jpg', contentType: 'image/jpeg' });
    console.log('STATUS', res.status, 'BODY', JSON.stringify(res.body));
  });
});
