# Plan 9: Production Deployment Prep

**Date:** 2026-07-11
**Status:** Approved
**Depends on:** Plans 1–8 (all shipped). Reuses the existing SMS/Payment/Push/Storage provider abstractions unchanged.

## 1. Product Summary

Arayeshgah currently only runs via local dev servers against a dev `docker-compose.yml` (Postgres + Redis only). This plan makes it deployable to a real server: Docker images for all four apps, a production compose file that adds a TLS-terminating reverse proxy, a CI pipeline that tests and builds on every push, and a documented cutover from the mock/console dev providers to the real ones (Kavenegar SMS, Zarinpal payments, S3-compatible object storage). No new product features — this is infrastructure only.

### Decisions locked (from clarifying questions)

- **Target:** a single Linux VPS running a production `docker-compose` stack — Postgres, Redis, the four app containers, and a reverse proxy. No Kubernetes, no multi-node.
- **CI scope:** GitHub Actions runs the full test suites (backend unit + e2e against real Postgres/Redis service containers, all three frontend unit/component suites, user-app Playwright e2e) on every push/PR. On `main` only, after tests pass, it builds the four production images and pushes them to GitHub Container Registry (GHCR). Deploying those images to the VPS is a **manual, documented step** — CI never holds server SSH credentials.
- **Reverse proxy / TLS:** Caddy, one container, automatic Let's Encrypt certificates via a short Caddyfile. No manual certbot/nginx TLS config.

## 2. Current State (verified against the repo)

- Apps: `apps/api` (NestJS, port 3002), `apps/user-app` (Nuxt 4 SSR, port 3003), `apps/provider-panel` (Vite SPA, port 3004), `apps/admin-panel` (Vite SPA, port 3005). All four are built and shipped (Plans 1–8).
- `docker-compose.yml` at the repo root runs **dev-only** Postgres (PostGIS) and Redis, with host ports mapped (`5544`, `6381`) for local tool access. No app containers, no Dockerfiles anywhere in the repo, no `.github/` directory.
- Provider abstractions already exist and are already unit-tested for the real implementations, not just the mock/console ones: `KavenegarSmsProvider`, `ZarinpalGateway`, `S3StorageProvider`, `WebPushProvider`. Switching providers is an env-var change (`SMS_PROVIDER`, `PAYMENT_GATEWAY`, `STORAGE_PROVIDER`, `PUSH_PROVIDER`) — **no application code changes are anticipated** for provider cutover.
- `apps/admin-panel` and `apps/provider-panel` read one build-time public value each: `import.meta.env.VITE_API_BASE` (defaults to `http://localhost:3002/api`). Vite bakes this into the static bundle at build time — it is not a secret, just the public API URL.
- `apps/user-app` reads its public config (`NUXT_PUBLIC_API_BASE`, `NUXT_PUBLIC_VAPID_PUBLIC_KEY`) via Nuxt's `runtimeConfig.public`. Because the app is SSR (not statically generated), Nuxt resolves and injects this per-request on the server — it can be supplied as a normal **runtime** container env var, no build-time baking needed.
- `apps/api`'s TypeORM CLI config (`src/data-source.ts`) points `entities`/`migrations` at `src/**/*.entity.ts` / `src/migrations/*.ts` (TypeScript source globs, run via `typeorm-ts-node-commonjs`). This only works with source + `ts-node` present, not against compiled `dist/` output — this shapes the migration-running approach below (§7).

## 3. Domains & Routing

Four subdomains, one apex reservation for the customer app:

| Domain | Routes to | Container:port |
|---|---|---|
| `arayeshgah.ir`, `www.arayeshgah.ir` | user-app | `user-app:3003` |
| `api.arayeshgah.ir` | api | `api:3002` |
| `panel.arayeshgah.ir` | provider-panel | `provider-panel:80` (nginx) |
| `admin.arayeshgah.ir` | admin-panel | `admin-panel:80` (nginx) |

Domain names are the placeholder `arayeshgah.ir` — the Caddyfile reads them from env vars (`$DOMAIN_APEX`, `$DOMAIN_API`, `$DOMAIN_PANEL`, `$DOMAIN_ADMIN`) so the real domain is a deploy-time config value, not hardcoded.

## 4. Docker Images

One `Dockerfile` per app, all following the same three-stage shape recommended by Turborepo for pnpm monorepos — a **pruner** stage that uses `turbo prune --docker` to extract just the subset of the workspace a given app needs (its own source plus only the internal packages/lockfile entries it actually depends on), an **installer** stage that installs and builds from that pruned set, and a **runner** stage that ships the result. This keeps each image's build cache scoped to what that app actually touched, instead of invalidating on unrelated app changes.

