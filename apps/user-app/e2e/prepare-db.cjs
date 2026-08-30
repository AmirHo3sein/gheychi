// Prepares the e2e database+seed data BEFORE `playwright test` starts. Deliberately run as
// its own pretest step (package.json's test:e2e), not wired via Playwright's `globalSetup`
// config option: Playwright starts the webServer-spawned API process and runs globalSetup
// without a guaranteed ordering between them (confirmed empirically -- the API process
// raced ahead of a schema reset/migration run happening inside globalSetup, first failing
// to connect to a not-yet-created database, then failing on a not-yet-migrated table, on
// two separate real runs). Running this as a strictly sequential shell step before
// `playwright test` even starts is what actually guarantees the database is fully ready
// before Playwright spawns the webServer that queries it.
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

  // OtpService rate-limits OTP requests per phone (max 3/hour, see otp.service.ts) via a
  // Redis key that outlives this Postgres reset. Without flushing Redis too, re-running
  // this suite (a local retry, or two CI runs within the same hour) reuses the same fixed
  // phone numbers and deterministically trips that limiter on the second run, failing with
  // a misleading "invalid phone" form error that has nothing to do with an actual regression.
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

  const seedClient = makeClient()
  await seedClient.connect()
  // The migration seeds feature_online_payment_enabled=false (see
  // docs/technical-overview/29-global-payment-toggle.md) -- a real production launch
  // decision, not something this suite's happy-path (which exercises a real mock Zarinpal
  // payment) should silently start skipping.
  await seedClient.query(`UPDATE platform_config SET value = 'true' WHERE key = 'feature_online_payment_enabled'`)
  const { rows: [{ id: ownerId }] } = await seedClient.query(
    `INSERT INTO users (phone, role) VALUES ('09120000100', 'provider') RETURNING id`,
  )
  const { rows: [{ id: salonId }] } = await seedClient.query(
    `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
     VALUES ($1, 'سالن تست', 'e2e-test-salon', 'women', 'approved', 'آدرس تست', 'تهران',
       ST_SetSRID(ST_MakePoint(51.389, 35.6892), 4326)::geography)
     RETURNING id`,
    [ownerId],
  )
  const { rows: [{ id: categoryId }] } = await seedClient.query(`SELECT id FROM service_categories LIMIT 1`)
  await seedClient.query(
    `INSERT INTO salon_services (salon_id, category_id, name, price, duration_min, is_active)
     VALUES ($1, $2, 'کوتاهی مو', 300000, 30, true)`,
    [salonId, categoryId],
  )
  for (let weekday = 0; weekday <= 6; weekday++) {
    await seedClient.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time) VALUES ($1, $2, '09:00', '21:00')`,
      [salonId, weekday],
    )
  }
  // Bypassed SalonsService.createForOwner's own subscription-insert hook by inserting the
  // salon directly via raw SQL above -- backfill the same invariant the real migration does
  // (see admin-panel's own prepare-db.cjs for the fuller rationale).
  await seedClient.query(`
    INSERT INTO salon_subscriptions (salon_id, plan_id, status, started_at)
    SELECT s.id, p.id, 'active', now()
    FROM salons s, plans p
    WHERE p.is_default = true
      AND NOT EXISTS (SELECT 1 FROM salon_subscriptions ss WHERE ss.salon_id = s.id)
  `)
  await seedClient.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
