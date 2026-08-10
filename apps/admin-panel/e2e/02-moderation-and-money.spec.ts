import { test, expect, type Page } from '@playwright/test'
import Redis from 'ioredis'

const ADMIN_PHONE = '09120000500'

async function loginAsAdmin(page: Page) {
  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('phone-input').fill(ADMIN_PHONE)
  await page.getByTestId('submit-phone').click()

  const codeInput = page.getByTestId('code-input')
  await expect(codeInput).toBeVisible()
  const code = await redis.get(`otp:${ADMIN_PHONE}`)
  await redis.quit()
  if (!code) throw new Error('OTP was not found in Redis -- did SMS_PROVIDER/OtpService change?')
  await codeInput.fill(code)
  await page.getByTestId('submit-code').click()
  await expect(page).toHaveURL('/')
}

// Every scenario below shares ONE login -- OtpService rate-limits to 3 requests/phone/hour
// (same reasoning as provider-panel's 03-manual-booking-and-time-off.spec.ts), and
// 01-approve-salon.spec.ts already spends one of those on this exact admin phone within the
// same suite run.
test('salon moderation (reject + suspend) and platform config', async ({ page, request }) => {
  await loginAsAdmin(page)
  const cookies = await page.context().cookies()
  const sessionCookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

  // -- Reject a pending salon: a reason is required, and the API-side status + reason must
  // actually persist, not just optimistically render. --
  await page.goto('/salons')
  await page.waitForLoadState('networkidle')
  // NOT 'سالن در انتظار تایید' -- 01-approve-salon.spec.ts already approves that one against
  // this same shared e2e database, so it's no longer 'pending' by the time this spec runs.
  await page.getByRole('link', { name: 'سالن در انتظار رد', exact: true }).click()
  await expect(page).toHaveURL(/\/salons\/[0-9a-f-]+/)
  const pendingSalonId = page.url().split('/salons/')[1]

  await page.getByTestId('reject-button').click()
  // Submitting with no reason must block, not silently reject with an empty one.
  await page.getByTestId('reject-submit').click()
  await expect(page.getByTestId('reason-error')).toBeVisible()

  await page.getByTestId('reason-input').fill('مدارک کسب‌وکار ناقص است')
  await page.getByTestId('reject-submit').click()

  await expect
    .poll(async () => {
      const res = await request.get(`http://localhost:3002/api/admin/salons/${pendingSalonId}`, {
        headers: { Cookie: sessionCookie },
      })
      const body = await res.json()
      return { status: body.status, rejectionReason: body.rejectionReason }
    })
    .toEqual({ status: 'rejected', rejectionReason: 'مدارک کسب‌وکار ناقص است' })

  // -- Suspend an already-live salon: a materially different, more consequential action than
  // reject (this one is currently public) -- untested until now. --
  await page.goto('/salons')
  await page.waitForLoadState('networkidle')
  await page.getByRole('link', { name: 'سالن تایید شده', exact: true }).click()
  await expect(page).toHaveURL(/\/salons\/[0-9a-f-]+/)
  const approvedSalonId = page.url().split('/salons/')[1]

  await page.getByTestId('suspend-button').click()
  await page.getByTestId('reason-input').fill('گزارش تخلف تایید شده')
  await page.getByTestId('reject-submit').click() // shared submit testid for both reject and suspend

  await expect
    .poll(async () => {
      const res = await request.get(`http://localhost:3002/api/admin/salons/${approvedSalonId}`, {
        headers: { Cookie: sessionCookie },
      })
      return (await res.json()).status
    })
    .toBe('suspended')

  // -- Platform config: an out-of-range percent must block save entirely (never reach the
  // confirm screen, let alone PATCH), then a valid change persists. --
  await page.goto('/config')
  await page.waitForLoadState('networkidle')
  const commissionInput = page.getByLabel('درصد کمیسیون پلتفرم')
  await commissionInput.fill('150')
  await expect(page.getByTestId('config-save-button')).toBeDisabled()

  await commissionInput.fill('15')
  await expect(page.getByTestId('config-save-button')).toBeEnabled()
  await page.getByTestId('config-save-button').click()
  await expect(page.getByTestId('config-confirm-summary')).toBeVisible()
  await page.getByTestId('config-confirm-submit').click()

  await expect
    .poll(async () => {
      const res = await request.get('http://localhost:3002/api/admin/config', { headers: { Cookie: sessionCookie } })
      const rows: Array<{ key: string; value: number }> = await res.json()
      return rows.find((r) => r.key === 'commission_percent')?.value
    })
    .toBe(15)
})
