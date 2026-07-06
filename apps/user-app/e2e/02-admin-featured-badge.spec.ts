import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import Redis from 'ioredis'

test('a salon flagged featured by an admin shows the Ad badge on Home', async ({ page }) => {
  const phone = '09120000200' // the customer from the happy-path test, already onboarded

  const client = new Client({
    host: process.env.DB_HOST ?? 'localhost', port: Number(process.env.DB_PORT ?? 5544),
    user: process.env.DB_USER ?? 'arayeshgah', password: process.env.DB_PASS ?? 'arayeshgah',
    database: process.env.DB_NAME ?? 'arayeshgah',
  })
  await client.connect()
  await client.query(`INSERT INTO users (phone, role) VALUES ('09120000201', 'admin') ON CONFLICT DO NOTHING`)
  await client.query(`UPDATE salons SET is_featured = true WHERE slug = 'e2e-test-salon'`)
  await client.end()

  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })

  await page.goto('/login')
  // See the matching comment in 01-happy-path.spec.ts: on a cold dev server, a click can
  // land before Vue hydration attaches the form handler, falling through to a native
  // (non-JS) form submit. Give hydration's module fetches a chance to settle first.
  await page.waitForLoadState('networkidle')
  await page.getByPlaceholder('09xxxxxxxxx').fill(phone)
  await page.getByRole('button', { name: 'دریافت کد' }).click()

  // .click() only dispatches the click -- it does not wait for the async request-otp
  // fetch it triggers to resolve. Wait for the UI to actually advance to the code step
  // (which only happens after that fetch succeeds) before assuming Redis has been written,
  // or this races the network call and intermittently reads a stale/missing key.
  const codeInput = page.getByPlaceholder('کد ۶ رقمی')
  await expect(codeInput).toBeVisible()

  const code = await redis.get(`otp:${phone}`)
  await redis.quit()
  if (!code) throw new Error('OTP was not found in Redis -- did SMS_PROVIDER/OtpService change?')

  await codeInput.fill(code)
  await page.getByRole('button', { name: 'تایید' }).click()

  await expect(page.getByTestId('ad-badge')).toBeVisible()
})
