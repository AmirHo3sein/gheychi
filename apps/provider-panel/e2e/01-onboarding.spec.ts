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
  // SalonPinPicker emits a default coordinate as soon as its Leaflet map mounts --
  // waiting for the next button to enable covers that without polling the map directly.
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
