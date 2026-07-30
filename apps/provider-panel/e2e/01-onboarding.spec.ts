import { test, expect } from '@playwright/test'
import Redis from 'ioredis'

test('login, complete onboarding wizard, land on pending-approval', async ({ page }) => {
  const phone = '09120000400'
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

  await expect(page).toHaveURL('/onboarding')

  await page.getByTestId('salon-name').fill('سالن پلی‌رایت')
  await page.getByTestId('gender-target').selectOption('women')
  await page.getByTestId('city').fill('تهران')
  await page.getByTestId('address').fill('خیابان آزادی، پلاک ۲')
  // SalonPinPicker deliberately does NOT auto-emit a coordinate on mount -- doing so used
  // to let an owner submit a listing whose geo-point silently defaulted to the map's
  // starting center. lat/lng only becomes "set" once the owner drags/clicks the map or
  // fills the coordinate inputs, so the wizard genuinely cannot advance until then.
  await page.getByTestId('pin-lat').fill('35.7')
  await page.getByTestId('pin-lat').dispatchEvent('change')
  await page.getByTestId('pin-lng').fill('51.4')
  await page.getByTestId('pin-lng').dispatchEvent('change')
  await expect(page.getByTestId('wizard-next')).toBeEnabled({ timeout: 15_000 })
  await page.getByTestId('wizard-next').click()

  await page.locator('[data-testid="day-0"] input[type=checkbox]').check()
  await page.getByTestId('wizard-next').click()

  await page.getByTestId('service-category').selectOption({ index: 1 })
  await page.getByTestId('service-name').fill('کوتاهی مو')
  await page.getByTestId('service-price').fill('250000')
  await page.getByTestId('service-duration').fill('45')
  await page.getByTestId('wizard-submit').click()

  await expect(page).toHaveURL('/pending-approval')
  await expect(page.getByText('در حال بررسی است')).toBeVisible()
})
