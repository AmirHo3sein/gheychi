import { INestApplication } from '@nestjs/common';
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