- **`apps/api/Dockerfile`** — runner stage is **not** minimized to just `dist/`: it keeps the full pruned source tree, `node_modules` (including devDependencies), and compiled `dist/`. `CMD` runs `node dist/main.js`. This is a deliberate simplicity tradeoff (§7): it lets the exact existing `pnpm migration:run`/`migration:revert` scripts run unchanged inside the production container via `docker compose exec`, instead of introducing a second, compiled-only TypeORM data-source config. The image is larger than a fully slimmed one; acceptable for a single-VPS MVP.
- **`apps/user-app/Dockerfile`** — installer stage runs the Nuxt build, producing a self-contained Nitro `.output/` (server + its own bundled deps). Runner stage copies only `.output/` and runs `node .output/server/index.mjs`. Public runtime config arrives via env vars at container start (no `VITE_`-style build args needed).
- **`apps/provider-panel/Dockerfile`** and **`apps/admin-panel/Dockerfile`** — installer stage runs `vite build` with `VITE_API_BASE` passed as a Docker build ARG (the real `https://api.arayeshgah.ir/api` value, supplied by CI as a repository **variable**, not a secret — it's a public URL). Runner stage is `nginx:alpine` serving the static `dist/`, with a minimal SPA-fallback `nginx.conf` (`try_files $uri /index.html`).

All four images are tagged `ghcr.io/<owner>/arayeshgah-<app>:<git-sha>` and `:latest`, built and pushed only from CI (§6), never built by hand on the VPS.

## 5. Production Compose (`docker-compose.prod.yml`)

A second compose file, separate from the dev-only root `docker-compose.yml` (which stays as-is for local dev). Services:

- `postgres`, `redis` — same images as dev, but **no host port mapping** (only reachable on the internal Docker network) and real credentials from `.env`. Named volumes for persistence.
- `api`, `user-app`, `provider-panel`, `admin-panel` — `image: ghcr.io/.../arayeshgah-<app>:latest` (no `build:` — these are pre-built by CI and pulled), `env_file: .env`, no published host ports (only Caddy is reachable from outside).
- `caddy` — official `caddy:2-alpine` image, the only service publishing ports (`80:80`, `443:443`), volumes for the `Caddyfile` and a named volume for its certificate/state data, `depends_on` the four app services.
- `healthcheck:` blocks on `postgres`, `redis`, and `api` (the API's existing `GET /api/health`), so `docker compose ps` gives an honest signal without adding a monitoring stack.

All app services and Caddy share one internal Docker network; only Caddy has a published port.

## 6. CI (`.github/workflows/ci.yml`)

Single workflow, two jobs:

- **`test`** (every push and PR, all branches): matrix or sequential steps running `pnpm --filter @arayeshgah/api test`, `pnpm --filter @arayeshgah/api test:e2e` (with `postgres:16-3.4` (postgis) and `redis:7-alpine` as GitHub Actions service containers, mirroring the ports/creds `apps/api/.env.test` already expects), `pnpm --filter @arayeshgah/user-app test`, `pnpm --filter @arayeshgah/provider-panel test`, `pnpm --filter @arayeshgah/admin-panel test`, and `pnpm --filter @arayeshgah/user-app test:e2e` (Playwright, against a locally-started dev stack in the runner). `pnpm build` (turbo, all apps) also runs here as a build-correctness gate.
- **`build-and-push`** (push to `main` only, `needs: test`): logs into GHCR using the built-in `GITHUB_TOKEN` (no extra secret needed), builds the four Dockerfiles with `docker/build-push-action`, and pushes `:${{ github.sha }}` and `:latest` for each. `VITE_API_BASE` is passed as a build arg from a repo-level Actions **variable**, not a secret.

No deploy job. No SSH key, no VPS credentials touch CI at any point.

## 7. Secrets, Env, and Migrations

- Production `.env` lives **only on the VPS**, alongside `docker-compose.prod.yml` and the `Caddyfile` — never committed, never passed through CI. It holds everything `apps/api/.env.example` already documents (DB creds, `JWT_SECRET`, `KAVENEGAR_API_KEY`, `ZARINPAL_MERCHANT_ID`, `VAPID_PRIVATE_KEY`, `S3_*` credentials) plus the four `DOMAIN_*` values Caddy reads.
- The only "secret-shaped" value baked into an image is `VITE_API_BASE` (SPA build arg), and it isn't actually secret — it's the public API URL, so shipping it as a repo Variable rather than a Secret is correct and keeps it visible in workflow logs for debugging.
- **Migrations run as an explicit manual step, never automatically on container boot** — `docker compose -f docker-compose.prod.yml exec api pnpm migration:run`, using the same script and `src/data-source.ts` the codebase already has, which works because (per §4) the api image keeps full source + devDependencies rather than being slimmed to `dist/` only. This matches the existing local workflow exactly and avoids an unreviewed schema change firing on every restart.
- Routine env changes: edit `.env` on the VPS, `docker compose -f docker-compose.prod.yml up -d <service>` recreates just that container with the new values (no rebuild — `api`/`user-app`/`postgres`/`redis` all read env at runtime). The one exception is `VITE_API_BASE` for the two SPAs, which is baked at build time — changing it requires a new image (i.e., goes through CI, not a VPS-side env edit).

## 8. Caddy

A single `Caddyfile`, four site blocks (one per domain from §3), each `reverse_proxy <service>:<port>` to the matching app container by Docker service name. A top-level `email` directive registers the ACME account for Let's Encrypt. No manual certificate handling — Caddy requests, renews, and serves HTTPS automatically the first time it sees traffic on each domain, given the VPS's DNS already points at it.

## 9. Real Provider Wiring

Kavenegar (SMS), Zarinpal (payments), S3-compatible storage (object storage), and Web Push already have complete, unit-tested implementations behind the existing `SmsProvider`/`PaymentGateway`/`StorageProvider`/`PushProvider` interfaces — this plan does not rewrite them. The work here is:

1. A focused read-through of each real implementation (`kavenegar-sms.provider.ts`, `zarinpal-payment.gateway.ts`, `s3-storage.provider.ts`, `web-push.provider.ts`) checking for production-readiness gaps an MVP implementation might have skipped (timeout handling, error-response parsing, retry behavior) — fix only what's actually broken, not speculative hardening.
2. A deployment doc section (§10) that gives the exact env-var checklist for cutting each concern over from its dev default to the real provider — `SMS_PROVIDER=kavenegar` + `KAVENEGAR_API_KEY` + `KAVENEGAR_OTP_TEMPLATE`; `PAYMENT_GATEWAY=zarinpal` + `ZARINPAL_MERCHANT_ID`; `STORAGE_PROVIDER=s3` + the four `S3_*` vars; `PUSH_PROVIDER=webpush` + the VAPID keypair (already generated per the root `CLAUDE.md`'s setup notes).
3. A manual smoke-test checklist for after cutover (send a real OTP, complete a real Zarinpal sandbox/small-amount payment, upload a real photo and confirm the S3 public URL resolves, subscribe to push and receive one) — real third-party credentials can't be exercised in CI, so this is explicitly a post-deploy manual step, not an automated test.

## 10. Deployment Docs

New `docs/deployment/DEPLOY.md`: one-time VPS setup (install Docker + compose plugin, create the deploy directory, place `docker-compose.prod.yml` + `Caddyfile` + `.env`, `docker login ghcr.io`, point DNS at the VPS), the routine deploy sequence (`docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`, then the manual `migration:run` step from §7 when a deploy includes a new migration), the provider cutover checklist from §9, and a rollback note (re-`up -d` with the previous image tag).

## 11. Testing

- No new application logic, so no new unit-test surface beyond whatever §9.1's provider read-through fixes turn up (those get colocated `.spec.ts` coverage same as every other fix in this codebase).
- CI itself is the primary thing being validated: the workflow is exercised by opening a PR against it and confirming both jobs run and the `build-and-push` job produces four images in GHCR after a merge to `main`.
- Each Dockerfile is validated by an actual local `docker build` + `docker run` smoke pass per app (API responds on `/api/health`, user-app serves SSR HTML, the two SPAs serve `index.html` and route client-side) before the CI workflow is considered done.
- `docker-compose.prod.yml` is validated by bringing the full stack up against a throwaway `.env` (dev-shaped secrets, mock/console providers) and confirming Caddy proxies all four domains and issues certs (or serves over plain HTTP if tested without real DNS/a staging ACME endpoint).

## 12. Out of Scope (deliberate)

- Kubernetes, multi-node, autoscaling, or any orchestrator beyond single-host `docker compose`.
- Automated/CI-driven deploy to the VPS — deploy stays a manual, documented command a human runs.
- Database backups/point-in-time recovery automation — genuinely important for a real production DB, but not part of what was scoped for this plan; flagged as a follow-up in §13, not silently dropped.
- Log aggregation, metrics, APM, alerting/paging — `docker compose logs` is the whole observability story for this plan.
- Zero-downtime/blue-green deploys — `up -d` briefly restarts the affected container(s).
- Staging environment — one production VPS only.

## 13. Open Risks / Follow-ups

- **No DB backup strategy yet.** A production Postgres instance with real customer/booking/payment data without any backup automation is a real operational risk. Recommended as an immediate next follow-up after this plan (e.g., a small cron container running `pg_dump` to the same S3 bucket already wired up in §9), but is out of scope here per the locked CI/deploy scope.
- **API image includes devDependencies** (§4/§7 tradeoff) — larger image and a slightly larger attack surface (build tooling present at runtime) in exchange for reusing the existing migration scripts unchanged. Acceptable for a single-VPS MVP; revisit if image size or supply-chain hardening becomes a priority.
- **`VITE_API_BASE` rebuild-to-change.** Because the two SPA images bake the API base URL at build time, changing it (e.g., a future domain migration) requires a new CI build+push, not just a VPS-side env edit — documented in §7, not a surprise, but worth remembering.
- **Caddy cert issuance requires real DNS pointed at the VPS before first boot** — there is no plan-level fallback for testing HTTPS without owning the domain; local validation (§11) is limited to plain HTTP or Caddy's internal staging CA.
