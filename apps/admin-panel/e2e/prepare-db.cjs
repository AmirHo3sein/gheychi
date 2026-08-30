// Prepares the e2e database+seed data BEFORE `playwright test` starts. Deliberately run as
// its own pretest step (package.json's test:e2e), not wired via Playwright's `globalSetup`
// config option: Playwright starts the webServer-spawned API process and runs globalSetup
// without a guaranteed ordering between them (confirmed empirically -- the API process
// raced ahead of a schema reset/migration run happening inside globalSetup, first failing
// to connect to a not-yet-created database, then failing on a not-yet-migrated table, on
// two separate real runs, in the identical setup this file replaces in apps/user-app).
// Running this as a strictly sequential shell step before `playwright test` even starts is
// what actually guarantees the database is fully ready before Playwright spawns the
// webServer that queries it.
//
// Plain CommonJS (.cjs), not TypeScript -- this only needs to run once, directly via `node`,
// with zero build step or TS-loader dependency to get right.
const { Client } = require('pg')
const { execSync } = require('node:child_process')
const path = require('node:path')
const Redis = require('ioredis')

// Deliberately NOT 'gheychi' -- that's the same default DB_NAME a developer's ordinary
// `pnpm dev` stack uses, and this script DROP SCHEMAs its target on every run. Without its
// own DB, running this suite locally destroys whatever real dev data was sitting in the
// shared dev database. Overridable via DB_NAME, same as every other DB_* var here, but the
// DEFAULT must be safe to run without thinking about it.
//
// This database is pre-provisioned (docker/postgres-init/02-e2e-db.sql for a fresh volume,
// or a one-time manual `CREATE DATABASE gheychi_e2e` for an existing one -- see README).
const DB_NAME = process.env.DB_NAME ?? 'gheychi_e2e'

function makeClient() {
  return new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5544),
    user: process.env.DB_USER ?? 'gheychi',
    password: process.env.DB_PASS ?? 'gheychi',
    database: DB_NAME,
  })
}

