import { test, expect } from '@playwright/test'
import Redis from 'ioredis'

test('log in as admin, approve a pending salon', async ({ page, request }) => {
  const phone = '09120000500'
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

  // exact: true -- the dashboard's quick-link cards also contain "آرایشگاه‌ها" as a
  // substring of a longer label, which would otherwise match this selector too.
  await page.getByRole('link', { name: 'آرایشگاه‌ها', exact: true }).click()
  await expect(page).toHaveURL('/salons')

  await page.getByRole('link', { name: 'سالن در انتظار تایید', exact: true }).click()
  await expect(page).toHaveURL(/\/salons\/[0-9a-f-]+/)
  const salonId = page.url().split('/salons/')[1]

  await page.getByTestId('approve-button').click()

  // Verify the status genuinely flipped via a follow-up API call, not just a UI assertion --
  // the page's own text would say "approved" either way if the click handler were a no-op
  // that just optimistically rendered without checking the API's response.
  const cookies = await page.context().cookies()
  const sessionCookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  await expect
    .poll(async () => {
      const res = await request.get(`http://localhost:3002/api/admin/salons/${salonId}`, {
        headers: { Cookie: sessionCookie },
      })
      return (await res.json()).status
    })
    .toBe('approved')
})
