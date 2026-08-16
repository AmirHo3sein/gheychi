import { test, expect, type Page } from '@playwright/test'
import Redis from 'ioredis'

// Distinct from ADMIN_PHONE (09120000500) used by 01/02/03 -- OtpService rate-limits to
// 3 requests/phone/hour and those three specs already spend all three on that phone within
// this same suite run. This one logs in on a second seeded admin account instead.
const ADMIN_PHONE = '09120000506'

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

// Five admin-panel pages that had solid unit/component coverage but zero end-to-end
// coverage: categories (delete-with-restrict semantics), audit log, analytics dashboard,
// referral settings, and invoice payment-recording. Bundled into one test with one login
// (same reasoning as 02-moderation-and-money.spec.ts) -- each flow gets its own ADMIN_PHONE
// login budget otherwise, and there's only one spare login left this run.
test('categories, audit log, analytics, referral settings, and invoice payment recording', async ({ page, request }) => {
  await loginAsAdmin(page)
  const cookies = await page.context().cookies()
  const sessionCookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

  // -- Categories: add, then delete-with-restrict (409, in use) vs. a real delete --
  await page.goto('/categories')
  await page.waitForLoadState('networkidle')

  await page.getByPlaceholder('کلید آیکون').fill('sparkles')
  await page.getByPlaceholder('نام دسته‌بندی').fill('دسته‌بندی جدید e2e')
  await page.getByRole('button', { name: 'افزودن', exact: true }).click()
  await expect(page.locator('tbody tr').filter({ hasText: 'دسته‌بندی جدید e2e' })).toBeVisible()

  // 'رنگ مو e2e' is referenced by a real salon_services row (seeded) -- delete must 409 and
  // the row must survive, not just show a toast while secretly disappearing.
  const usedRow = page.locator('tbody tr').filter({ hasText: 'رنگ مو e2e' })
  await usedRow.getByTestId('delete-category').click()
  await usedRow.getByTestId('confirm-delete').click()
  await expect(page.getByText('این دسته‌بندی توسط خدمات سالن‌ها استفاده می‌شود و قابل حذف نیست')).toBeVisible()
  await expect(usedRow).toBeVisible()

  // 'دسته‌بندی بدون استفاده e2e' has no references -- delete actually succeeds.
  const unusedRow = page.locator('tbody tr').filter({ hasText: 'دسته‌بندی بدون استفاده e2e' })
  await unusedRow.getByTestId('delete-category').click()
  await unusedRow.getByTestId('confirm-delete').click()
  await expect(page.locator('tbody tr').filter({ hasText: 'دسته‌بندی بدون استفاده e2e' })).toHaveCount(0)

  // -- Audit log: every action any earlier spec (or this one, via the category add/delete
  // above) took already wrote a real audit row -- confirm the list isn't stuck on its empty
  // state and a known action/target renders correctly. --
  await page.goto('/audit-log')
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('load-error')).toHaveCount(0)
  const categoryDeleteRow = page.locator('tbody tr').filter({ hasText: 'دسته‌بندی' }).first()
  await expect(categoryDeleteRow).toBeVisible()
  await expect(categoryDeleteRow.getByTestId('success-badge')).toContainText('موفق')

  // -- Analytics: the seeded analytics_events row surfaces in the totals table --
  await page.goto('/analytics')
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('analytics-error')).toHaveCount(0)
  const eventRow = page.getByTestId('event-total-row').filter({ hasText: 'ثبت‌نام کاربر' })
  await expect(eventRow).toBeVisible()
  await expect(eventRow).toContainText('۱')

  // -- Referral settings: enable the 'user' row, edit both reward values, save through the
  // confirm-before-commit step, and verify the change genuinely persisted server-side. --
  await page.goto('/referrals/settings')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('enabled-toggle-user').click()
  await page.getByTestId('referrer-value-user').fill('20000')
  await page.getByTestId('referred-value-user').fill('10')
  await expect(page.getByTestId('save-user')).toBeEnabled()
  await page.getByTestId('save-user').click()
  await expect(page.getByTestId('confirm-summary-user')).toBeVisible()
  await page.getByTestId('confirm-submit-user').click()
  await expect(page.getByTestId('confirm-summary-user')).toHaveCount(0)

  await expect
    .poll(async () => {
      const res = await request.get('http://localhost:3002/api/admin/referral-reward-types', {
        headers: { Cookie: sessionCookie },
      })
      const rows: Array<{ referralType: string; enabled: boolean; referrerRewardValue: number; referredRewardValue: number }> =
        await res.json()
      return rows.find((r) => r.referralType === 'user')
    })
    .toEqual(expect.objectContaining({ enabled: true, referrerRewardValue: 20000, referredRewardValue: 10 }))

  // -- Invoices: record a payment covering the full net-payable amount and confirm the
  // status actually flips (not just an optimistic toast). --
  await page.goto('/invoices')
  await page.waitForLoadState('networkidle')
  const invoiceRow = page.locator('tbody tr').filter({ hasText: 'سالن تایید شده' }).first()
  await invoiceRow.getByTestId('toggle-invoice-detail').click()
  await expect(page.getByTestId('invoice-detail-row')).toBeVisible()

  await page.getByTestId('record-payment-button').click()
  await page.getByTestId('payment-amount-input').fill('450000')
  await page.getByTestId('payment-reference-input').fill('TRX-E2E-1')
  await page.getByTestId('submit-payment').click()

  // The button stays rendered but disables itself once status is 'paid'/'void' -- it's the
  // row's own status badge that proves the payment genuinely persisted, not just a toast.
  await expect(page.getByTestId('record-payment-button')).toBeDisabled()
  const paidBadgeRow = page.locator('tbody tr').filter({ hasText: 'سالن تایید شده' }).first()
  await expect(paidBadgeRow).toContainText('پرداخت‌شده')
})
