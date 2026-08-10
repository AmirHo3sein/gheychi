#!/usr/bin/env node
// post-deploy-smoke-test.js -- standalone post-deploy health check.
//
// WHAT THIS IS: a plain Node.js script (built-in `fetch`, no dependencies) that hits
// a small set of read-only, unauthenticated endpoints on a real deployed instance and
// confirms the deployment is actually healthy end-to-end -- not just "the process
// started", but "the DB is reachable, Redis is reachable, PostGIS-backed search
// works, and reference data (categories/cities) was seeded". Run it by hand right
// after a deploy, against staging or production.
//
// This is a standalone operator tool, same spirit as ../load-tests/: it is NOT wired
// into any CI/CD pipeline or GitHub Actions workflow. Nothing runs it automatically.
// You run it manually, on demand, right after a deploy, and read the output yourself
// (or wire it into your own manual CI gate later, using its exit code).
//
// SAFETY: every check here is a GET against a public, unauthenticated endpoint. No
// login, no OTP, no booking creation, nothing that mutates state -- this is
// deliberately always safe to run against a live production instance.
//
// REQUEST SHAPES: verified against the real source, not guessed --
//   - apps/api/src/health/health.controller.ts       (health / liveness / readiness)
//   - apps/api/src/search/dto/search.dto.ts           (SearchQueryDto: lat/lng/gender)
//   - apps/api/src/search/search.service.ts           (response shape: { items, ... })
//   - apps/api/src/catalog/catalog.controller.ts      (GET /categories -> ServiceCategory[])
//   - apps/api/src/cities/cities.controller.ts        (GET /cities -> PublicCity[])
// See each check function below for the specific line of reasoning.
//
// USAGE:
//   BASE_URL=https://staging.example.com/api node post-deploy-smoke-test.js
//
// BASE_URL must include the /api prefix (the Nest app calls app.setGlobalPrefix('api')
// in apps/api/src/main.ts). Defaults to the same local dev URL load-tests/*.js use
// (http://localhost:3002/api) so it's also useful as a quick local sanity check.
//
// EXIT CODE: 0 if every check passes, 1 if any check fails (or errors/times out) --
// safe to use as a manual pass/fail gate.

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3002/api').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS) || 10_000;

// Tehran coordinates -- same fallback apps/user-app/app/pages/index.vue uses before
// geolocation/city-picker resolves a real position, and the same ones load-tests/
// search.js sends. Any valid lat/lng works here; these are just realistic ones.
const SEARCH_LAT = 35.6892;
const SEARCH_LNG = 51.389;

async function fetchJson(path) {
  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    let body;
    try {
      body = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    return { url, status: res.status, body, rawText: text };
  } finally {
    clearTimeout(timer);
  }
}

// Each check returns { name, ok, detail }. `detail` is only shown on failure (or with
// VERBOSE=1), so a clean passing run stays short and skimmable.

// GET /api/health -- HealthController#check. Same handler body as /api/readiness
// (checkDependencies()): pings Postgres with `SELECT 1` and Redis with `PING`, and
// only returns 200 { status: 'ok', db: 'ok', redis: 'ok' } if both succeed within
// 2s. On any dependency failure it throws ServiceUnavailableException (503) with
// { status: 'error', db, redis }, so a non-200 here already tells you which
// dependency is down.
async function checkHealth() {
  const name = 'GET /health';
  const { status, body } = await fetchJson('/health');
  if (status !== 200) {
    return { name, ok: false, detail: `expected 200, got ${status}: ${JSON.stringify(body)}` };
  }
  if (body?.status !== 'ok' || body?.db !== 'ok' || body?.redis !== 'ok') {
    return { name, ok: false, detail: `unexpected body: ${JSON.stringify(body)}` };
  }
  return { name, ok: true };
}

// GET /api/liveness -- HealthController#liveness. Deliberately does NOT touch DB/Redis
// (see the controller's own comment: a liveness probe must not fail just because a
// dependency blipped). Just confirms the process can respond at all: 200 { status: 'ok' }.
async function checkLiveness() {
  const name = 'GET /liveness';
  const { status, body } = await fetchJson('/liveness');
  if (status !== 200) {
    return { name, ok: false, detail: `expected 200, got ${status}: ${JSON.stringify(body)}` };
  }
  if (body?.status !== 'ok') {
    return { name, ok: false, detail: `unexpected body: ${JSON.stringify(body)}` };
  }
  return { name, ok: true };
}

