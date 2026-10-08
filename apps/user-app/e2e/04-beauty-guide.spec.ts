import { test, expect, type Page } from '@playwright/test'
import Redis from 'ioredis'
import { Client } from 'pg'
import { join } from 'node:path'

// Beauty Guide end to end, against the deterministic mock AI provider (playwright.config.ts
// pins BEAUTY_ANALYSIS_PROVIDER=mock; its default "balayage" analysis maps to the seeded
// salon's real «بالیاژ» service in prepare-db.cjs). Covers the whole promise of the feature:
// inspiration → structured guide → real service with its real price → the EXISTING booking
// flow, with the guide attached to the booking for the salon.

const INSPIRATION = join(__dirname, 'fixtures', 'inspiration.jpg')

async function login(page: Page, phone: string) {
  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.getByPlaceholder('09xxxxxxxxx').fill(phone)
  await page.getByRole('button', { name: 'دریافت کد' }).click()
  const codeInput = page.getByPlaceholder('کد ۶ رقمی')
  await expect(codeInput).toBeVisible()
  const code = await redis.get(`otp:${phone}`)
  await redis.quit()
  if (!code) throw new Error('OTP was not found in Redis')
  await codeInput.fill(code)
  await page.getByRole('button', { name: 'تایید' }).click()
  await page.getByPlaceholder('نام').fill('کاربر راهنما')
  await page.getByRole('combobox').click()
  await page.locator('.multiselect__option', { hasText: 'زن' }).first().click()
  await page.getByRole('button', { name: 'تکمیل ثبت‌نام' }).click()
  await page.waitForURL((url) => url.pathname === '/', { timeout: 20_000 }).catch(() => page.goto('/'))
}

test('inspiration photo → beauty guide → real service → existing booking flow', async ({ page }) => {
  await login(page, '09120000400')

  // A dev-server first navigation can full-reload (see 01-happy-path.spec.ts), so this page is
  // opened directly rather than through the home CTA.
  await page.goto('/beauty-guide')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('guide-file-input').setInputFiles(INSPIRATION)
  await expect(page.getByTestId('guide-preview')).toBeVisible()
  await page.getByTestId('guide-submit').click()

  await page.waitForURL(/\/beauty-guide\/[0-9a-f-]{36}$/, { timeout: 30_000 })
  const guideId = page.url().split('/').pop()!

  // Structured, hedged guide content.
  await expect(page.getByTestId('guide-summary')).toContainText('بالیاژ')
  await expect(page.getByTestId('concept-balayage')).toContainText('بالیاژ (Balayage)')
  await expect(page.getByTestId('concept-balayage')).toContainText('به احتمال زیاد')
  await expect(page.getByTestId('guide-duration')).toContainText('تخمینی')

  // The seeded salon's REAL service and price -- then into the existing booking page.
  const book = page.getByTestId('guide-service-book').filter({ hasText: 'بالیاژ' }).first()
  await expect(book).toContainText('۲٬۵۰۰٬۰۰۰')
  await book.click()
  await page.waitForURL(new RegExp(`/booking/e2e-test-salon/[0-9a-f-]{36}\\?beautyGuideId=${guideId}`), { timeout: 30_000 })

  await page.getByTestId('slot-button').first().click()
  await page.getByTestId('confirm-booking-button').click()
  // prepare-db.cjs turns online payment on; MockPaymentGateway redirects straight back with Status=OK.
  await expect(page).toHaveURL(/\/booking\/callback\?status=success/, { timeout: 30_000 })
  await expect(page.getByText('پرداخت با موفقیت انجام شد')).toBeVisible({ timeout: 30_000 })

  // The booking carries the guide, and kept the service's real duration (120 min), not the
  // AI estimate (180-300 min).
  const db = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5544),
    user: process.env.DB_USER ?? 'gheychi',
    password: process.env.DB_PASS ?? 'gheychi',
    database: process.env.DB_NAME ?? 'gheychi_e2e',
  })
  await db.connect()
  const { rows } = await db.query(
    `SELECT status, EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60 AS minutes FROM bookings WHERE beauty_guide_id = $1`,
    [guideId],
  )
  await db.end()
  expect(rows).toHaveLength(1)
  expect(rows[0].status).toBe('confirmed')
  expect(Number(rows[0].minutes)).toBe(120)
})
