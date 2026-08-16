# Deploying Gheychi to Production

One Linux VPS running the four app images (built by CI, pulled from GHCR — never built on the server) plus Postgres, Redis, and a Caddy reverse proxy, all via `docker-compose.prod.yml`. See `docs/superpowers/specs/2026-07-11-plan-9-production-deployment-design.md` for the full rationale behind every decision below.

## One-time VPS setup

1. Install Docker Engine + the Compose plugin (follow Docker's official install docs for your distro).
2. Point DNS `A`/`AAAA` records for all four domains (`DOMAIN_APEX` and its `www.` alias, `DOMAIN_API`, `DOMAIN_PANEL`, `DOMAIN_ADMIN`) at the VPS's IP. Caddy cannot issue certificates until this resolves.
3. Create a deploy directory and copy three files into it from this repo: `docker-compose.prod.yml`, `Caddyfile`, and a `.env` you create from `.env.example` — **fill in real values**, especially `DB_PASS`, `JWT_SECRET`, the four `DOMAIN_*` vars, `ACME_EMAIL`, `GRAFANA_ADMIN_PASSWORD` (Grafana refuses to boot with a blank one — see "## Observability" below), and (per the provider cutover checklist below) the real SMS/payment/storage/push/error-tracking credentials once you're ready to go live with them. **Also override `DB_HOST=postgres` and `REDIS_HOST=redis`** — `.env.example`'s `localhost` defaults are correct for local dev only; in this compose stack, `api`, `user-app`, and `backup` all reach Postgres/Redis by their Docker Compose service names, not `localhost`. `chmod 600 .env` once you've filled it in — it holds every credential this stack has (DB password, JWT secret, provider API keys).
   **Also override the six app-facing base-URL vars** — `APP_BASE_URL`, `FRONTEND_BASE_URL`, `PROVIDER_APP_BASE_URL`, `ADMIN_APP_BASE_URL`, `NUXT_PUBLIC_API_BASE`, `NUXT_PUBLIC_SITE_URL` — with the real `https://` versions of the matching `DOMAIN_*` value (e.g. `FRONTEND_BASE_URL=https://gheychi.co`, `NUXT_PUBLIC_API_BASE=https://api.gheychi.co/api`). Their `.env.example` defaults are the local-dev ports and are easy to miss since they're not Caddy-facing like `DOMAIN_*` — but they drive CORS, the Zarinpal callback URL, the post-payment redirect, and the sitemap's `<loc>` base, so leaving any of them on `localhost` breaks that concern in production while everything else keeps working, making it a confusing bug to trace back to this step.
4. `docker login ghcr.io -u <your-github-username>` with a GitHub personal access token that has `read:packages` scope, so the VPS can pull the private images CI pushed.

## Routine deploy

From the deploy directory:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

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

If the deploy includes a new database migration, take an on-demand backup first (the automated one only runs daily at 03:00 UTC, so relying on it alone means a mid-day migration could be up to ~24h stale to restore from), then run the migration once the `api` container is up:

```bash
docker compose -f docker-compose.prod.yml exec backup /backup.sh
docker compose -f docker-compose.prod.yml exec api pnpm migration:run
```

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

## Operational notes

- **Never share raw `docker compose -f docker-compose.prod.yml config` output for troubleshooting.** Compose fully resolves and inlines every `env_file`-sourced variable for `api`, `user-app`, and `caddy` into that output — including secrets never referenced anywhere in the compose file itself (`JWT_SECRET`, `KAVENEGAR_API_KEY`, `ZARINPAL_MERCHANT_ID`, S3 credentials, `VAPID_PRIVATE_KEY`). This is standard, unavoidable Docker Compose behavior (not specific to this file) — if you need to share `config` output for debugging, redact it first.
- **Database backups run automatically.** The `backup` service dumps Postgres daily (03:00 UTC, plus once immediately whenever the stack starts) to `s3://$S3_BUCKET/backups/`, keeping 14 days. A failed backup logs loudly to `docker compose logs backup` rather than paging anyone — check it periodically. See "## Restoring a backup" below.
- **Every service carries a `mem_limit`/`cpus` ceiling** in `docker-compose.prod.yml` — a leak or runaway burst in one container (most plausibly `api`) can't starve the whole VPS and take every other service down with it. These are conservative starting points sized for a generic small VPS, not measured against real production traffic — re-tune them (`docker stats` under real load is the fastest way to see current headroom) if the VPS's actual RAM/vCPU total differs meaningfully from what a modest single-VPS deployment implies, or if `api`/`postgres` are ever OOM-killed under legitimate load.

## Observability

`docker-compose.prod.yml` runs Prometheus + Grafana alongside the app stack, scraping the API's own `GET /api/metrics` (already existed before this — see `apps/api/src/metrics/`) every 15s. Both are internal-only: Prometheus has no port mapping at all (Grafana reaches it at `http://prometheus:9090` over the compose `internal` network), and Grafana is bound to `127.0.0.1:3000` on the host — neither has a Caddy route or a real domain, so neither is reachable from the public internet.

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
| Payments (Zarinpal) | `PAYMENT_GATEWAY=zarinpal`, `ZARINPAL_MERCHANT_ID`, `ZARINPAL_ACCESS_TOKEN` (panel-issued personal access token, used for refund API auth — the API refuses to start in zarinpal mode without it) |
| Storage (S3-compatible) | `STORAGE_PROVIDER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` |
| Push (Web Push) | `PUSH_PROVIDER=webpush`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — generate a keypair with `npx web-push generate-vapid-keys` and also set the public half as `NUXT_PUBLIC_VAPID_PUBLIC_KEY` |
| Alerts (admin SMS) | `ALERT_ADMIN_PHONE` — optional, comma-separated; critical money alerts (stuck refunds, orphaned authorities) SMS these numbers via the configured SMS provider. Empty disables SMS; in-app admin notifications always flow. `ALERT_SMS_HOURLY_CAP` (default 30) bounds alert SMS per hour during mass incidents |
| Error tracking (Sentry) | `ERROR_TRACKING_PROVIDER=sentry`, `SENTRY_DSN` (create a project at sentry.io, or self-host, and copy its DSN). Empty/unset keeps the existing structured-JSON-to-`Logger` behavior — see `apps/api/src/error-tracking/` |

After changing any of these, `docker compose -f docker-compose.prod.yml up -d api` (and `user-app` for the VAPID public key) to apply — no rebuild needed, these are all runtime env vars.

### Manual smoke test after cutover

Real third-party credentials can't be exercised in CI — run these by hand once, in order:

1. Request an OTP for a real phone number through the login flow and confirm the SMS arrives.
2. Complete one real (small-amount or sandbox) Zarinpal payment through a booking and confirm the callback lands on the success page.
3. Upload a salon photo or blog cover image as a provider/admin and confirm the returned URL resolves publicly.
4. Subscribe to push notifications in a browser and trigger one (e.g. a booking confirmation) to confirm delivery.

## Changing the API base URL

`provider-panel` and `admin-panel` bake `VITE_API_BASE` into their static bundle at *build* time (it's a public URL, not a secret). Changing it requires a new CI build+push — update the `VITE_API_BASE_PROD` repository variable and re-run the workflow (e.g. push an empty commit to `main`), then redeploy. A VPS-side `.env` edit alone won't affect these two apps.

## CI setup (one-time, before the first `main` merge)

`.github/workflows/ci.yml`'s `build-and-push` job needs one repository variable defined before it can build the two SPA images: **Settings → Secrets and variables → Actions → Variables tab → New repository variable**, name `VITE_API_BASE_PROD`, value `https://api.<yourdomain>/api` (matching whatever `DOMAIN_API` is actually set to). This is a manual GitHub UI step — no commit can create it. No other secrets are needed; GHCR auth uses the built-in `secrets.GITHUB_TOKEN`.
