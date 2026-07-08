import { Client } from 'pg'
import { execSync } from 'node:child_process'
import path from 'node:path'
import Redis from 'ioredis'

function makeClient() {
  return new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5544),
    user: process.env.DB_USER ?? 'arayeshgah',
    password: process.env.DB_PASS ?? 'arayeshgah',
    database: process.env.DB_NAME ?? 'arayeshgah',
  })
}

export default async function globalSetup() {
  const client = makeClient()
  await client.connect()
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await client.end()

  // Same reasoning as provider-panel's global-setup.ts: OtpService rate-limits requests
  // per phone via a Redis key that outlives a Postgres reset, so flush both.
  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })
  await redis.flushdb()
  await redis.quit()

  execSync('pnpm --filter @arayeshgah/api migration:run', {
    cwd: path.resolve(__dirname, '../../..'),
    stdio: 'inherit',
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
  await seed.end()
}
