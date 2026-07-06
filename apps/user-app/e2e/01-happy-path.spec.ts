import { test, expect } from '@playwright/test'
import Redis from 'ioredis'

test('search, view salon, book, pay, land on confirmation', async ({ page }) => {
  const phone = '09120000200'
  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })

  await page.goto('/login')
  // On a cold `nuxt dev` process (what webServer always spawns), the SSR-rendered /login
  // HTML can be painted before Vue finishes hydrating and attaching the form's
  // @submit.prevent handler. A click that lands in that gap falls through to the native
  // HTML form submit (a full-page GET reload), never calling fetch at all -- confirmed by
  // instrumenting request/response/requestfailed events during debugging, which showed a
  // reload's worth of aborted module fetches and zero request-otp calls. Waiting for the
  // network to settle after navigation gives hydration's module fetches time to finish
  // before the first interaction.
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

  await page.getByPlaceholder('نام').fill('کاربر تست')
  await page.getByRole('combobox').selectOption('female')
  await page.getByRole('button', { name: 'تکمیل ثبت‌نام' }).click()

  await expect(page).toHaveURL('/')
  await page.getByText('سالن تست').click()

  await expect(page).toHaveURL(/\/salons\/e2e-test-salon/)
  await page.getByText('کوتاهی مو').click()

  await expect(page).toHaveURL(/\/booking\/e2e-test-salon\//)
  await page.getByTestId('slot-button').first().click()
  await page.getByRole('button', { name: 'پرداخت و رزرو' }).click()

  // MockPaymentGateway immediately redirects back with Status=OK -- see mock-payment.gateway.ts
  await expect(page).toHaveURL(/\/booking\/callback\?status=success/)
  await expect(page.getByText('پرداخت با موفقیت انجام شد')).toBeVisible()
})
