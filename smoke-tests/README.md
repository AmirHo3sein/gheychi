# Post-deploy smoke test

A single standalone script an operator runs by hand right after deploying a fresh
instance, to confirm it's actually healthy end-to-end -- not just "the process
started and is listening", but "the DB is reachable, Redis is reachable, the
PostGIS-backed search path works, and reference data (categories/cities) was seeded
correctly."

This is a standalone operator tool, not part of the pnpm workspace and not wired into
CI (`.github/workflows/`) -- same spirit as `../load-tests/`. Nothing runs it
automatically. You run it manually, on demand, right after a deploy, and read the
output (or its exit code) yourself.

## What it checks

Every check is a `GET` against a public, unauthenticated, read-only endpoint --
nothing here logs in, drives OTP, or creates a booking, so it's always safe to run
against a real production instance.

| Check | Endpoint | Confirms |
|---|---|---|
| Health | `GET /api/health` | 200 with `{status:'ok', db:'ok', redis:'ok'}` -- Postgres and Redis are both reachable |
| Liveness | `GET /api/liveness` | 200 with `{status:'ok'}` -- the process itself is up and responding |
| Readiness | `GET /api/readiness` | 200 with `{status:'ok', db:'ok', redis:'ok'}` -- same dependency checks as health, under its own name |
| Search | `GET /api/search` (minimal valid query: `lat`, `lng`, `gender`) | 200 with a `items` array -- the search path, the DB, and the PostGIS extension all actually work, not just that the server answers |
| Categories | `GET /api/categories` | 200 with a non-empty array -- the categories reference table was seeded |
| Cities | `GET /api/cities` | 200 with a non-empty array -- the cities reference table was seeded |

See `post-deploy-smoke-test.js`'s own per-check comments for exactly which
controller/DTO each check's request and expected shape were verified against
(`apps/api/src/health/health.controller.ts`, `apps/api/src/search/dto/search.dto.ts`,
`apps/api/src/search/search.service.ts`, `apps/api/src/catalog/catalog.controller.ts`,
`apps/api/src/cities/cities.controller.ts`).

## Running it

Plain Node.js, no dependencies -- uses the built-in `fetch`. Nothing to install.

```bash
BASE_URL=https://staging.example.com/api node post-deploy-smoke-test.js
```

`BASE_URL` must include the `/api` prefix (the Nest app calls
`app.setGlobalPrefix('api')` in `apps/api/src/main.ts`). **Nothing is hardcoded to
localhost**, though the default (`http://localhost:3002/api`, same fallback
`load-tests/*.js` and `apps/user-app/nuxt.config.ts` use) happens to match this repo's
local dev setup, so you can also run it against a local
`pnpm --filter @gheychi/api dev` with no env var set at all.

Optional: `TIMEOUT_MS` (default `10000`) caps how long any single request is allowed
to hang before that check is counted as a failure.

## Reading the output

Each check prints `[PASS]` or `[FAIL]` as it runs, with a one-line reason under any
failure. At the end:

- **All checks pass:** a one-line summary and exit code `0`.
- **Any check fails:** a summary listing every failing check and exit code `1`.

The non-zero exit code is the point -- run this as the last step of a manual deploy
checklist, or as a manual gate in whatever process you build on top of it, and treat a
non-zero exit as "do not consider this deploy done."

```bash
BASE_URL=https://staging.example.com/api node post-deploy-smoke-test.js
echo "exit code: $?"
```
