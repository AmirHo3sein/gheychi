#!/usr/bin/env node
// postgres-outage-during-read.js -- chaos test: kill the Postgres container while a
// real GET request to a simple, public, read-only endpoint is in flight, and confirm
// the API fails that request cleanly (a clear error response, in bounded time, with no
// stack trace leaked to the client) instead of hanging or crashing the process. Then
// restarts Postgres and confirms the very next request succeeds normally -- proving the
// connection pool recovers on its own, with no app restart required.
//
// WHAT THIS IS: a plain Node.js script (built-in `fetch`, no dependencies) that shells
// out to the local `docker` CLI to kill/restart a real container -- same "shell out via
// child_process where needed" convention this repo's own e2e prep scripts use (see
// apps/user-app/e2e/prepare-db.cjs, apps/provider-panel/e2e/prepare-db.cjs,
// apps/admin-panel/e2e/prepare-db.cjs). Nothing here is a new test framework: it's one
// script, run by hand.
//
// This is a standalone operator tool, same spirit as ../load-tests/ and
// ../smoke-tests/: it is NOT part of the pnpm workspace, NOT wired into any CI/CD
// workflow (.github/workflows/), and NOT wired into any app's `test` or `test:e2e`
// script. Nothing runs it automatically -- you run it manually, on demand, against a
// stack you control and are deliberately fault-injecting.
//
// ============================================================================
// DO NOT RUN THIS AGAINST STAGING OR PRODUCTION. EVER.
// ============================================================================
// Unlike ../smoke-tests/post-deploy-smoke-test.js (read-only GETs, always safe against a
// live instance) and ../load-tests/*.js (extra HTTP traffic, safe to point at staging),
// THIS SCRIPT KILLS A REAL DOCKER CONTAINER BY NAME. Killing the wrong Postgres
// container mid-flow breaks every real request that instance is serving until someone
// restarts it -- including everyone else's real reads and writes, if you point this at
// anything shared. This script only ever talks to a Docker daemon reachable from the
// machine it runs on (via `docker`/`DOCKER_HOST`), so it CANNOT reach a genuinely remote
// staging/production Postgres -- but if you run it on a box that itself hosts a shared
// staging/production Docker stack, it absolutely can hurt that stack. Run this only
// against a local dev stack (`docker compose up`, this repo's own `docker-compose.yml`)
// or a dedicated, disposable chaos-testing stack nobody else is using.
//
// The script itself refuses to run against a non-localhost BASE_URL unless you
// explicitly opt in (see I_KNOW_THIS_KILLS_CONTAINERS below) -- but that check is a
// backstop, not a substitute for you knowing what host and what Docker daemon this is
// about to touch.
//
// READ-ONLY / NON-DESTRUCTIVE TO DATA: this script only ever issues GET requests --
// nothing here logs in, writes, or mutates any row. Postgres itself is
// crash-safe-by-design (write-ahead logging is exactly what lets `docker kill` +
// `docker start` be a completely standard, safe way to simulate a hard outage and
// recovery -- this is not a special risk this script introduces).
//
// WHY `docker kill`, NOT `docker pause`: `docker pause` freezes the container's process
// (SIGSTOP) but leaves its TCP socket open and established -- the pg driver TypeORM uses
// here is not configured with any connection/statement timeout anywhere in this codebase
// (apps/api/src/data-source.ts uses bare `type: 'postgres'` options, no `extra` pool
// config). Against a PAUSED container, a query that's already in flight just sits
// waiting for a reply that will never come until the process is unfrozen -- i.e. the
// request would genuinely hang for the entire pause, not fail cleanly, which defeats the
// point of this test. `docker kill` actually closes the TCP connection (the client sees
// a real connection-reset/refused error), which is both a more realistic outage
// simulation and the only way to observe a bounded, non-hanging failure with this
// codebase's current (timeout-less) client configuration. `docker start` afterwards
// brings the same container back (not a fresh one -- same volume, same data, same
// schema).
//
// WHAT'S BEING EXERCISED: `GET /api/search` (SearchController -> SearchService, see
// apps/api/src/search/search.service.ts) runs a real PostGIS-backed query against
// Postgres on every call -- no caching layer sits in front of it, unlike
// `GET /api/categories` (Redis-cached, see catalog.controller.ts) or `GET /api/cities`
// (cached in-process for the life of the process, see cities.service.ts) which would
// both mask a mid-outage Postgres failure behind a still-warm cache on any request after
// the first. `/search` is chosen over the task's original `GET /salons` example for
// exactly this reason -- there is no plain "list all salons" endpoint in this codebase
// (SalonsController only exposes `GET /salons/mine` (authenticated) and
// `GET /salons/:slug` (public, needs a real seeded slug)) -- `/search` is public,
// needs no seed data to return a well-formed (possibly empty) response, and guarantees a
// fresh DB round-trip on every single call, which is exactly what this test needs to
// observe. Once the connection drops, the pg pool's in-flight query rejects with a
// connection error, which is an unhandled, non-HttpException error inside a Nest request
// handler -- GlobalExceptionFilter (apps/api/src/error-tracking/global-exception.filter.ts)
// lets that fall through to Nest's own default handling: a 500 with a generic
// `{"statusCode":500,"message":"Internal server error"}` body, NOT a raw stack trace.
// This script confirms that chain actually holds under a real outage, and -- the part
// that can't be confirmed by reading the code at all -- that the pg connection pool
// actually recovers and serves the very next request normally once Postgres is back, with
// no app restart.
//
// KNOWN, EXPECTED BEHAVIOR -- READ BEFORE ALARMED BY A SLOW FAILURE:
// The in-flight query's rejection is usually fast once the TCP connection actually drops
// (well under a second), but the very first request AFTER `docker kill` might instead hit
// "connection refused" while Postgres is still down, or a slower failure while a fresh
// pool connection attempt is retried -- either way this script's REQUEST_TIMEOUT_MS
// (default 15000) gives real headroom before calling it a hang. Similarly, Postgres
// itself can take a few real seconds after `docker start` to finish accepting
// connections again (WAL/crash recovery on a hard-killed process, even though it's a
// completely normal, safe recovery) -- RECOVERY_SETTLE_MS (default 3000) and
// RECOVERY_RETRY_MS/RECOVERY_MAX_WAIT_MS below exist to poll for that rather than assume
// a fixed wait is always enough.
//
// USAGE:
//   node postgres-outage-during-read.js
//
// (No auth, no seed data required -- /search is public and always returns a
// well-formed response, even an empty one, against any properly migrated instance.)
//
// ENV VARS:
//   BASE_URL                     Target API base URL, including /api prefix. Default
//                                 http://localhost:3002/api (same fallback
//                                 ../smoke-tests and ../load-tests use).
//   POSTGRES_CONTAINER            Docker container name to kill/restart. Default
//                                 gheychi-postgres-1 -- the name `docker compose`
//                                 derives from this repo's own docker-compose.yml
//                                 (`name: gheychi`, service `postgres`) on a fresh
//                                 `docker compose up`. Override if your local container
//                                 is named differently (check with `docker ps`).
//   DOCKER_BIN                    Docker CLI binary to shell out to. Default `docker`.
//   REQUEST_TIMEOUT_MS            Client-side abort timeout for the in-outage request.
//                                 Default 15000. If the request is aborted at this
//                                 timeout, the script reports it as a FAIL (a real hang,
//                                 not tolerated).
//   RECOVERY_SETTLE_MS            Initial wait after `docker start`, before polling for
//                                 recovery. Default 3000.
//   RECOVERY_POLL_INTERVAL_MS     Interval between recovery polls if the first
//                                 post-restart request doesn't immediately succeed.
//                                 Default 1000.
//   RECOVERY_MAX_WAIT_MS          Total time budget for recovery polling before giving
//                                 up and reporting FAIL. Default 20000. This is
//                                 generous specifically so a slow Postgres crash-recovery
//                                 doesn't get misreported as "the pool never recovers" --
//                                 read the final PASS/FAIL line's timing, not just the
//                                 verdict, to see how long recovery actually took.
//   I_KNOW_THIS_KILLS_CONTAINERS  Set to `1` to allow running against a non-localhost
//                                 BASE_URL. See the safety section above. Leave unset
//                                 for ordinary local use.

