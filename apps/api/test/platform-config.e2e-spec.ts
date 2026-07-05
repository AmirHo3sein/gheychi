import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';
import { PlatformConfigService } from '../src/platform-config/platform-config.service';

describe('PlatformConfigService (e2e)', () => {
  let app: INestApplication;
  let config: PlatformConfigService;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    config = app.get(PlatformConfigService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('reads all five seeded tunables with the correct values and types', async () => {
    expect(await config.getDepositPercent()).toBe(20);
    expect(await config.getDepositMinToman()).toBe(200000);
    expect(await config.getCancellationWindowHours()).toBe(24);
    expect(await config.getCommissionPercent()).toBe(10);
    expect(await config.getBookingHoldTtlMinutes()).toBe(15);
  });
});

describe('Platform config — public booking terms (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes the deposit and cancellation terms without auth', async () => {
    const res = await request(app.getHttpServer()).get('/api/platform-config/booking-terms').expect(200);
    expect(res.body).toEqual({
      depositPercent: 20,
      depositMinToman: 200000,
      cancellationWindowHours: 24,
    });
  });
});
