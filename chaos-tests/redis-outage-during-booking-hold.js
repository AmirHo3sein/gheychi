#!/usr/bin/env node
// redis-outage-during-booking-hold.js -- chaos test: kill the Redis container while a
// real POST /api/bookings request is trying to acquire the per-salon booking lock, and
// confirm the API fails that request cleanly (a clear error response, in bounded time,
// with no stack trace leaked to the client) instead of hanging or crashing the process.
// Then restarts Redis and confirms the API is usable again on the very next request,
// with no app restart of its own.
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
// THIS SCRIPT KILLS A REAL DOCKER CONTAINER BY NAME. Killing the wrong Redis container
// mid-flow breaks every real request that instance is serving until someone restarts it
// -- including other people's real bookings, if you point this at anything shared. This
// script only ever talks to a Docker daemon reachable from the machine it runs on (via
// `docker`/`DOCKER_HOST`), so it CANNOT reach a genuinely remote staging/production
// Redis -- but if you run it on a box that itself hosts a shared staging/production
// Docker stack, it absolutely can hurt that stack. Run this only against a local dev
// stack (`docker compose up`, this repo's own `docker-compose.yml`) or a dedicated,
// disposable chaos-testing stack nobody else is using.
//
// The script itself refuses to run against a non-localhost BASE_URL unless you
// explicitly opt in (see I_KNOW_THIS_KILLS_CONTAINERS below) -- but that check is a
// backstop, not a substitute for you knowing what host and what Docker daemon this is
// about to touch.
//
// WHY `docker kill`, NOT `docker pause`: `docker pause` freezes the container's process
// (SIGSTOP) but leaves its TCP socket open and established -- neither ioredis (used
// here) nor the pg driver (see postgres-outage-during-read.js) is configured with a
// command/connection timeout anywhere in this codebase (apps/api/src/redis/
// redis.module.ts and apps/api/src/data-source.ts both use bare defaults). Against a
// PAUSED container, a client that already has a connection open just sits waiting for a
// reply that will never come until the process is unfrozen -- i.e. the request would
// genuinely hang for the entire pause, not fail cleanly, which defeats the point of this
// test. `docker kill` actually closes the TCP connection (the client sees a real
// connection-reset/refused error), which is both a more realistic outage simulation and
// the only way to observe a bounded, non-hanging failure with this codebase's current
// (timeout-less) client configuration. `docker start` afterwards brings the same
// container back (not a fresh one -- same volume, same data).
//
// WHAT'S BEING EXERCISED: BookingsService#acquireSalonLock in
// apps/api/src/booking/bookings.service.ts does an unguarded `await this.redis.set(...)`
// (NX lock acquire) as the very first step of createHoldImpl, before any DB work. Once
// the connection drops, ioredis's default reconnect logic (retryStrategy, uncapped
// number of reconnect attempts) kicks in, and the in-flight command sits in ioredis's
// offline queue waiting for reconnection, up to its default `maxRetriesPerRequest` (20)
// command-level retries before rejecting. That rejection is an unhandled,
// non-HttpException error inside a Nest request handler, which GlobalExceptionFilter
// (apps/api/src/error-tracking/global-exception.filter.ts) lets fall through to Nest's
// own default handling: a 500 with a generic
// `{"statusCode":500,"message":"Internal server error"}` body, NOT a raw stack trace.
// This script's whole point is to confirm that chain actually holds under a real outage
// -- that "the lock call eventually rejects instead of hanging forever" and "the
// response body never leaks internals" are true in practice, not just true by reading
// the code.
//
// KNOWN, EXPECTED BEHAVIOR -- READ BEFORE ALARMED BY A SLOW FAILURE:
// Because ioredis retries reconnecting before giving up on a queued command, the failing
// request is NOT instant -- expect it to take real seconds before the 500 arrives. That
// is a slow, correct failure, not a hang. This script's REQUEST_TIMEOUT_MS (default
// 20000) exists to draw the actual line between "slow but it answered" (pass) and "never
// answered" (fail, a real bug worth filing -- it would mean a genuine Redis outage can
// wedge a booking request indefinitely).
//
// SAFETY OF WHAT IT BOOKS: the booking attempt this script makes is expected to FAIL
// (that's the entire test). It is deliberately non-destructive to real data: if Redis
// somehow answers anyway (kill/restart raced the request, or you re-run this against an
// already-recovered stack), the createHold call would proceed as a completely normal
// booking against whatever salon/service you pointed it at -- so, same as
// ../load-tests/booking-burst.js, point SALON_ID/SERVICE_ID at a real seeded salon+
// service on a local/dev/disposable stack you don't mind creating a test booking on, not
// anything resembling a production salon's real calendar.
//
// AUTH: same convention as ../load-tests/booking-burst.js -- this script never drives
// the OTP login flow itself (see that file's header comment for the full reasoning and
// for exactly how to obtain a session cookie against your target instance without this
// script touching OTP). You log in once, by hand, ahead of time, and hand this script
// the resulting cookie via SESSION_COOKIE.
//
// USAGE:
//   SALON_ID=<uuid> \
//   SERVICE_ID=<uuid> \
//   SESSION_COOKIE="session=eyJ..." \
//   node redis-outage-during-booking-hold.js
//
// ENV VARS:
//   BASE_URL                     Target API base URL, including /api prefix. Default
//                                 http://localhost:3002/api (same fallback
//                                 ../smoke-tests and ../load-tests use).
//   SALON_ID, SERVICE_ID          Required. A real, seeded, approved salon + active
//                                 service on the target instance (same requirement as
//                                 ../load-tests/booking-burst.js).
//   WORKER_ID                     Optional, matches CreateBookingDto.workerId.
//   STARTS_AT                     Optional ISO datetime. Defaults to 2 days out,
//                                 truncated to the next full hour (same default
//                                 ../load-tests/booking-burst.js uses).
//   SESSION_COOKIE                Required. One "session=<jwt>" cookie value from a
//                                 real login you performed yourself. See AUTH above.
//   REDIS_CONTAINER               Docker container name to kill/restart. Default
//                                 gheychi-redis-1 -- the name `docker compose` derives
//                                 from this repo's own docker-compose.yml (`name:
//                                 gheychi`, service `redis`) on a fresh `docker compose
//                                 up`. Override if your local container is named
//                                 differently (check with `docker ps`).
//   DOCKER_BIN                    Docker CLI binary to shell out to. Default `docker`.
//   REQUEST_TIMEOUT_MS            Client-side abort timeout for the in-outage request.
//                                 Default 20000 -- see KNOWN, EXPECTED BEHAVIOR above
//                                 for why this needs headroom past a typical HTTP
//                                 timeout. If the request is aborted at this timeout,
//                                 the script reports it as a FAIL (a real hang, not
//                                 tolerated).
//   RECOVERY_SETTLE_MS            Wait after restarting Redis, before the recovery
//                                 request. Default 1000 -- gives the container a moment
//                                 to finish accepting connections again (Redis itself
//                                 starts almost instantly, but the moment covers ioredis
//                                 noticing the socket is back too).
//   I_KNOW_THIS_KILLS_CONTAINERS  Set to `1` to allow running against a non-localhost
//                                 BASE_URL. See the safety section above. Leave unset
//                                 for ordinary local use.