const { execFileSync } = require('node:child_process');

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3002/api').replace(/\/+$/, '');
const POSTGRES_CONTAINER = process.env.POSTGRES_CONTAINER || 'gheychi-postgres-1';
const DOCKER_BIN = process.env.DOCKER_BIN || 'docker';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 15_000;
const RECOVERY_SETTLE_MS = Number(process.env.RECOVERY_SETTLE_MS) || 3_000;
const RECOVERY_POLL_INTERVAL_MS = Number(process.env.RECOVERY_POLL_INTERVAL_MS) || 1_000;
const RECOVERY_MAX_WAIT_MS = Number(process.env.RECOVERY_MAX_WAIT_MS) || 20_000;

// Same Tehran fallback coordinates ../smoke-tests/post-deploy-smoke-test.js and
// ../load-tests/search.js use -- any valid lat/lng works, these are just realistic ones.
const SEARCH_LAT = 35.6892;
const SEARCH_LNG = 51.389;

function fail(msg) {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
}

function assertLooksLocal() {
  let hostname;
  try {
    hostname = new URL(BASE_URL).hostname;
  } catch {
    fail(`BASE_URL is not a valid URL: ${BASE_URL}`);
    return;
  }
  const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
  if (LOCAL_HOSTNAMES.has(hostname)) return;
  if (process.env.I_KNOW_THIS_KILLS_CONTAINERS === '1') {
    console.warn(
      `WARNING: BASE_URL (${BASE_URL}) is not localhost, and I_KNOW_THIS_KILLS_CONTAINERS=1 ` +
        'was set, so continuing. This script is about to kill a real Docker container on ' +
        'whatever Docker daemon this machine talks to -- make triple sure that is a ' +
        'dedicated, disposable chaos-testing stack, never anything staging or production ' +
        'depends on.',
    );
    return;
  }
  fail(
    `BASE_URL (${BASE_URL}) does not look like a local dev instance (hostname "${hostname}" is ` +
      "not localhost/127.0.0.1). Refusing to run: this script kills a real Docker container " +
      "and must never be pointed at anything that could be staging or production. If you're " +
      'certain this targets a dedicated, disposable chaos-testing stack, set ' +
      'I_KNOW_THIS_KILLS_CONTAINERS=1 to proceed. See this file\'s header comment.',
  );
}

