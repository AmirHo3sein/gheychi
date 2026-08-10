// search.js -- baseline load test for GET /api/search
//
// WHAT THIS IS: a k6 script that ramps virtual users up against the salon search
// endpoint and prints k6's standard summary (http_req_duration percentiles, request
// rate, error rate) at the end. There are NO pass/fail thresholds defined here --
// per this repo's baseline-first policy, nobody has run this against a real instance
// yet, so there are no numbers to assert against. Read the printed summary, decide
// what a reasonable threshold *would* be, and add it yourself once you have a
// baseline in hand.
//
// QUERY SHAPE: mirrors exactly what the real user-app frontend sends from its home
// page search (apps/user-app/app/pages/index.vue, loadSalons()): lat/lng (default
// coords there are Tehran: 35.6892/51.389), a required gender, an optional
// categoryId, and sort ('distance' | 'rating', default 'distance'). See
// apps/api/src/search/dto/search.dto.ts for the server-side contract this must
// satisfy (gender is IsIn(['women','men']), lat/lng validated as real
// lat/lng, radiusKm is optional 0.5-50 and defaults to 15km server-side per
// search.service.ts if omitted -- the real frontend never sends it, so neither
// does this script).
//
// USAGE:
//   BASE_URL=https://staging.example.com/api k6 run search.js
//
// BASE_URL must include the /api prefix (the Nest app calls
// app.setGlobalPrefix('api') in src/main.ts). Defaults to the same local dev URL
// the user-app's nuxt.config.ts falls back to.

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3002/api';

// Tehran coordinates -- same hardcoded fallback apps/user-app/app/pages/index.vue
// uses before geolocation/city-picker resolves a real position.
const DEFAULT_LAT = 35.6892;
const DEFAULT_LNG = 51.389;

// Custom metrics so the end-of-run summary breaks down search-specific outcomes
// alongside k6's built-in http_req_duration/http_req_failed. No thresholds attached
// to any of these -- they're for reading, not gating.
const searchDuration = new Trend('search_req_duration', true);
const searchOk = new Counter('search_ok_200');
const searchUnexpected = new Counter('search_unexpected_status');

// Ramp shape: a deliberate staircase of increasing concurrency, not a guess at
// "typical" traffic. The point of a baseline run is to see where (if anywhere)
// latency/error-rate starts bending as concurrent users increase -- a flat load
// profile can't show that.
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
  // Deliberately no `thresholds` key -- see file header. Adding one here would make
  // k6 evaluate pass/fail and exit non-zero on breach, which is a real assertion
  // this task explicitly says not to invent yet.
};

// Alternates gender per iteration so both halves of the catalog (women's / men's
// salons) get exercised, same as real traffic would naturally mix -- gender is
// required (IsIn(['women','men'])) and is derived from the logged-in user's own
// profile in the real app, so a single VU run represents one customer's fixed
// gender, not a random draw every request.
function genderForVU(vuId) {
  return vuId % 2 === 0 ? 'women' : 'men';
}

export default function () {
  const gender = genderForVU(__VU);
  const sort = Math.random() < 0.8 ? 'distance' : 'rating'; // distance is the default tab; rating is one tap away

  const query = {
    lat: DEFAULT_LAT,
    lng: DEFAULT_LNG,
    gender,
    sort,
  };
  const qs = Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  group('GET /search', function () {
    const res = http.get(`${BASE_URL}/search?${qs}`, {
      tags: { name: 'search' },
    });
    searchDuration.add(res.timings.duration);

    if (res.status === 200) {
      searchOk.add(1);
      check(res, {
        'search: status 200': (r) => r.status === 200,
        'search: body has items array': (r) => {
          try {
            return Array.isArray(JSON.parse(r.body).items);
          } catch {
            return false;
          }
        },
      });
    } else {
      searchUnexpected.add(1);
      check(res, { 'search: status 200': (r) => r.status === 200 });
    }
  });

  sleep(1);
}
