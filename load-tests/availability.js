// availability.js -- baseline load test for GET /api/salons/:salonId/availability
//
// WHAT THIS IS: a k6 script that ramps virtual users up against a single salon's
// availability endpoint and prints k6's standard summary at the end. NO pass/fail
// thresholds are defined -- see search.js's header comment for why; the short
// version is this repo's policy is "establish baselines first," and nobody has run
// this against a real instance yet.
//
// This endpoint is unauthenticated in the real app (AvailabilityController carries
// no @UseGuards -- see apps/api/src/booking/availability.controller.ts), same as
// browsing a salon's page while logged out, so this script sends no session cookie.
//
// It also happens to be a known-interesting endpoint: apps/api/scripts/
// benchmark-availability.ts already benchmarks how AvailabilityService's SQL fetch +
// in-process slot computation (availability.util.ts) scales with booking ROW COUNT
// on a single request. This script is a different, complementary axis: how the full
// HTTP stack (routing, validation, DB pool, network) holds up under concurrent
// REQUESTS against a salon that already has real, seeded data -- not a
// microbenchmark of one function.
//
// SETUP: you need a real salon + service that already exist on the target instance
// (status='approved', with working_hours configured -- see
// apps/api/test/availability.e2e-spec.ts for what a valid fixture looks like).
// This script does not create one for you; point it at a real seeded salon via
// env vars:
//
//   BASE_URL=https://staging.example.com/api \
//   SALON_ID=<uuid> \
//   SERVICE_ID=<uuid> \
//   k6 run availability.js
//
// WORKER_ID is optional (mirrors AvailabilityQueryDto.workerId -- omitted means
// "any available staff member", which is what most real requests send; the
// per-worker filter is a narrower, less common case).

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3002/api';
const SALON_ID = __ENV.SALON_ID;
const SERVICE_ID = __ENV.SERVICE_ID;
const WORKER_ID = __ENV.WORKER_ID || '';

if (!SALON_ID || !SERVICE_ID) {
  throw new Error(
    'SALON_ID and SERVICE_ID env vars are required -- point this at a real, seeded, ' +
      'approved salon + active service on the target instance. See this file\'s header comment.',
  );
}

const availabilityDuration = new Trend('availability_req_duration', true);
const availabilityOk = new Counter('availability_ok_200');
const availabilityUnexpected = new Counter('availability_unexpected_status');

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '1m', target: 5 },
    { duration: '30s', target: 20 },
    { duration: '1m', target: 20 },
    { duration: '30s', target: 50 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  // No `thresholds` -- see file header.
};

export default function () {
  const params = { serviceId: SERVICE_ID };
  if (WORKER_ID) params.workerId = WORKER_ID;
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  group('GET /salons/:salonId/availability', function () {
    const res = http.get(`${BASE_URL}/salons/${SALON_ID}/availability?${qs}`, {
      tags: { name: 'availability' },
    });
    availabilityDuration.add(res.timings.duration);

    if (res.status === 200) {
      availabilityOk.add(1);
      check(res, {
        'availability: status 200': (r) => r.status === 200,
        'availability: body is an array': (r) => {
          try {
            return Array.isArray(JSON.parse(r.body));
          } catch {
            return false;
          }
        },
      });
    } else {
      availabilityUnexpected.add(1);
      check(res, { 'availability: status 200': (r) => r.status === 200 });
    }
  });

  sleep(1);
}
