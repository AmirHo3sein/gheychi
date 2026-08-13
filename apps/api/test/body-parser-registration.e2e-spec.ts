import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { REDIS } from '../src/redis/redis.module';
import { clearOtpIpRateLimit } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

// Regression coverage for a real production incident: a path-scoped `express.json(...)`
// middleware registered for POST /api/csp-report (see src/main.ts) was passed directly as
// the handler, and express.json()'s returned function is always literally named
// `jsonParser` -- an internal detail of the `body-parser` package -- regardless of the path
// or options it was created with. Nest's ExpressAdapter.isMiddlewareApplied(), which
// registerParserMiddleware() consults before installing Nest's own default (unscoped) json
// parser, detects "already applied" purely by that function name. Registering the
// csp-report parser under that same name made Nest skip installing its real json parser
// entirely -- silently breaking req.body for every OTHER JSON route in the whole app
// (confirmed live: this took down POST /api/auth/request-otp within minutes of deploying).
// No existing test caught it because every Jest e2e test boots through
// test/utils/test-app.ts's hand-maintained bootstrap, not src/main.ts's real one -- so this
// spec exists specifically to make that invariant explicit and hard to silently regress
// again, independent of whatever any single feature's own e2e test happens to assert.
describe('Body parser registration (e2e)', () => {
  let app: INestApplication;
  let redis: Redis;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    redis = app.get<Redis>(REDIS);
  });

  afterAll(async () => {
    await app.close();
  });

  it('parses a JSON body on a route other than the path-scoped csp-report one', async () => {
    // Deliberately a VALID phone, asserting success (201) -- an earlier version of this
    // test used an invalid phone and asserted the resulting 400, which turned out to be a
    // vacuous check: with req.body missing entirely (the actual bug), dto.phone is
    // undefined, @Matches still fails validation the same way, and the response is an
    // indistinguishable 400 either way. A valid phone is the only input that actually tells
    // the two cases apart: parsed correctly -> 201 with a real OTP in Redis; body missing
    // -> 400, since `undefined` can never match the phone regex. SMS_PROVIDER=console in
    // .env.test (see that file), so this never sends a real SMS.
    const phone = '09121234599';
    await clearOtpIpRateLimit(redis);
    await request(app.getHttpServer()).post('/api/auth/request-otp').send({ phone }).expect(201);
    expect(await redis.get(`otp:${phone}`)).toMatch(/^\d{6}$/);
  });

  it('still parses the path-scoped csp-report body correctly', async () => {
    // superagent only auto-serializes non-string bodies for content-types it recognizes
    // (json/form-urlencoded/etc) -- 'application/csp-report' isn't one of them, so the body
    // is stringified explicitly here rather than relying on that guess.
    await request(app.getHttpServer())
      .post('/api/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(JSON.stringify({ 'csp-report': { 'violated-directive': 'script-src' } }))
      .expect(204);
  });
});