async function main() {
  const client = makeClient()
  await client.connect()
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await client.end()

  // Same reasoning as provider-panel's prepare-db.cjs: OtpService rate-limits requests
  // per phone via a Redis key that outlives a Postgres reset, so flush both.
  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })
  await redis.flushdb()
  await redis.quit()

  execSync('pnpm --filter @gheychi/api migration:run', {
    cwd: path.resolve(__dirname, '../../..'),
    stdio: 'inherit',
    // data-source.ts loads apps/api/.env via dotenv, which does NOT override an already-set
    // process.env var -- passing DB_NAME here (rather than relying on the child process's
    // own .env) is what keeps the migration run pointed at the same DB_NAME this script uses.
    env: { ...process.env, DB_NAME },
  })

  const seed = makeClient()
  await seed.connect()
  await seed.query(`INSERT INTO users (phone, role) VALUES ('09120000500', 'admin')`)
  const { rows: [{ id: ownerId }] } = await seed.query(
    `INSERT INTO users (phone, role) VALUES ('09120000501', 'provider') RETURNING id`,
  )
  await seed.query(
    `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
     VALUES ($1, 'سالن در انتظار تایید', 'e2e-admin-panel-salon', 'women', 'pending', 'آدرس تست', 'تهران',
       ST_SetSRID(ST_MakePoint(51.389, 35.6892), 4326)::geography)`,
    [ownerId],
  )
  // A second, already-approved salon under its own owner -- 02-moderation-and-money.spec.ts
  // needs a live salon to suspend (the pending one above is only useful for reject, which
  // requires 'pending'; suspend requires 'approved').
  const { rows: [{ id: approvedOwnerId }] } = await seed.query(
    `INSERT INTO users (phone, role) VALUES ('09120000504', 'provider') RETURNING id`,
  )
  await seed.query(
    `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
     VALUES ($1, 'سالن تایید شده', 'e2e-admin-panel-approved-salon', 'women', 'approved', 'آدرس تست', 'تهران',
       ST_SetSRID(ST_MakePoint(51.389, 35.6892), 4326)::geography)`,
    [approvedOwnerId],
  )
  // A THIRD, dedicated pending salon for 02-moderation-and-money.spec.ts's reject scenario --
  // it cannot reuse the 'سالن در انتظار تایید' salon above, since 01-approve-salon.spec.ts
  // runs first against this same shared e2e database and approves that one, leaving
  // 'reject-button' (v-if="status === 'pending'") permanently absent for any spec after it.
  const { rows: [{ id: rejectOwnerId }] } = await seed.query(
    `INSERT INTO users (phone, role) VALUES ('09120000505', 'provider') RETURNING id`,
  )
  await seed.query(
    `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
     VALUES ($1, 'سالن در انتظار رد', 'e2e-admin-panel-reject-salon', 'women', 'pending', 'آدرس تست', 'تهران',
       ST_SetSRID(ST_MakePoint(51.389, 35.6892), 4326)::geography)`,
    [rejectOwnerId],
  )
  // A plain customer with no salon/wallet history yet -- 03-wallet-adjustment.spec.ts's
  // target user for a manual balance adjustment via WalletView/AdjustBalanceCard.
  await seed.query(`INSERT INTO users (phone, role) VALUES ('09120000502', 'customer')`)

  // A SECOND admin account, distinct from 09120000500 -- OtpService rate-limits to 3
  // requests/phone/hour and 01/02/03 above already spend all three on that phone within
  // this same suite run. 04-admin-gap-coverage.spec.ts logs in as this one instead.
  await seed.query(`INSERT INTO users (phone, role) VALUES ('09120000506', 'admin')`)
  // A THIRD admin account -- 05-plans-and-subscriptions.spec.ts logs in as this one, same
  // rate-limit reasoning as the second account above.
  await seed.query(`INSERT INTO users (phone, role) VALUES ('09120000507', 'admin')`)

  // -- Seed data for 04-admin-gap-coverage.spec.ts (categories, invoices, analytics --
  // previously zero e2e coverage despite solid unit coverage on each of these pages) --

  // One category referenced by a real salon service (delete must 409-restrict), one
  // unreferenced (delete must actually succeed).
  const { rows: [{ id: usedCategoryId }] } = await seed.query(
    `INSERT INTO service_categories (name, icon) VALUES ('رنگ مو e2e', 'palette') RETURNING id`,
  )
  await seed.query(`INSERT INTO service_categories (name, icon) VALUES ('دسته‌بندی بدون استفاده e2e', 'tag')`)
  const { rows: [{ id: approvedSalonId }] } = await seed.query(
    `SELECT id FROM salons WHERE slug = 'e2e-admin-panel-approved-salon'`,
  )
  await seed.query(
    `INSERT INTO salon_services (salon_id, category_id, name, price, duration_min)
     VALUES ($1, $2, 'رنگ مو e2e', 300000, 60)`,
    [approvedSalonId, usedCategoryId],
  )

  // An issued invoice for the same approved salon -- InvoicesView's record-payment action
  // (InvoiceStatusActions.vue -> PATCH /admin/invoices/:id/payment) had zero e2e coverage.
  await seed.query(
    `INSERT INTO invoices (salon_id, jalali_year, jalali_month, period_start, period_end,
       total_gross_amount, total_commission_amount, total_net_payable, status)
     VALUES ($1, 1404, 5, '2026-07-22T00:00:00Z', '2026-08-21T23:59:59Z', 500000, 50000, 450000, 'issued')`,
    [approvedSalonId],
  )

  // One analytics event -- AnalyticsView's totals table had zero e2e coverage (only its
  // component-level spec exercised it against a mocked API response).
  await seed.query(`INSERT INTO analytics_events (event_name, properties) VALUES ('user_registered', '{}')`)

  // Every salon above was inserted directly via raw SQL, bypassing SalonsService.createForOwner
  // -- the app-layer hook that normally gives a brand-new salon its initial subscription row
  // in the same transaction as the insert (see docs/technical-overview/30-subscription-plan-foundation.md).
  // Backfills the same invariant the real migration does for pre-existing salons, so
  // 05-plans-and-subscriptions.spec.ts's salon has a resolvable subscription to read/edit.
  await seed.query(`
    INSERT INTO salon_subscriptions (salon_id, plan_id, status, started_at)
    SELECT s.id, p.id, 'active', now()
    FROM salons s, plans p
    WHERE p.is_default = true
      AND NOT EXISTS (SELECT 1 FROM salon_subscriptions ss WHERE ss.salon_id = s.id)
  `)

  await seed.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
