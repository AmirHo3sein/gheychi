import { test, expect } from '@playwright/test'
import Redis from 'ioredis'

test('login, complete onboarding wizard, land on pending-approval', async ({ page }) => {
  const phone = '09120000400'
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

  await expect(page).toHaveURL('/onboarding')

  await page.getByTestId('salon-name').fill('سالن پلی‌رایت')
  await page.getByTestId('gender-target').selectOption('women')
  await page.getByTestId('city').fill('تهران')
  await page.getByTestId('address').fill('خیابان آزادی، پلاک ۲')
  // Whether the real Neshan SDK loads in this environment or not, SalonPinPicker emits a
  // default coordinate either way (see its onMounted success path and its catch-block
  // fallback) -- waiting for the next button to enable covers both cases without the test
  // needing to know which one happened.
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