function dockerContainerRunning(container) {
  try {
    const out = execFileSync(DOCKER_BIN, ['inspect', '--format', '{{.State.Running}}', container], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
    return out === 'true';
  } catch (err) {
    fail(
      `could not inspect container "${container}" via "${DOCKER_BIN} inspect" -- is Docker ` +
        `running, and does a container with that name exist ("${DOCKER_BIN} ps -a")? ` +
        `Underlying error: ${err.message}`,
    );
    return false;
  }
}

function dockerKill(container) {
  console.log(`Killing container "${container}" (${DOCKER_BIN} kill)...`);
  execFileSync(DOCKER_BIN, ['kill', container], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function dockerStart(container) {
  console.log(`Restarting container "${container}" (${DOCKER_BIN} start)...`);
  execFileSync(DOCKER_BIN, ['start', container], { stdio: ['ignore', 'pipe', 'pipe'] });
}

async function getSearch(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const qs = new URLSearchParams({ lat: String(SEARCH_LAT), lng: String(SEARCH_LNG), gender: 'women' });
  try {
    const res = await fetch(`${BASE_URL}/search?${qs.toString()}`, { signal: controller.signal });
    const text = await res.text();
    let body;
    try {
      body = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    return { timedOut: false, status: res.status, body, rawText: text, durationMs: Date.now() - startedAt };
  } catch (err) {
    const isAbort = err?.name === 'AbortError';
    return { timedOut: isAbort, error: isAbort ? undefined : err, durationMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

// Same leak heuristic as redis-outage-during-booking-hold.js -- see that file's comment
// for the reasoning. Nest's default sanitized 500 body is
// `{"statusCode":500,"message":"Internal server error"}`.
function looksLikeStackLeak(rawText) {
  if (!rawText) return false;
  return /\bat [\w.<>]+ \(?.*:\d+:\d+/.test(rawText) || /node_modules/.test(rawText) || /"stack"/i.test(rawText);
}

async function main() {
  assertLooksLocal();

  console.log('Postgres-outage-during-read chaos test');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Postgres container: ${POSTGRES_CONTAINER}`);
  console.log('');

  if (!dockerContainerRunning(POSTGRES_CONTAINER)) {
    fail(
      `container "${POSTGRES_CONTAINER}" is not running (or doesn't exist) -- start your local ` +
        `stack ("docker compose up -d") and confirm the name with "${DOCKER_BIN} ps" ` +
        '(override via POSTGRES_CONTAINER if it differs).',
    );
    return;
  }

  console.log('Baseline check: confirming GET /search works before injecting any fault...');
  const baseline = await getSearch(REQUEST_TIMEOUT_MS);
  if (baseline.timedOut || baseline.error || baseline.status !== 200) {
    fail(
      `baseline GET /search did not succeed before any fault was injected (status=${baseline.status ?? 'n/a'}, ` +
        `error=${baseline.error?.message ?? 'n/a'}, timedOut=${baseline.timedOut}) -- fix the target instance ` +
        'first; this script only tests degradation/recovery, not a broken-from-the-start API.',
    );
    return;
  }
  console.log(`[OK] baseline GET /search returned 200 in ${baseline.durationMs}ms.`);
  console.log('');

  let outagePassed = false;
  let recoveryPassed = false;

  try {
    dockerKill(POSTGRES_CONTAINER);
    console.log('');
    console.log(`Postgres killed. Sending GET /search (timeout ${REQUEST_TIMEOUT_MS}ms)...`);

    const result = await getSearch(REQUEST_TIMEOUT_MS);

    if (result.timedOut) {
      console.log(`[FAIL] request never answered within ${REQUEST_TIMEOUT_MS}ms -- looks like a real hang.`);
      console.log(
        '       This means the pg connection pool is blocking the request indefinitely during a ' +
          "Postgres outage, rather than eventually rejecting. That's a genuine resilience bug worth " +
          "filing -- see this file's KNOWN, EXPECTED BEHAVIOR section for what a correct (bounded) " +
          'failure looks like.',
      );
    } else if (result.error) {
      console.log(`[FAIL] request errored unexpectedly (not a clean HTTP response, not a timeout): ${result.error.message}`);
    } else if (result.status >= 500 && result.status < 600) {
      if (looksLikeStackLeak(result.rawText)) {
        console.log(`[FAIL] got ${result.status} in ${result.durationMs}ms, but the response body looks like it leaks internals:`);
        console.log(`       ${result.rawText.slice(0, 300)}`);
      } else {
        console.log(`[PASS] got a clean ${result.status} error in ${result.durationMs}ms, body: ${JSON.stringify(result.body ?? result.rawText)}`);
        outagePassed = true;
      }
    } else {
      console.log(
        `[FAIL] expected a 5xx error while Postgres is down, got ${result.status} in ${result.durationMs}ms instead ` +
          `(body: ${JSON.stringify(result.body ?? result.rawText)}). Either the kill didn't take effect in time, or ` +
          'the request unexpectedly succeeded without Postgres -- worth a closer look either way.',
      );
    }
  } finally {
    // ALWAYS restart, even if the assertions above threw or failed -- leaving Postgres
    // dead would silently break every other request against this stack (and every other
    // app in this monorepo pointed at the same instance) until someone notices and
    // manually restarts it by hand.
    try {
      dockerStart(POSTGRES_CONTAINER);
    } catch (err) {
      console.error(
        `FATAL: failed to restart "${POSTGRES_CONTAINER}" after the test (${err.message}). ` +
          `Restart it yourself right now: ${DOCKER_BIN} start ${POSTGRES_CONTAINER}`,
      );
      process.exit(1);
    }
  }

  console.log('');
  console.log(`Waiting ${RECOVERY_SETTLE_MS}ms for Postgres to finish starting, then polling for recovery ` +
    `(up to ${RECOVERY_MAX_WAIT_MS}ms total)...`);
  await new Promise((resolve) => setTimeout(resolve, RECOVERY_SETTLE_MS));

  // Polls with GET /search itself (not e.g. `pg_isready` inside the container) --
  // deliberately: the thing being confirmed is "the APPLICATION's own connection pool
  // recovers and serves a real request again", which is a stronger and more relevant
  // claim than "the Postgres server process itself is accepting TCP connections again".
  // A pool that never reconnects (e.g. one that decided the DB was permanently gone and
  // gave up) would pass a raw pg_isready check while still failing every real request --
  // that's exactly the class of bug this script exists to catch.
  const recoveryDeadline = Date.now() + RECOVERY_MAX_WAIT_MS;
  let recovery;
  let attempt = 0;
  do {
    attempt += 1;
    recovery = await getSearch(REQUEST_TIMEOUT_MS);
    if (!recovery.timedOut && !recovery.error && recovery.status === 200 && Array.isArray(recovery.body?.items)) {
      break;
    }
    if (Date.now() >= recoveryDeadline) break;
    console.log(
      `  poll #${attempt}: not recovered yet (status=${recovery.status ?? 'n/a'}, ` +
        `error=${recovery.error?.message ?? 'n/a'}, timedOut=${recovery.timedOut}) -- retrying in ` +
        `${RECOVERY_POLL_INTERVAL_MS}ms...`,
    );
    await new Promise((resolve) => setTimeout(resolve, RECOVERY_POLL_INTERVAL_MS));
  } while (Date.now() < recoveryDeadline);

  if (recovery.timedOut) {
    console.log(`[FAIL] recovery polling gave up after ${attempt} attempt(s): last request never answered within ${REQUEST_TIMEOUT_MS}ms.`);
  } else if (recovery.error) {
    console.log(`[FAIL] recovery polling gave up after ${attempt} attempt(s): last request errored: ${recovery.error.message}`);
  } else if (recovery.status === 200 && Array.isArray(recovery.body?.items)) {
    console.log(
      `[PASS] recovery confirmed after ${attempt} attempt(s): GET /search returned 200 with a well-formed ` +
        `body in ${recovery.durationMs}ms -- the connection pool recovered with no app restart.`,
    );
    recoveryPassed = true;
  } else {
    console.log(
      `[FAIL] recovery polling gave up after ${attempt} attempt(s): last response was status=${recovery.status} ` +
        `body=${JSON.stringify(recovery.body ?? recovery.rawText)} -- the app may not have recovered cleanly ` +
        'after the outage.',
    );
  }

  console.log('');
  console.log('----------------------------------------');
  if (outagePassed && recoveryPassed) {
    console.log('PASS: clean error during Postgres outage, and the pool recovered on its own afterwards.');
    process.exit(0);
  } else {
    console.log('FAIL: see [FAIL] lines above.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Chaos test runner crashed unexpectedly:', err);
  console.error(
    `If Postgres is still dead, restart it now: ${DOCKER_BIN} start ${POSTGRES_CONTAINER}`,
  );
  process.exit(1);
});
