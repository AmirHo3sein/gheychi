# Deploying Arayeshgah to Production

One Linux VPS running the four app images (built by CI, pulled from GHCR — never built on the server) plus Postgres, Redis, and a Caddy reverse proxy, all via `docker-compose.prod.yml`. See `docs/superpowers/specs/2026-07-11-plan-9-production-deployment-design.md` for the full rationale behind every decision below.

## One-time VPS setup

1. Install Docker Engine + the Compose plugin (follow Docker's official install docs for your distro).
2. Point DNS `A`/`AAAA` records for all four domains (`DOMAIN_APEX` and its `www.` alias, `DOMAIN_API`, `DOMAIN_PANEL`, `DOMAIN_ADMIN`) at the VPS's IP. Caddy cannot issue certificates until this resolves.
3. Create a deploy directory and copy three files into it from this repo: `docker-compose.prod.yml`, `Caddyfile`, and a `.env` you create from `.env.example` — **fill in real values**, especially `DB_PASS`, `JWT_SECRET`, the four `DOMAIN_*` vars, `ACME_EMAIL`, and (per the provider cutover checklist below) the real SMS/payment/storage/push credentials once you're ready to go live with them. **Also override `DB_HOST=postgres` and `REDIS_HOST=redis`** — `.env.example`'s `localhost` defaults are correct for local dev only; in this compose stack, `api`, `user-app`, and `backup` all reach Postgres/Redis by their Docker Compose service names, not `localhost`.
4. `docker login ghcr.io -u <your-github-username>` with a GitHub personal access token that has `read:packages` scope, so the VPS can pull the private images CI pushed.

## Routine deploy

From the deploy directory:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

If the deploy includes a new database migration, run it once the `api` container is up:

```bash
docker compose -f docker-compose.prod.yml exec api pnpm migration:run
```

This is a manual step by design — migrations never run automatically on container start, so an unreviewed schema change can't fire on every restart.

## Rollback

Re-run `up -d` after pointing the relevant image tag(s) in `docker-compose.prod.yml` back at a previous `:<git-sha>` tag instead of `:latest`, then `docker compose -f docker-compose.prod.yml up -d <service>`.

## Restoring a backup

Download a specific dated backup from S3 (list what's available with `docker compose -f docker-compose.prod.yml exec backup mc ls s3backup/$S3_BUCKET/backups/` first):

```bash
docker compose -f docker-compose.prod.yml exec backup mc cp \
  s3backup/$S3_BUCKET/backups/arayeshgah-2026-07-14T030000Z.dump /tmp/restore.dump
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

## Provider cutover checklist

The API ships with console/mock/local defaults so it runs with zero external credentials. Flip these `.env` values on the VPS to go live with real providers — no code changes needed, every implementation already exists and is unit-tested:

| Concern | Env vars |
|---|---|
| SMS (Kavenegar) | `SMS_PROVIDER=kavenegar`, `KAVENEGAR_API_KEY`, `KAVENEGAR_OTP_TEMPLATE` |
| Payments (Zarinpal) | `PAYMENT_GATEWAY=zarinpal`, `ZARINPAL_MERCHANT_ID`, `ZARINPAL_ACCESS_TOKEN` (panel-issued personal access token, used for refund API auth — the API refuses to start in zarinpal mode without it) |
| Storage (S3-compatible) | `STORAGE_PROVIDER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` |
| Push (Web Push) | `PUSH_PROVIDER=webpush`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — generate a keypair with `npx web-push generate-vapid-keys` and also set the public half as `NUXT_PUBLIC_VAPID_PUBLIC_KEY` |
| Alerts (admin SMS) | `ALERT_ADMIN_PHONE` — optional, comma-separated; critical money alerts (stuck refunds, orphaned authorities) SMS these numbers via the configured SMS provider. Empty disables SMS; in-app admin notifications always flow. `ALERT_SMS_HOURLY_CAP` (default 30) bounds alert SMS per hour during mass incidents |

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
