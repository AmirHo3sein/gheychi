import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Catalog (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/categories returns the seeded list', async () => {
    const res = await request(app.getHttpServer()).get('/api/categories').expect(200);
    expect(res.body.length).toBe(14);
    expect(res.body[0]).toEqual({ id: expect.any(Number), name: expect.any(String), icon: expect.any(String) });
    expect(res.body.map((c: { name: string }) => c.name)).toContain('کوتاهی مو');
  });
});
