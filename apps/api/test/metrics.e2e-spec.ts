import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { resetDatabase } from './utils/db';

describe('Metrics (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/metrics', () => {
    it('is reachable with no session at all and returns valid Prometheus text-exposition format', async () => {
      const res = await request(app.getHttpServer()).get('/api/metrics').expect(200);

      expect(res.headers['content-type']).toContain('text/plain');
      // The standard Prometheus text-exposition-format shape: every registered metric
      // this codebase ships gets its own HELP/TYPE preamble, even before any real
      // request/booking/payment/etc. has moved a single counter in this fresh process.
      expect(res.text).toContain('# HELP http_requests_total');
      expect(res.text).toContain('# TYPE http_requests_total counter');
      expect(res.text).toContain('# HELP cron_job_duration_seconds');
      expect(res.text).toContain('# TYPE cron_job_duration_seconds histogram');
    });
  });
});
