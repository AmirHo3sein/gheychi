# Deploying Gheychi to Production

One Linux VPS running the four app images (built by CI, pulled from GHCR — never built on the server) plus Postgres, Redis, and a Caddy reverse proxy, all via `docker-compose.prod.yml`. See `docs/superpowers/specs/2026-07-11-plan-9-production-deployment-design.md` for the full rationale behind every decision below.

## One-time VPS setup

1. Install Docker Engine + the Compose plugin (follow Docker's official install docs for your distro).
2. Point DNS `A`/`AAAA` records for all four domains (`DOMAIN_APEX` and its `www.` alias, `DOMAIN_API`, `DOMAIN_PANEL`, `DOMAIN_ADMIN`) at the VPS's IP. Caddy cannot issue certificates until this resolves.
3. Create a deploy directory and copy three files into it from this repo: `docker-compose.prod.yml`, `Caddyfile`, and a `.env` you create from `.env.example` — **fill in real values**, especially `DB_PASS`, `JWT_SECRET`, `REDIS_PASSWORD` (the `redis` service now boots with `--requirepass ${REDIS_PASSWORD}` — **an empty value here means Compose passes a literal empty `--requirepass ''` and redis starts with NO password**, silently reverting to the pre-hardening state; a blank `.env` value is not the same as omitting the setting), the four `DOMAIN_*` vars, `ACME_EMAIL`, `GRAFANA_ADMIN_PASSWORD` (Grafana refuses to boot with a blank one — see "## Observability" below), and (per the provider cutover checklist below) the real SMS/payment/storage/push/error-tracking credentials once you're ready to go live with them. **Also override `DB_HOST=postgres` and `REDIS_HOST=redis`** — `.env.example`'s `localhost` defaults are correct for local dev only; in this compose stack, `api`, `user-app`, and `backup` all reach Postgres/Redis by their Docker Compose service names, not `localhost`. `chmod 600 .env` once you've filled it in — it holds every credential this stack has (DB password, JWT secret, provider API keys).
   **Also override the six app-facing base-URL vars** — `APP_BASE_URL`, `FRONTEND_BASE_URL`, `PROVIDER_APP_BASE_URL`, `ADMIN_APP_BASE_URL`, `NUXT_PUBLIC_API_BASE`, `NUXT_PUBLIC_SITE_URL` — with the real `https://` versions of the matching `DOMAIN_*` value (e.g. `FRONTEND_BASE_URL=https://gheychi.co`, `NUXT_PUBLIC_API_BASE=https://api.gheychi.co/api`). Their `.env.example` defaults are the local-dev ports and are easy to miss since they're not Caddy-facing like `DOMAIN_*` — but they drive CORS, the Zarinpal callback URL, the post-payment redirect, and the sitemap's `<loc>` base, so leaving any of them on `localhost` breaks that concern in production while everything else keeps working, making it a confusing bug to trace back to this step.
4. `docker login ghcr.io -u <your-github-username>` with a GitHub personal access token that has `read:packages` scope, so the VPS can pull the private images CI pushed.

## Routine deploy

From the deploy directory:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

> **One-time, before the first deploy that introduces the `api_uploads` volume (2026-09-03):**
> with `STORAGE_PROVIDER=local`, every uploaded image lived inside the `api` container's
> own writable layer and was destroyed each time `up -d` recreated the container after a
> pull (DB rows kept pointing at now-404 URLs). `api` now mounts a named volume at
> `/app/uploads`. Anything currently sitting in the *running* container is NOT migrated
> automatically -- copy it out first, then pull/up, then copy it in:
>
> ```bash
> docker compose -f docker-compose.prod.yml cp api:/app/uploads ./uploads-migrate
> docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
> docker compose -f docker-compose.prod.yml cp ./uploads-migrate/. api:/app/uploads
> docker compose -f docker-compose.prod.yml exec -u root api chown -R apiuser:nodejs /app/uploads
> ```
>
> Also required in the same deploy: `FARAGOSTARESH_RELAY_TOKEN` in `.env` if `SMS_PROVIDER=faragostaresh-relay` (the api refuses to boot without it -- see the env table below).

**Then run the smoke test** (`apps/api/scripts/smoke-test.ts`) against the live site, from any machine with the repo and `pnpm install`ed (it doesn't need to run on the VPS itself):

```bash
pnpm --filter @gheychi/api smoke-test
```

Container healthchecks only prove a process is alive and listening -- they say nothing
about whether requests flowing through the real stack (Caddy -> api, real JSON body
parsing, real DTO validation) actually work. This exists because of a real incident: a
body-parser registration bug silently broke JSON parsing for every route except the one it
was scoped to, for roughly 50 minutes in production, while every container reported
healthy the entire time (see `apps/api/test/body-parser-registration.e2e-spec.ts` for the
underlying bug). The script checks health/version, both the scoped and unscoped JSON body
parsers specifically, all three frontend apps respond, and the CSP-Report-Only header is
present on all four domains -- with zero side effects (no real SMS, no real payment; see
the provider-cutover checklist below for those, which stay manual and one-time only). Exits
non-zero and prints exactly which check(s) failed if anything's wrong -- treat a failure
here as seriously as a failed container healthcheck, and consider rolling back (see
"## Rollback" below) rather than leaving a partially-broken deploy live while debugging.

If the deploy includes a new database migration, take an on-demand backup first (the automated one only runs daily at 03:00 UTC, so relying on it alone means a mid-day migration could be up to ~24h stale to restore from), then run the migration **before** bringing the new `api` container up:

```bash
docker compose -f docker-compose.prod.yml exec backup /backup.sh
# `run --rm`, NOT `exec`: see the warning below.
docker compose -f docker-compose.prod.yml run --rm api pnpm migration:run
docker compose -f docker-compose.prod.yml up -d api
```

> ⚠️ **Order matters, and so does `run` vs `exec`.** The API validates its required
> `platform_config` rows at boot (`PlatformConfigService.onApplicationBootstrap`) and
> *deliberately refuses to start* if one is missing. A migration that introduces a new
> required key therefore makes the new image crash-loop until it has run — at which point
> `exec` is useless, because it needs an already-running container ("container is not
> running"), leaving no documented way forward. `run --rm` starts a fresh one-shot container
> with the command overridden, so Nest never boots and the migration always has a way in.
>
> This has bitten a real deploy before. If you find the `api` container restart-looping after
> a deploy, check `docker compose logs api` for a missing-config error and run the migration
> with `run --rm` — do not assume the image is broken.

This is a manual step by design — migrations never run automatically on container start, so an unreviewed schema change can't fire on every restart.

**If a migration turns out to be wrong**, `pnpm migration:revert` (reverts the single most recent migration, running its `down()`) is the first thing to reach for — faster and less disruptive than a full restore:

```bash
docker compose -f docker-compose.prod.yml exec api pnpm migration:revert
```

Only fall back to "## Restoring a backup" below if the migration's `down()` can't cleanly undo it (e.g. a destructive column drop) or the backup taken just before it is the safer path.

## Rollback

Re-run `up -d` after pointing the relevant image tag(s) in `docker-compose.prod.yml` back at a previous `:<git-sha>` tag instead of `:latest`, then `docker compose -f docker-compose.prod.yml up -d <service>`.

## Restoring a backup

Download a specific dated backup from S3 (list what's available with `docker compose -f docker-compose.prod.yml exec backup mc ls s3backup/$S3_BUCKET/backups/` first):

```bash
docker compose -f docker-compose.prod.yml exec backup mc cp \
  s3backup/$S3_BUCKET/backups/gheychi-2026-07-14T030000Z.dump /tmp/restore.dump
```

**Verify a backup restores cleanly, without touching the live database:**

```bash
docker compose -f docker-compose.prod.yml exec postgres createdb -U $DB_USER restore_check
docker compose -f docker-compose.prod.yml exec -e PGPASSWORD=$DB_PASS backup pg_restore -h postgres -U $DB_USER -d restore_check /tmp/restore.dump
# spot-check row counts against the live database here, then:
docker compose -f docker-compose.prod.yml exec postgres dropdb -U $DB_USER restore_check
```

**Real disaster recovery (replaces the live database):**

```bash
docker compose -f docker-compose.prod.yml stop api
docker compose -f docker-compose.prod.yml exec -e PGPASSWORD=$DB_PASS backup pg_restore -h postgres -U $DB_USER -d $DB_NAME --clean --if-exists /tmp/restore.dump
docker compose -f docker-compose.prod.yml start api
```

Stopping `api` first avoids live writes racing the restore; `--clean --if-exists` drops existing objects before recreating them from the dump.

### Restoring uploaded files

Separate artifact, separate procedure — a database restore alone leaves every `salon_photos`/`stories`/`portfolio_items`/blog-cover row pointing at a file that isn't on disk.

The `backup` container mounts `api_uploads` **read-only**, so it deliberately cannot be used to write files back. Restore through a throwaway container that mounts the same volume read-write:

```bash
docker run --rm \
  -v gheychi_api_uploads:/uploads \
  --env-file .env \
  $(docker compose -f docker-compose.prod.yml images -q backup) \
  sh -c 'mc alias set s3backup "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" \
      && mc mirror --overwrite "s3backup/$S3_BUCKET/uploads/" /uploads/'
docker compose -f docker-compose.prod.yml exec -u root api chown -R apiuser:nodejs /app/uploads
```

The `chown` matters: the API runs as the non-root `apiuser` (see `apps/api/Dockerfile`), and files written by a root-running restore container would leave it unable to manage them afterwards.

Two honest caveats:

- **You get the last mirrored state, not a chosen date.** Whatever `uploads/` held at the last successful run is all there is (see the mirror-vs-backup note under "## Operational notes"). If the database is restored to an older dump, images uploaded between that dump and the last mirror will exist on disk with no row referencing them — harmless orphans, cleaned up by the existing storage-reconciliation job.
- **A file deleted locally still exists in S3**, so this restore can resurrect images that were deliberately removed. Nothing in the app breaks (no row points at them) and the reconciliation job sweeps them, but don't read a non-empty `uploads/` prefix as proof that every object in it is live.

To check what's there without restoring anything:

```bash
docker compose -f docker-compose.prod.yml exec backup mc ls --recursive --summarize s3backup/$S3_BUCKET/uploads/
```

## Operational notes

- **Never share raw `docker compose -f docker-compose.prod.yml config` output for troubleshooting.** Compose fully resolves and inlines every `env_file`-sourced variable for `api`, `user-app`, and `caddy` into that output — including secrets never referenced anywhere in the compose file itself (`JWT_SECRET`, `KAVENEGAR_API_KEY`, `ZARINPAL_MERCHANT_ID`, S3 credentials, `VAPID_PRIVATE_KEY`). This is standard, unavoidable Docker Compose behavior (not specific to this file) — if you need to share `config` output for debugging, redact it first.
- **Backups run automatically, and cover two different things with two different guarantees.** The `backup` service runs daily (03:00 UTC, plus once immediately whenever the stack starts) and does both of the following, in this order:
  1. **Postgres → `s3://$S3_BUCKET/backups/`** — a dated `pg_dump -Fc` snapshot per run, size-sanity-checked and then byte-for-byte verified against what actually landed in S3, keeping **14 days** of history. This is a real point-in-time history: you can restore any of the last 14 days.
  2. **Uploaded files → `s3://$S3_BUCKET/uploads/`** — an `mc mirror` of the `api_uploads` volume (mounted read-only into the `backup` container). With `STORAGE_PROVIDER=local`, which is what production runs, that volume is the *only* copy of every salon photo, story, portfolio image and blog cover; the database dump preserves the rows pointing at them and nothing else, so without this a lost VPS meant a restored site full of 404 images.
  **This second one is a mirror, not a backup history — say it plainly: there is no point-in-time recovery for images.** `uploads/` reflects the live directory as of the last run and nothing else; there are no dated copies to roll back to, and the 14-day prune deliberately does not touch this prefix. The mirror is additive (no `--remove`), so a file deleted locally lingers in S3 — a little wasted storage in exchange for a local deletion bug never propagating into the only surviving copy. If a corrupted or wrongly-deleted image is restored over, the previous content is gone.
  A failure in either half raises the same critical `backup-failed` alert (in-app admin notification + SMS to `ALERT_ADMIN_PHONE`) via `POST /api/internal/backup-report`; an uploads-mirror message is prefixed `uploads mirror:` so you can tell the halves apart. The two are independent by design: an uploads-mirror failure is reported *after* the database dump's own success has already been recorded, so it can never retract or mask a good database backup (the script still exits non-zero, because the run genuinely was partial). Also check `docker compose logs backup` periodically. See "## Restoring a backup" below.
- **Every service carries a `mem_limit`/`cpus` ceiling** in `docker-compose.prod.yml` — a leak or runaway burst in one container (most plausibly `api`) can't starve the whole VPS and take every other service down with it. These are conservative starting points sized for a generic small VPS, not measured against real production traffic — re-tune them (`docker stats` under real load is the fastest way to see current headroom) if the VPS's actual RAM/vCPU total differs meaningfully from what a modest single-VPS deployment implies, or if `api`/`postgres` are ever OOM-killed under legitimate load.

## Observability

`docker-compose.prod.yml` runs Prometheus + Grafana alongside the app stack, scraping the API's own `GET /api/metrics` (already existed before this — see `apps/api/src/metrics/`) every 15s. Both are internal-only: Prometheus has no port mapping at all (Grafana reaches it at `http://prometheus:9090` over the compose `internal` network), and Grafana is bound to `127.0.0.1:3000` on the host — neither has a Caddy route or a real domain, so neither is reachable from the public internet.

**`/api/metrics` itself is blocked at the edge** (fixed 2026-09-03). The endpoint is `@Public()` out of necessity — a Prometheus scraper carries no session cookie and cannot be made to — and `{$DOMAIN_API}`'s `reverse_proxy` had no path restriction, so `https://api.<domain>/api/metrics` was serving the full registry (booking, payment and revenue counters included) to anyone on the internet. The `Caddyfile` now returns a bare `404` for `/api/metrics*`. This does not affect scraping at all: `docker/prometheus/prometheus.yml` targets `api:3002` directly over the compose network and never passes through Caddy. Verify after a deploy with `curl -s -o /dev/null -w '%{http_code}' https://api.<domain>/api/metrics` → expect `404`.

`/api/health` is deliberately *not* blocked — it's the standard external "is the deploy up" probe (the smoke test uses it over the public domain) and returns only an ok/error verdict per dependency, with no counts, versions or connection details.

**One-time setup**: set `GRAFANA_ADMIN_PASSWORD` in `.env` before first `up -d` (Grafana refuses to start with a blank one in production).

**Viewing it**: from your own machine,

```bash
ssh -L 3000:localhost:3000 <deploy-host>
```

then open `http://localhost:3000` locally and log in as `admin` / `$GRAFANA_ADMIN_PASSWORD`. The Prometheus datasource is auto-provisioned (`docker/grafana/provisioning/datasources/prometheus.yml`) — no manual setup needed before building or importing a dashboard. Prometheus itself has no UI worth tunneling to separately; query it through Grafana's Explore view, or `docker compose -f docker-compose.prod.yml exec prometheus wget -qO- http://localhost:9090/api/v1/query?query=up` for a one-off check.

**Retention**: 30 days of metrics history (`--storage.tsdb.retention.time=30d`), bounded to keep disk usage predictable on a single small VPS rather than growing forever — this is a recent-regression/incident window, not a long-term analytics store (that's what `AnalyticsService`/`analytics_events` are for, a separate concern).

Publicly exposing Grafana behind a real subdomain (its own TLS cert, same admin password) is a deliberate, not-yet-done follow-up rather than an oversight — the SSH-tunnel path above needed zero new DNS records to ship.

## Provider cutover checklist

The API ships with console/mock/local defaults so it runs with zero external credentials. Flip these `.env` values on the VPS to go live with real providers — no code changes needed, every implementation already exists and is unit-tested:

| Concern | Env vars |
|---|---|
| SMS (Kavenegar) | `SMS_PROVIDER=kavenegar`, `KAVENEGAR_API_KEY`, `KAVENEGAR_OTP_TEMPLATE` |
| SMS (PayamakYab) | `SMS_PROVIDER=payamakyab`, `PAYAMAKYAB_USERNAME`, `PAYAMAKYAB_PASSWORD`, `PAYAMAKYAB_SENDER` (the registered line number) |
| SMS (temporary relay) | `SMS_PROVIDER=faragostaresh-relay`, `FARAGOSTARESH_RELAY_TOKEN` — **the api container fails to boot without it in this mode**; add it to the production `.env` before switching (see `faragostaresh-relay-sms.provider.ts`) |
| Payments (Zarinpal) | `PAYMENT_GATEWAY=zarinpal`, `ZARINPAL_MERCHANT_ID`, `ZARINPAL_ACCESS_TOKEN` (panel-issued personal access token, used for refund API auth — the API refuses to start in zarinpal mode without it) |
| Storage (S3-compatible) | `STORAGE_PROVIDER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` |
| Push (Web Push) | `PUSH_PROVIDER=webpush`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — generate a keypair with `npx web-push generate-vapid-keys` and also set the public half as `NUXT_PUBLIC_VAPID_PUBLIC_KEY` |
| Alerts (admin SMS) | `ALERT_ADMIN_PHONE` — optional, comma-separated; critical money alerts (stuck refunds, orphaned authorities) SMS these numbers via the configured SMS provider. Empty disables SMS; in-app admin notifications always flow. `ALERT_SMS_HOURLY_CAP` (default 30) bounds alert SMS per hour during mass incidents |
| Error tracking (Sentry) — API | `ERROR_TRACKING_PROVIDER=sentry`, `SENTRY_DSN` (create a project at sentry.io, or self-host, and copy its DSN). Empty/unset keeps the existing structured-JSON-to-`Logger` behavior — see `apps/api/src/error-tracking/`. **No compose change is needed**: the `api` service's `env_file: .env` already forwards every key in `.env`, including these two, which is verifiable with `docker compose -f docker-compose.prod.yml config` |
| Error tracking (Sentry) — user-app | `NUXT_PUBLIC_SENTRY_DSN`, a **separate DSN from the API's**, from its own browser/JavaScript Sentry project. Read at runtime through `runtimeConfig.public` (`user-app` shares this same `.env`), so setting it plus `up -d user-app` is enough — no rebuild. Empty = the reporter is never initialized at all |
| Error tracking (Sentry) — the two panels | `VITE_SENTRY_DSN`, **build-time only**. Vite inlines `import.meta.env` into the static bundle, so this is a CI build arg, not a VPS `.env` value — see "## Changing the API base URL" below for the same mechanism, and "## CI setup" for the repository variable to add. Setting it in `.env` on the VPS does nothing |

After changing any of these, `docker compose -f docker-compose.prod.yml up -d api` (and `user-app` for the VAPID public key or `NUXT_PUBLIC_SENTRY_DSN`) to apply — no rebuild needed, these are all runtime env vars. The one exception is the panels' `VITE_SENTRY_DSN`, which needs a CI rebuild like every other `VITE_*` value.

**A browser DSN is not a secret** — it authorizes event ingestion into one project and nothing else, and it ships inside a public JS bundle by design. That is why baking it into an image (panels) or serving it to the browser (user-app) is the intended usage. Use a *different* project/DSN from the API's all the same: the server DSN sits alongside the server's own stack traces and should not be shared with anonymous browsers.

All three frontends scrub before sending: `sendDefaultPii: false`, plus an explicit `beforeSend`/`beforeBreadcrumb` pass that drops cookies, request bodies, request headers, URL query strings and console breadcrumbs, so a phone number or OTP cannot ride out in an event (`apps/user-app/app/utils/error-reporting.ts`, `apps/{provider,admin}-panel/src/utils/error-reporting.ts`). Errors only — `tracesSampleRate: 0`, no browser tracing integration, for the same reason `SentryErrorTrackingService` sets `skipOpenTelemetrySetup`: the API already owns tracing through its own OpenTelemetry SDK.

### Manual smoke test after cutover

Real third-party credentials can't be exercised in CI — run these by hand once, in order:

1. Request an OTP for a real phone number through the login flow and confirm the SMS arrives.
2. Complete one real (small-amount or sandbox) Zarinpal payment through a booking and confirm the callback lands on the success page.
3. Upload a salon photo or blog cover image as a provider/admin and confirm the returned URL resolves publicly.
4. Subscribe to push notifications in a browser and trigger one (e.g. a booking confirmation) to confirm delivery.

## Changing the API base URL

`provider-panel` and `admin-panel` bake `VITE_API_BASE` into their static bundle at *build* time (it's a public URL, not a secret). Changing it requires a new CI build+push — update the `VITE_API_BASE_PROD` repository variable and re-run the workflow (e.g. push an empty commit to `main`), then redeploy. A VPS-side `.env` edit alone won't affect these two apps.

`provider-panel` also bakes in `VITE_CUSTOMER_APP_BASE` the same way — the customer-facing user-app's own public base URL, used only to build the shareable public-salon link/QR shown on the salon-settings screen. Same change procedure (repository variable + rebuild) applies.

## CI setup (one-time, before the first `main` merge)

`.github/workflows/ci.yml`'s `build-and-push` job needs repository variables defined before it can build the SPA images: **Settings → Secrets and variables → Actions → Variables tab → New repository variable**:
- `VITE_API_BASE_PROD`, value `https://api.<yourdomain>/api` (matching whatever `DOMAIN_API` is actually set to) — needed by `provider-panel` and `admin-panel`.
- `VITE_CUSTOMER_APP_BASE_PROD`, value `https://<yourdomain>` (matching `DOMAIN_APEX`, no trailing slash) — needed by `provider-panel` only.

This is a manual GitHub UI step — no commit can create it. No other secrets are needed; GHCR auth uses the built-in `secrets.GITHUB_TOKEN`.

**Optional, to turn on panel crash reporting:** both panel Dockerfiles accept `ARG VITE_SENTRY_DSN` (empty default = reporting stays entirely uninitialized, which is the current state). CI does not pass it yet, so this needs one more repository variable plus one line added to each of the two SPA build steps in `.github/workflows/ci.yml`:

```yaml
          build-args: |
            VITE_API_BASE=${{ vars.VITE_API_BASE_PROD }}
            VITE_SENTRY_DSN=${{ vars.VITE_SENTRY_DSN_PROD }}   # add this line
```

Until that line exists, the panels build with an empty DSN and report nothing — by design, not by accident.
