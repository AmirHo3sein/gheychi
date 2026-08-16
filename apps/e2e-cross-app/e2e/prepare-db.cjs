// Prepares the e2e database+seed data BEFORE `playwright test` starts. Same rationale and
// shape as every other app's own e2e/prepare-db.cjs (see e.g. user-app's for the full story
// on why this can't be Playwright's globalSetup) -- duplicated rather than shared, matching
// this repo's existing convention of one independent prepare-db.cjs per e2e suite.
const { Client } = require('pg')
const { execSync } = require('node:child_process')
const path = require('node:path')
const Redis = require('ioredis')

// Same DB_NAME every other e2e suite in this repo defaults to -- safe because CI (and a
// local `pnpm test:e2e`) runs these suites one at a time against the same shared Postgres
// service, each resetting the schema for itself before it starts.
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

  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })
  await redis.flushdb()
  await redis.quit()

  execSync('pnpm --filter @gheychi/api migration:run', {
    cwd: path.resolve(__dirname, '../../..'),
    stdio: 'inherit',
    env: { ...process.env, DB_NAME },
  })

  const seed = makeClient()
  await seed.connect()
  // Same owner phone + salon slug + service as user-app's own seed -- the customer-facing
  // half of this spec (search, view salon, book, pay) is a near-verbatim reuse of
  // user-app's 01-happy-path.spec.ts flow, so it needs the identical fixture. The owner
  // phone doubles as the provider-panel login for the second half of the test.
  const { rows: [{ id: ownerId }] } = await seed.query(
    `INSERT INTO users (phone, role) VALUES ('09120000100', 'provider') RETURNING id`,
  )
  const { rows: [{ id: salonId }] } = await seed.query(
    `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
     VALUES ($1, 'سالن تست', 'e2e-test-salon', 'women', 'approved', 'آدرس تست', 'تهران',
       ST_SetSRID(ST_MakePoint(51.389, 35.6892), 4326)::geography)
     RETURNING id`,
    [ownerId],
  )
  const { rows: [{ id: categoryId }] } = await seed.query(`SELECT id FROM service_categories LIMIT 1`)
  await seed.query(
    `INSERT INTO salon_services (salon_id, category_id, name, price, duration_min, is_active)
     VALUES ($1, $2, 'کوتاهی مو', 300000, 30, true)`,
    [salonId, categoryId],
  )
  for (let weekday = 0; weekday <= 6; weekday++) {
    await seed.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time) VALUES ($1, $2, '09:00', '21:00')`,
      [salonId, weekday],
    )
  }
  await seed.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
