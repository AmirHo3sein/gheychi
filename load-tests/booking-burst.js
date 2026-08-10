// booking-burst.js -- concurrency/contention baseline for POST /api/bookings
//
// WHAT THIS IS: many virtual users attempting to book the EXACT SAME salon +
// service + start time, at (as close to) the same instant as k6 can manage. This is
// deliberate, not a mistake -- the point is to observe the real contention path
// (apps/api/src/booking/bookings.service.ts's createHold: a per-salon Redis lock
// guarding a transactional overlap check against salon.capacity) under actual
// concurrent HTTP load, not just under the existing unit/e2e tests that call the
// service directly.
//
// IMPORTANT -- READ BEFORE INTERPRETING RESULTS:
// A HIGH RATE OF HTTP 409 RESPONSES HERE IS THE CORRECT, EXPECTED OUTCOME, NOT AN
// ERROR CONDITION. createHold throws ConflictException (-> 409) whenever:
//   - the per-salon booking lock is already held by another in-flight request
//     ("This slot is being booked by someone else, try again"), or
//   - the transactional overlap count has already reached salon.capacity
//     ("Slot no longer available").
// If you point this at a salon with capacity=1, expect exactly ~1 success (201) and
// everything else to be 409 -- that IS the double-booking guarantee working. Do not
// read a high 409 rate as a bug to fix; read it as confirmation the lock is doing
// its job, and use the summary's timing data (how long the losers waited before
// being told "no") as the actual baseline signal.
//
// AUTH: POST /api/bookings requires a logged-in session (AuthGuard, cookie-based --
// see apps/api/src/booking/bookings.controller.ts / auth.guard.ts). Login here is
// OTP-based (apps/api/src/auth/auth.controller.ts) with a random 6-digit code sent
// by SMS -- there is no bypass, and this script deliberately does NOT attempt to
// drive the OTP flow itself (that would mean this script triggering real OTP sends
// against real phone numbers, which is exactly the kind of thing it should never do
// automatically). Instead, YOU log in ahead of time through the real app/API using
// phone numbers you control, and hand this script the resulting session cookie(s):
//
//   SESSION_COOKIES  comma-separated list of "session=<jwt>" cookie values, one per
//                     distinct logged-in customer. If you supply N cookies but ask
//                     for more than N VUs, they're reused round-robin -- see
//                     "single-account mode" below.
//   SESSION_COOKIE    singular fallback: one cookie, reused by every VU. This still
//                     exercises the real lock/overlap contention path (capacity is
//                     enforced per SALON, not per user) -- it's a lower-fidelity
//                     stand-in for "many different customers" (more like "one
//                     customer double/multi-submitting"), but a legitimate scenario
//                     in its own right and fine for an initial baseline.
//
// How to obtain a session cookie against a target instance without this script
// touching OTP itself: log in normally (real app, or curl/Postman) with a phone
// number you control, read the OTP the SMS provider actually sent (or, in a
// SMS_PROVIDER=console dev/staging setup, from that instance's own server logs --
// again, YOUR real login attempt, not one this script initiates), then copy the
// `session=...` cookie from the verify-otp response / your browser's dev tools.
//
// SETUP: also needs a real, seeded, approved salon + active service on the target
// instance (same requirement as availability.js), plus a future startsAt that is
// actually within that salon's working hours and not already fully booked.
//
// USAGE:
//   BASE_URL=https://staging.example.com/api \
//   SALON_ID=<uuid> \
//   SERVICE_ID=<uuid> \
//   STARTS_AT=2026-09-01T10:00:00.000Z \
//   SESSION_COOKIES="session=eyJ...aaa,session=eyJ...bbb,session=eyJ...ccc" \
//   VUS=20 \
//   k6 run booking-burst.js
//
// VUS controls burst size (default 20). Each VU makes exactly ONE booking attempt
// -- this is a single synchronized burst, not a sustained ramp (see
// options.scenarios below: executor 'per-vu-iterations' starts all VUs together).

import http from 'k6/http';
import { check, group } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3002/api';
const SALON_ID = __ENV.SALON_ID;
const SERVICE_ID = __ENV.SERVICE_ID;
const WORKER_ID = __ENV.WORKER_ID || undefined; // optional, matches CreateBookingDto.workerId
const VUS = parseInt(__ENV.VUS || '20', 10);

// Default: two days out, truncated to the next full hour -- clear of "must be in
// the future" validation (createHold rejects startsAt <= now) with margin, and a
// round hour is more likely to fall inside typical 09:00-21:00 working hours than
// picking "now + N minutes" would be. Override with a real slot on your target
// salon via STARTS_AT for a meaningful (non-404/400) result.
function defaultStartsAt() {
  const d = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(d.getUTCHours() + 1);
  return d.toISOString();
}
const STARTS_AT = __ENV.STARTS_AT || defaultStartsAt();

const rawCookies = (__ENV.SESSION_COOKIES || __ENV.SESSION_COOKIE || '').trim();
const SESSION_COOKIES = rawCookies
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);

if (!SALON_ID || !SERVICE_ID) {
  throw new Error(
    'SALON_ID and SERVICE_ID env vars are required -- point this at a real, seeded, ' +
      'approved salon + active service on the target instance. See this file\'s header comment.',
  );
}
if (SESSION_COOKIES.length === 0) {
  throw new Error(
    'SESSION_COOKIES (or SESSION_COOKIE) env var is required -- this script never drives the ' +
      "OTP login flow itself. See this file's header comment for how to obtain one.",
  );
}

const bookingDuration = new Trend('booking_req_duration', true);
const bookingCreated = new Counter('booking_created_201'); // the winner(s) -- expected to be small (<= salon capacity)
const bookingConflict = new Counter('booking_conflict_409'); // EXPECTED under contention -- see file header
const bookingUnauthorized = new Counter('booking_unauthorized_401'); // likely an expired/bad SESSION_COOKIES entry
const bookingUnexpected = new Counter('booking_unexpected_status'); // anything else -- worth a real look

export const options = {
  scenarios: {
    burst: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1, // one booking attempt per VU -- a single synchronized burst, not a ramp
      maxDuration: '30s',
    },
  },
  // No `thresholds` -- see file header. A 409-heavy result is expected, not a
  // failure to gate the build on.
};

export default function () {
  const cookie = SESSION_COOKIES[(__VU - 1) % SESSION_COOKIES.length];

  const payload = {
    salonId: SALON_ID,
    serviceId: SERVICE_ID,
    startsAt: STARTS_AT,
    ...(WORKER_ID ? { workerId: WORKER_ID } : {}),
  };

  group('POST /bookings', function () {
    const res = http.post(`${BASE_URL}/bookings`, JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      tags: { name: 'booking-burst' },
    });
    bookingDuration.add(res.timings.duration);

    if (res.status === 201) {
      bookingCreated.add(1);
    } else if (res.status === 409) {
      bookingConflict.add(1); // expected -- lock contention or capacity reached, see file header
    } else if (res.status === 401) {
      bookingUnauthorized.add(1);
    } else {
      bookingUnexpected.add(1);
    }

    // Only asserted as a `check` (recorded pass/fail rate in the summary), never as
    // a `thresholds`-based build gate -- 201 and 409 are BOTH acceptable outcomes
    // here, so this simply confirms the server responded with one of the two
    // meaningful statuses rather than silently erroring in some third way.
    check(res, {
      'booking-burst: got 201 (created) or 409 (expected contention)': (r) => r.status === 201 || r.status === 409,
    });
  });
}
