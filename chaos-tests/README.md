# Chaos tests

Standalone fault-injection scripts that exercise real business-logic request flows
(booking creation, a public search read) while a real dependency container (Redis or
Postgres) is actually killed mid-flow, and confirm the API degrades gracefully -- a
clear, bounded error response, no hang, no leaked stack trace, no data corruption --
rather than crashing or hanging, then confirm the app recovers on its own once the
dependency comes back.

This fills a real gap: `apps/api/test/health.e2e-spec.ts` covers liveness/readiness
under a *mocked* Redis-unreachable condition, but nothing before this exercised real
business logic against an *actually* unavailable dependency.

This is a standalone operator tool, same spirit as `../load-tests/` and
`../smoke-tests/`: it is **not** part of the pnpm workspace, **not** wired into any
CI/CD workflow (`.github/workflows/`), and **not** wired into any app's `test` or
`test:e2e` script. Nothing runs it automatically. You run it manually, on demand,
against a real local dev (or dedicated disposable test) stack, and read the output
yourself.

## ============================================================================
## DO NOT RUN THESE AGAINST STAGING OR PRODUCTION. EVER.
## ============================================================================

`../smoke-tests/post-deploy-smoke-test.js` is deliberately always safe to run against a
live instance -- every check it makes is a read-only, unauthenticated GET.
`../load-tests/*.js` just generates extra HTTP traffic, safe to point at staging.

**These scripts are categorically different: they kill a real Docker container by
name.** Killing the wrong Redis or Postgres container mid-flow breaks every real
request that instance is serving -- including other people's real bookings and real
data -- until someone restarts it. Each script only ever talks to a Docker daemon
reachable from the machine it runs on (via `docker` / `DOCKER_HOST`), so it cannot
reach a genuinely remote staging/production database -- but if you run it on a
machine that itself hosts a shared staging/production Docker stack, it absolutely can
hurt that stack.

