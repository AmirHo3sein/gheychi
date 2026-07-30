import { Client } from 'pg'
import { execSync } from 'node:child_process'
import path from 'node:path'
import Redis from 'ioredis'

export default async function globalSetup() {
  const client = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5544),
    user: process.env.DB_USER ?? 'gheychi',
    password: process.env.DB_PASS ?? 'gheychi',
    database: process.env.DB_NAME ?? 'gheychi',
  })
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
  })

  const seedClient = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5544),
    user: process.env.DB_USER ?? 'gheychi',
    password: process.env.DB_PASS ?? 'gheychi',
    database: process.env.DB_NAME ?? 'gheychi',
  })
  await seedClient.connect()
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
  await seedClient.end()
}
