import { test, expect } from '@playwright/test'
import Redis from 'ioredis'

test('log in as an approved provider and mark a confirmed booking completed', async ({ page }) => {
  const phone = '09120000300' // seeded in global-setup.ts with an approved salon + confirmed booking
  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })

  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('phone-input').fill(phone)
  await page.getByTestId('submit-phone').click()

  const codeInput = page.getByTestId('code-input')
  await expect(codeInput).toBeVisible()
  const code = await redis.get(`otp:${phone}`)
  await redis.quit()
  if (!code) throw new Error('OTP was not found in Redis -- did SMS_PROVIDER/OtpService change?')
  await codeInput.fill(code)
  await page.getByTestId('submit-code').click()

  await expect(page).toHaveURL('/')

  await page.getByRole('link', { name: 'نوبت‌ها', exact: true }).click()
  await expect(page).toHaveURL('/bookings')

  await page.getByTestId('mark-completed').first().click()
  await expect(page.getByText('انجام شد')).toBeVisible()

  // Completing the booking is what accrues the CRM's own figures (Phase 5 of the
  // monetization initiative -- see docs/technical-overview/32-salon-crm.md): the customer
  // list and dashboard summary both read live from bookings/payments/financial_transactions,
  // not a separate write path, so this is real end-to-end proof they're wired correctly.
  await page.goto('/customers')
  await page.waitForLoadState('networkidle')

  await expect(page.getByTestId('customer-row')).toHaveCount(1)
  const row = page.getByTestId('customer-row').first()
  await expect(row.getByText('انجام شد', { exact: false })).toHaveCount(0) // sanity: not a booking-status label leaking in
  await expect(row).toContainText('۱') // one booking so far

  await row.getByRole('link').click()
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]+/)
  await expect(page.getByTestId('customer-booking-row')).toHaveCount(1)

  await page.getByTestId('new-note-input').fill('مشتری همیشگی، دقت کافی داشته باشید')
  await page.getByTestId('add-note-button').click()
  await expect(page.getByTestId('note-row')).toHaveCount(1)
  await expect(page.getByTestId('note-row')).toContainText('مشتری همیشگی')
})