// GET /api/readiness -- HealthController#readiness. Same checkDependencies() as
// /api/health, exposed under its own name; same expected shape.
async function checkReadiness() {
  const name = 'GET /readiness';
  const { status, body } = await fetchJson('/readiness');
  if (status !== 200) {
    return { name, ok: false, detail: `expected 200, got ${status}: ${JSON.stringify(body)}` };
  }
  if (body?.status !== 'ok' || body?.db !== 'ok' || body?.redis !== 'ok') {
    return { name, ok: false, detail: `unexpected body: ${JSON.stringify(body)}` };
  }
  return { name, ok: true };
}

// GET /api/search -- SearchController#run -> SearchQueryDto. Required fields per the
// DTO (apps/api/src/search/dto/search.dto.ts) are `lat` (IsLatitude), `lng`
// (IsLongitude), and `gender` (IsIn(['women','men'])) -- everything else (radiusKm,
// categoryId, sort, cursor, pageSize) is optional. A 200 here means: the query
// validated, SearchService ran its PostGIS-backed radius query against the real DB,
// and the process serialized a response -- i.e. the search path + DB + PostGIS
// extension are all actually working, not just "the server is up". Response shape
// per search.service.ts's return statement is { items: [...], nextCursor, hasMore };
// an empty `items` array is a valid, healthy response (just no salons near these
// coordinates on this instance) so this check only asserts `items` is an array, not
// that it's non-empty.
async function checkSearch() {
  const name = 'GET /search';
  const qs = new URLSearchParams({ lat: String(SEARCH_LAT), lng: String(SEARCH_LNG), gender: 'women' });
  const { status, body } = await fetchJson(`/search?${qs.toString()}`);
  if (status !== 200) {
    return { name, ok: false, detail: `expected 200, got ${status}: ${JSON.stringify(body)}` };
  }
  if (!Array.isArray(body?.items)) {
    return { name, ok: false, detail: `expected body.items to be an array, got: ${JSON.stringify(body)}` };
  }
  return { name, ok: true };
}

// GET /api/categories -- CatalogController#list (apps/api/src/catalog/catalog.controller.ts).
// Parameter-less, returns ServiceCategory[] straight from the DB (or Redis cache).
// A non-empty array confirms the categories reference table was actually seeded on
// this instance, not just that the endpoint responds.
async function checkCategories() {
  const name = 'GET /categories';
  const { status, body } = await fetchJson('/categories');
  if (status !== 200) {
    return { name, ok: false, detail: `expected 200, got ${status}: ${JSON.stringify(body)}` };
  }
  if (!Array.isArray(body) || body.length === 0) {
    return { name, ok: false, detail: `expected a non-empty array, got: ${JSON.stringify(body)}` };
  }
  return { name, ok: true };
}

// GET /api/cities -- CitiesController#list (apps/api/src/cities/cities.controller.ts).
// Returns PublicCity[] from the DB. A non-empty array confirms the cities reference
// table was actually seeded on this instance.
async function checkCities() {
  const name = 'GET /cities';
  const { status, body } = await fetchJson('/cities');
  if (status !== 200) {
    return { name, ok: false, detail: `expected 200, got ${status}: ${JSON.stringify(body)}` };
  }
  if (!Array.isArray(body) || body.length === 0) {
    return { name, ok: false, detail: `expected a non-empty array, got: ${JSON.stringify(body)}` };
  }
  return { name, ok: true };
}

const CHECKS = [
  { name: 'GET /health', fn: checkHealth },
  { name: 'GET /liveness', fn: checkLiveness },
  { name: 'GET /readiness', fn: checkReadiness },
  { name: 'GET /search', fn: checkSearch },
  { name: 'GET /categories', fn: checkCategories },
  { name: 'GET /cities', fn: checkCities },
];

async function main() {
  console.log(`Post-deploy smoke test`);
  console.log(`Target: ${BASE_URL}`);
  console.log('');

  const results = [];
  for (const { name, fn } of CHECKS) {
    let result;
    try {
      result = await fn();
    } catch (err) {
      const isAbort = err?.name === 'AbortError';
      result = {
        name,
        ok: false,
        detail: isAbort ? `timed out after ${TIMEOUT_MS}ms` : `${err?.message || err}`,
      };
    }
    results.push(result);
    const mark = result.ok ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${result.name}`);
    if (!result.ok && result.detail) {
      console.log(`       ${result.detail}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log('');
  console.log('----------------------------------------');
  if (failed.length === 0) {
    console.log(`All ${results.length} checks passed. Deployment looks healthy.`);
    process.exit(0);
  } else {
    console.log(`${failed.length}/${results.length} check(s) FAILED:`);
    for (const r of failed) {
      console.log(`  - ${r.name}${r.detail ? `: ${r.detail}` : ''}`);
    }
    console.log('Deployment is NOT healthy -- investigate before declaring this deploy good.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Smoke test runner crashed unexpectedly:', err);
  process.exit(1);
});