const { execFileSync } = require('node:child_process');

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3002/api').replace(/\/+$/, '');
const SALON_ID = process.env.SALON_ID;
const SERVICE_ID = process.env.SERVICE_ID;
const WORKER_ID = process.env.WORKER_ID || undefined;
const SESSION_COOKIE = process.env.SESSION_COOKIE;
const REDIS_CONTAINER = process.env.REDIS_CONTAINER || 'gheychi-redis-1';
const DOCKER_BIN = process.env.DOCKER_BIN || 'docker';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 20_000;
const RECOVERY_SETTLE_MS = Number(process.env.RECOVERY_SETTLE_MS) || 1_000;

function defaultStartsAt() {
  // Same defaulting as ../load-tests/booking-burst.js: 2 days out, next full hour --
  // clear of "must be in the future" validation with margin, more likely inside
  // typical 09:00-21:00 working hours than "now + N minutes".
  const d = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(d.getUTCHours() + 1);
  return d.toISOString();
}
const STARTS_AT = process.env.STARTS_AT || defaultStartsAt();

function fail(msg) {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
}

if (!SALON_ID || !SERVICE_ID) {
  fail(
    'SALON_ID and SERVICE_ID env vars are required -- point this at a real, seeded, ' +
      'approved salon + active service on a local/dev instance. See this file\'s header comment.',
  );
}
if (!SESSION_COOKIE) {
  fail(
    'SESSION_COOKIE env var is required -- this script never drives the OTP login flow ' +
      "itself. See this file's header comment (AUTH section) for how to obtain one.",
  );
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

async function postBooking(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const payload = {
    salonId: SALON_ID,
    serviceId: SERVICE_ID,
    startsAt: STARTS_AT,
    ...(WORKER_ID ? { workerId: WORKER_ID } : {}),
  };
  try {
    const res = await fetch(`${BASE_URL}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: SESSION_COOKIE },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
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

// A response body counts as "leaking a stack trace" if it contains anything that looks
// like a JS stack frame (a "at " line with a file reference) or a raw error class name
// Nest wouldn't put in its own sanitized default body. Nest's default 500 body is
// `{"statusCode":500,"message":"Internal server error"}` -- anything with `stack`,
// `.ts:`/`.js:` line references, or `node_modules` in it is a real leak, not expected
// output.
function looksLikeStackLeak(rawText) {
  if (!rawText) return false;
  return /\bat [\w.<>]+ \(?.*:\d+:\d+/.test(rawText) || /node_modules/.test(rawText) || /"stack"/i.test(rawText);
}

async function main() {
  assertLooksLocal();

  console.log('Redis-outage-during-booking-hold chaos test');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Redis container: ${REDIS_CONTAINER}`);
  console.log('');

  if (!dockerContainerRunning(REDIS_CONTAINER)) {
    fail(
      `container "${REDIS_CONTAINER}" is not running (or doesn't exist) -- start your local ` +
        `stack ("docker compose up -d") and confirm the name with "${DOCKER_BIN} ps" ` +
        '(override via REDIS_CONTAINER if it differs).',
    );
    return;
  }

  let outagePassed = false;
  let recoveryPassed = false;

  try {
    dockerKill(REDIS_CONTAINER);
    console.log('');
    console.log(`Redis killed. Sending POST /bookings (timeout ${REQUEST_TIMEOUT_MS}ms)...`);

    const result = await postBooking(REQUEST_TIMEOUT_MS);

    if (result.timedOut) {
      console.log(`[FAIL] request never answered within ${REQUEST_TIMEOUT_MS}ms -- looks like a real hang.`);
      console.log(
        '       This means acquireSalonLock\'s await this.redis.set(...) call is blocking the ' +
          "request indefinitely during a Redis outage, rather than eventually rejecting. That's a " +
          'genuine resilience bug worth filing, not expected behavior -- see this file\'s KNOWN, ' +
          'EXPECTED BEHAVIOR section for what a correct (slow-but-bounded) failure looks like.',
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
        `[FAIL] expected a 5xx error while Redis is down, got ${result.status} in ${result.durationMs}ms instead ` +
          `(body: ${JSON.stringify(result.body ?? result.rawText)}). Either the kill didn't take effect in time, or the ` +
          'lock path unexpectedly succeeded without Redis -- worth a closer look either way.',
      );
    }
  } finally {
    // ALWAYS restart, even if the assertions above threw or failed -- leaving Redis dead
    // would silently break every other request against this stack until someone notices
    // and manually restarts it by hand.
    try {
      dockerStart(REDIS_CONTAINER);
    } catch (err) {
      console.error(
        `FATAL: failed to restart "${REDIS_CONTAINER}" after the test (${err.message}). ` +
          `Restart it yourself right now: ${DOCKER_BIN} start ${REDIS_CONTAINER}`,
      );
      process.exit(1);
    }
  }

  console.log('');
  console.log(`Waiting ${RECOVERY_SETTLE_MS}ms for Redis to come back up, then confirming recovery...`);
  await new Promise((resolve) => setTimeout(resolve, RECOVERY_SETTLE_MS));

  const recovery = await postBooking(REQUEST_TIMEOUT_MS);
  if (recovery.timedOut) {
    console.log(`[FAIL] recovery request never answered within ${REQUEST_TIMEOUT_MS}ms.`);
  } else if (recovery.error) {
    console.log(`[FAIL] recovery request errored unexpectedly: ${recovery.error.message}`);
  } else if (recovery.status === 201) {
    console.log(`[PASS] recovery request succeeded (201) in ${recovery.durationMs}ms -- app recovered without a restart.`);
    recoveryPassed = true;
  } else if (recovery.status === 409) {
    // A second booking attempt at the exact same salon/service/startsAt as the (failed)
    // outage attempt legitimately collides with itself if the outage attempt somehow
    // got far enough to leave state behind -- treat 409 as recovery-confirmed too, since
    // it still proves Redis + the lock path are answering normally again, just that this
    // slot is no longer free. Re-run with a different STARTS_AT to get a clean 201.
    console.log(`[PASS] recovery request got 409 (slot no longer available) in ${recovery.durationMs}ms -- Redis/lock path is answering normally again, just this exact slot is taken. Re-run with a different STARTS_AT for a clean 201.`);
    recoveryPassed = true;
  } else {
    console.log(
      `[FAIL] expected 201 (or 409) after recovery, got ${recovery.status} in ${recovery.durationMs}ms ` +
        `(body: ${JSON.stringify(recovery.body ?? recovery.rawText)}) -- the app may not have recovered ` +
        'cleanly after the outage.',
    );
  }

  console.log('');
  console.log('----------------------------------------');
  if (outagePassed && recoveryPassed) {
    console.log('PASS: clean error during Redis outage, and a normal booking flow afterwards.');
    process.exit(0);
  } else {
    console.log('FAIL: see [FAIL] lines above.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Chaos test runner crashed unexpectedly:', err);
  console.error(
    `If Redis is still dead, restart it now: ${DOCKER_BIN} start ${REDIS_CONTAINER}`,
  );
  process.exit(1);
});
