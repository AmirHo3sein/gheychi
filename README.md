# Arayeshgah

Salon discovery & booking marketplace (Iran). Spec: `docs/superpowers/specs/2026-07-04-arayeshgah-marketplace-design.md`.

## Structure

- `apps/api` — NestJS modular monolith (PostgreSQL + PostGIS, Redis)
- `apps/user-app` — Nuxt 3 PWA (Plan 3)
- `apps/provider-panel` — Vue 3 SPA (Plan 4)
- `apps/admin-panel` — Vue 3 SPA (Plan 5)

## Getting started

```bash
docker compose up -d          # postgres (postgis) + redis
cp .env.example apps/api/.env
pnpm install
pnpm --filter @arayeshgah/api migration:run
pnpm dev:api                  # http://localhost:3002/api/health
```

(Ports are non-default on this machine — see the "Port note" in `docs/superpowers/plans/2026-07-04-plan-1-foundation-backend-core.md`'s Task 2 section if setting up fresh elsewhere and `.env.example`'s values need adjusting for local port conflicts.)

## Tests

```bash
pnpm --filter @arayeshgah/api test        # unit
pnpm --filter @arayeshgah/api test:e2e    # e2e (needs docker services)
```
