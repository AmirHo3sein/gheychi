import { test, expect } from '@playwright/test'
import Redis from 'ioredis'

test('log in as an approved provider and mark a confirmed booking completed', async ({ page }) => {
  const phone = '09120000300' // seeded in global-setup.ts with an approved salon + confirmed booking
  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })

  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('phone-input').fill(phone)
  await page.getByTestId('phone-form').getByRole('button').click()

  const codeInput = page.getByTestId('code-input')
  await expect(codeInput).toBeVisible()
  const code = await redis.get(`otp:${phone}`)
  await redis.quit()
  if (!code) throw new Error('OTP was not found in Redis -- did SMS_PROVIDER/OtpService change?')
  await codeInput.fill(code)
  await page.getByTestId('code-form').getByRole('button').click()

  await expect(page).toHaveURL('/')

  await page.getByRole('link', { name: 'نوبت‌ها' }).click()
  await expect(page).toHaveURL('/bookings')

  await page.getByTestId('mark-completed').first().click()
  await expect(page.getByText('completed')).toBeVisible()
})
