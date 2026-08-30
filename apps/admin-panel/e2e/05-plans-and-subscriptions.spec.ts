import { test, expect, type Page } from '@playwright/test'
import Redis from 'ioredis'

const ADMIN_PHONE = '09120000507'

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

// Phase 2/3 of the monetization initiative (docs/technical-overview/30-subscription-plan-foundation.md).
// One login covers both halves: creating a plan on /plans, then assigning it to a real salon
// from SalonDetailView's SalonSubscriptionCard -- the two screens this phase actually shipped.
test('admin creates a plan and assigns it to a salon, verified end-to-end', async ({ page, request }) => {
  await loginAsAdmin(page)
  const cookies = await page.context().cookies()
  const sessionCookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

  // -- Create a new plan on /plans --
  await page.goto('/plans')
  await page.waitForLoadState('networkidle')

  await page.getByTestId('new-plan-button').click()
  await page.getByTestId('new-key-input').fill('e2e-plus')
  await page.getByTestId('new-name-input').fill('پلاس آزمایشی')
  await page.getByTestId('new-price-input').fill('490000')
  await page.getByTestId('new-entitlements-input').fill('{"smsMonthlyQuota": 200}')
  await page.getByTestId('submit-new-plan').click()

  await expect(page.getByTestId('plan-card').filter({ hasText: 'پلاس آزمایشی' })).toBeVisible()

  // -- Assign it to a real salon via SalonDetailView's subscription card --
  await page.goto('/salons')
  await page.waitForLoadState('networkidle')
  await page.getByRole('link', { name: 'سالن تایید شده', exact: true }).click()
  await expect(page).toHaveURL(/\/salons\/[0-9a-f-]+/)
  const salonId = page.url().split('/salons/')[1]

  await expect(page.getByTestId('change-plan-button')).toBeVisible()

  // AppSelect wraps vue-multiselect (same idiom as provider-panel's onboarding/services
  // specs): open it, then click the option by its rendered label text. Scoped to this
  // specific combobox by its accessible name -- the page has several other AppSelects.
  await page.getByRole('combobox', { name: 'تغییر پلن' }).click()
  await page.locator('.multiselect__option', { hasText: 'پلاس آزمایشی' }).first().click()
  await page.getByTestId('change-plan-button').click()
  await page.getByTestId('confirm-plan-change').click()

  await expect
    .poll(async () => {
      const res = await request.get(`http://localhost:3002/api/admin/salons/${salonId}/subscription`, {
        headers: { Cookie: sessionCookie },
      })
      const body = await res.json()
      return { planKey: body.plan.key, resolvedEntitlements: body.resolvedEntitlements }
    })
    .toEqual({ planKey: 'e2e-plus', resolvedEntitlements: { smsMonthlyQuota: 200 } })

  // -- Set a salon-specific override and confirm it wins over the plan's own value --
  await page.getByTestId('edit-overrides-button').click()
  await page.getByTestId('overrides-input').fill('{"smsMonthlyQuota": 999}')
  await page.getByTestId('save-overrides-button').click()

  await expect
    .poll(async () => {
      const res = await request.get(`http://localhost:3002/api/admin/salons/${salonId}/subscription`, {
        headers: { Cookie: sessionCookie },
      })
      return (await res.json()).resolvedEntitlements
    })
    .toEqual({ smsMonthlyQuota: 999 })
})