Run these only against:
- a local dev stack (`docker compose up`, this repo's own `docker-compose.yml`), or
- a dedicated, disposable chaos-testing stack nobody else is using.

As a backstop (not a substitute for you knowing what you're pointing this at), each
script refuses to run against a non-`localhost` `BASE_URL` unless you explicitly set
`I_KNOW_THIS_KILLS_CONTAINERS=1`.

## Why `docker kill`, not `docker pause`

`docker pause` freezes a container's process (`SIGSTOP`) but leaves its TCP socket
open and established. Neither the ioredis client
(`apps/api/src/redis/redis.module.ts`) nor the pg driver TypeORM uses
(`apps/api/src/data-source.ts`) is configured with a command/connection timeout
anywhere in this codebase. Against a *paused* container, a client that already has a
connection open just sits waiting for a reply that will never come until the process
is unfrozen -- the request would genuinely **hang** for the entire pause, which
defeats the point of a test that's supposed to assert a clean, bounded error.

`docker kill` actually closes the TCP connection, so the client sees a real
connection-reset/refused error -- a more realistic outage simulation, and the only way
to observe a bounded, non-hanging failure given this codebase's current (timeout-less)
client configuration. `docker start` afterwards brings back the *same* container (same
volume, same data) -- not a fresh one. Postgres is crash-safe by design (that's what
write-ahead logging is for), so `docker kill` + `docker start` against it is a
completely standard way to simulate a hard outage and recovery, not a special risk
these scripts introduce.

## What each script does

| Script | Flow exercised | Container killed | Container env var |
|---|---|---|---|
| `redis-outage-during-booking-hold.js` | `POST /api/bookings` (`BookingsService#createHold` acquiring the per-salon Redis lock) | Redis | `REDIS_CONTAINER` |
| `postgres-outage-during-read.js` | `GET /api/search` (a real PostGIS-backed query on every call, no cache in front of it) | Postgres | `POSTGRES_CONTAINER` |

Both follow the same four-phase shape:

1. **Baseline** -- confirm the target flow actually works before touching anything.
2. **Kill** the dependency container (`docker kill`, via `child_process.execFileSync`
   -- same "shell out where needed" convention this repo's own e2e prep scripts use,
   e.g. `apps/user-app/e2e/prepare-db.cjs`), then immediately send the real request and
   assert: it answers within a bounded timeout (not a hang), with a 5xx status, and a
   response body that doesn't look like a leaked stack trace (Nest's own default
   sanitized 500 body is `{"statusCode":500,"message":"Internal server error"}`).
3. **Restart** the container (`docker start` -- always, in a `finally`, even if the
   assertions above failed, so a failed run never leaves a dependency dead).
4. **Recovery** -- wait, then confirm a normal request succeeds again, proving the
   app's own connection pool/client recovers on its own, with **no app restart**.

Neither script mutates real data in a way that matters: `postgres-outage-during-read.js`
never issues anything but GETs. `redis-outage-during-booking-hold.js` does create a real
booking if the flow unexpectedly succeeds instead of failing (same as
`../load-tests/booking-burst.js`'s honest caveat) -- point it at a salon+service on a
local/dev/disposable stack you don't mind creating a test booking on, never anything
resembling a production salon's real calendar.

### `redis-outage-during-booking-hold.js`

Kills Redis, then attempts a real `POST /api/bookings`, targeting the exact code path
in `BookingsService#acquireSalonLock` (`apps/api/src/booking/bookings.service.ts`) that
does an unguarded `await this.redis.set(...)` as the very first step of the booking
flow. Expects a clean 5xx (not a hang), then restarts Redis and confirms a follow-up
booking attempt succeeds (`201`) or hits the expected same-slot `409` -- either proves
the lock path is answering normally again.

Requires an authenticated session, obtained the same way
`../load-tests/booking-burst.js` requires one: **this script never drives the OTP login
flow itself** (see its own header comment for the full reasoning). You log in once by
hand and hand it the resulting `session=...` cookie.

```bash
SALON_ID=<uuid> \
SERVICE_ID=<uuid> \
SESSION_COOKIE="session=eyJ..." \
node redis-outage-during-booking-hold.js
```

Because ioredis retries reconnecting before giving up on a queued command, expect the
in-outage failure to take real seconds, not be instant -- that's a slow, correct
failure, not a hang. See the script's own "KNOWN, EXPECTED BEHAVIOR" comment before
reading a multi-second failure as a bug.

### `postgres-outage-during-read.js`

Kills Postgres, then sends a real `GET /api/search` (the same public,
unauthenticated, PostGIS-backed search endpoint `../smoke-tests/` and
`../load-tests/search.js` use) -- chosen over the more obvious `GET /salons` because
there is no plain "list all salons" endpoint in this codebase (`SalonsController` only
exposes `GET /salons/mine`, authenticated, and `GET /salons/:slug`, which needs a real
seeded slug), and because `/search` guarantees a fresh DB round-trip on *every* call --
unlike `GET /categories` (Redis-cached) or `GET /cities` (cached in-process for the
life of the app), which could both mask a mid-outage Postgres failure behind an
already-warm cache. Expects a clean 5xx (not a hang), restarts Postgres, then **polls**
`GET /search` itself (not a raw `pg_isready`) until it gets a normal `200` back --
deliberately: the claim being tested is "the app's own connection pool recovers and
serves a real request again", which is stronger than "the Postgres process is
accepting TCP connections again", and a pool that gave up on the DB permanently would
pass a raw `pg_isready` check while still failing every real request.

No auth, no seed data required -- `/search` is public and always returns a
well-formed response (even an empty `items` array) against any properly migrated
instance.

```bash
node postgres-outage-during-read.js
```

## Env vars

Neither script hardcodes a container name -- both read it from an env var, with a
default matching what `docker compose up` produces from this repo's own
`docker-compose.yml` (`name: gheychi`, so service `redis` / `postgres` become
`gheychi-redis-1` / `gheychi-postgres-1` on a fresh bring-up). Check yours with
`docker ps` and override if it differs.

| Var | Applies to | Default | Meaning |
|---|---|---|---|
| `BASE_URL` | both | `http://localhost:3002/api` | Target API base URL, including the `/api` prefix -- same fallback `../smoke-tests` and `../load-tests` use. |
| `REDIS_CONTAINER` | redis script | `gheychi-redis-1` | Docker container name to kill/restart. |
| `POSTGRES_CONTAINER` | postgres script | `gheychi-postgres-1` | Docker container name to kill/restart. |
| `DOCKER_BIN` | both | `docker` | Docker CLI binary to shell out to. |
| `REQUEST_TIMEOUT_MS` | both | `20000` (redis) / `15000` (postgres) | Client-side abort timeout for the in-outage request. Exceeding it is reported as a FAIL (a real hang). |
| `RECOVERY_SETTLE_MS` | both | `1000` (redis) / `3000` (postgres) | Wait after restarting the container before checking recovery. |
| `RECOVERY_POLL_INTERVAL_MS` | postgres script | `1000` | Interval between recovery polls. |
| `RECOVERY_MAX_WAIT_MS` | postgres script | `20000` | Total time budget for recovery polling before giving up. |
| `SALON_ID`, `SERVICE_ID` | redis script | *(required)* | A real, seeded, approved salon + active service on the target instance -- same requirement as `../load-tests/booking-burst.js`. |
| `WORKER_ID`, `STARTS_AT` | redis script | optional | Same meaning/defaults as in `../load-tests/booking-burst.js`. |
| `SESSION_COOKIE` | redis script | *(required)* | One `session=<jwt>` cookie from a real login you performed yourself. Never driven by the script. |
| `I_KNOW_THIS_KILLS_CONTAINERS` | both | unset | Set to `1` to allow a non-localhost `BASE_URL`. See the safety section above -- this is a backstop, not permission to point these at staging/production. |

## Reading the output

Each script prints a phase-by-phase log (baseline check, kill, in-outage request,
restart, recovery poll) with `[PASS]`/`[FAIL]`/`[OK]` lines, then a final summary and
exit code: `0` if every phase passed, `1` if any phase failed. Both scripts restart the
container they killed in a `finally` block regardless of outcome, so a failed run never
leaves your local stack with a dependency still dead -- but if the script itself
crashes before that `finally` runs (or the restart command itself fails), it prints the
exact `docker start ...` command to run by hand, and you should run it immediately.
