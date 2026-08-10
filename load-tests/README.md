# Load tests (k6)

Baseline load-test scripts for three of this API's hottest customer-facing paths:
search, availability lookup, and booking creation under contention.

**These have never been run against a real (staging or production) instance.** The
numbers they would produce -- p95 latency, throughput, error rate at a given
concurrency -- are genuinely unknown until someone runs them. Do not treat any
number quoted in this README, in code comments, or in commit messages as an actual
result; there are none yet. That is also why none of these scripts define k6
`thresholds` (pass/fail assertions) -- inventing a target before you have a baseline
just bakes in a guess. Run these first, look at the real numbers, *then* decide what
a reasonable threshold is and add it yourself (either back into these scripts, or
into whatever CI/monitoring setup you build on top of the baseline).

These are standalone operator tools, not part of the pnpm workspace and not wired
into CI (`.github/workflows/ci.yml`) -- run them manually, on demand, against an
instance you're deliberately load-testing.

## Install k6

k6 is a standalone Go binary, not an npm package -- nothing in this repo's
`node_modules` provides it.

```bash
brew install k6
```

Other platforms / package managers: https://grafana.com/docs/k6/latest/set-up/install-k6/

Verify:

```bash
k6 version
```

## Scripts

| Script | Endpoint | Auth required? |
|---|---|---|
| `search.js` | `GET /api/search` | No |
| `availability.js` | `GET /api/salons/:salonId/availability` | No |
| `booking-burst.js` | `POST /api/bookings` | Yes (session cookie) |

All three read their target from a `BASE_URL` env var -- **nothing is hardcoded to
localhost**, though the defaults happen to match this repo's local dev setup
(`http://localhost:3002/api`, same fallback `apps/user-app/nuxt.config.ts` uses) so
you can smoke-test a script against a local `pnpm --filter @gheychi/api dev` without
setting anything.

### `search.js`

Ramps virtual users (5 -> 20 -> 50, staged) against `GET /api/search` with the same
query shape the real user-app frontend sends (see `apps/user-app/app/pages/
index.vue`'s `loadSalons()`): `lat`, `lng`, `gender`, `sort`. No auth needed --
search is public.

```bash
BASE_URL=https://staging.example.com/api k6 run search.js
```

### `availability.js`

Ramps virtual users against `GET /api/salons/:salonId/availability` for one real
salon + service you provide. Needs a salon that actually exists on the target
instance, is `status='approved'`, and has `working_hours` configured -- this script
does not create one for you.

```bash
BASE_URL=https://staging.example.com/api \
SALON_ID=<uuid> \
SERVICE_ID=<uuid> \
k6 run availability.js
```

### `booking-burst.js`

A single synchronized burst (not a ramp) of virtual users all trying to book the
*same* salon + service + start time at once, to observe the real lock/overlap
contention path in `BookingsService.createHold` under actual concurrent HTTP load.

**A high rate of HTTP 409 responses here is the correct, expected outcome, not a
bug** -- that's the double-booking guarantee (a per-salon Redis lock plus a
transactional capacity check) doing exactly its job. See the script's own header
comment for the full explanation before you interpret a run's results.

Requires an authenticated session. This script deliberately never drives the OTP
login flow itself -- it takes pre-obtained session cookie(s) via env var instead.
See the script's header comment for exactly how to get one without the script
touching OTP.

```bash
BASE_URL=https://staging.example.com/api \
SALON_ID=<uuid> \
SERVICE_ID=<uuid> \
STARTS_AT=2026-09-01T10:00:00.000Z \
SESSION_COOKIES="session=eyJ...aaa,session=eyJ...bbb,session=eyJ...ccc" \
VUS=20 \
k6 run booking-burst.js
```

## Reading the output

Each script prints k6's standard end-of-run summary: `http_req_duration` (with
percentiles), request rate, `http_req_failed` rate, plus a few script-specific
custom counters (e.g. `booking_created_201` / `booking_conflict_409` in
`booking-burst.js`). There is no separate report to generate -- that summary *is*
the baseline. Save it (redirect stdout, or use `k6 run --out json=result.json ...`
for the raw per-request data) so you have something to compare the next run against.
