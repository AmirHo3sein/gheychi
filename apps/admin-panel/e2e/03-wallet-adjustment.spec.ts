import { test, expect, type Page } from '@playwright/test'
import Redis from 'ioredis'

const ADMIN_PHONE = '09120000500'
// Seeded in prepare-db.cjs as a plain customer with no prior wallet history -- this spec's
// target user for a manual balance adjustment.
const CUSTOMER_PHONE = '09120000502'

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

// This is the THIRD OTP request against ADMIN_PHONE within this suite run
// (01-approve-salon.spec.ts and 02-moderation-and-money.spec.ts already spend the first two
// of OtpService's 3/hour cap on this exact phone) -- right at the limit, not over it, and
// Playwright's workers: 1 config guarantees these spec files never race each other for it.
//
// This fills a real, previously-dropped gap: a manual wallet balance adjustment is real money
// moving with no other business-event trigger behind it (per AdjustWalletDto's own comment),
// and had zero Playwright coverage. A prior attempt at this exact spec earlier in the same
// project work was flaky enough to be dropped rather than landed -- this version avoids
// arbitrary waits/sleeps entirely and scopes every locator narrowly (by data-testid, or by
// filtering to the exact seeded phone/reason text) so every assertion is a plain
// auto-retrying Playwright `expect(...)`, including across the 350ms search-debounce in
// usePhoneUserSearch and the ledger table's own async reload after a submit.
test('admin manually adjusts a customer wallet balance, and the ledger reflects it', async ({ page }) => {
  await loginAsAdmin(page)

  await page.goto('/wallet')
  await page.waitForLoadState('networkidle')

  // -- Pick the target user by phone (debounced search -- the match panel and the button
  // inside it only render once the debounce fires and the API round-trip resolves; expect()
  // auto-retries so no manual wait is needed for either) --
  await page.getByTestId('adjust-phone-input').fill(CUSTOMER_PHONE)
  const matchButton = page.getByTestId('adjust-user-matches').getByRole('button', { name: new RegExp(CUSTOMER_PHONE) })
  await expect(matchButton).toBeVisible()
  await matchButton.click()
  await expect(page.getByTestId('adjust-selected-user')).toContainText(CUSTOMER_PHONE)

  const reason = 'تعدیل دستی تست پلی‌رایت'
  await page.getByTestId('adjust-amount-input').fill('50000')
  await page.getByTestId('adjust-reason-input').fill(reason)

  await expect(page.getByTestId('adjust-open-confirm')).toBeEnabled()
  await page.getByTestId('adjust-open-confirm').click()

  // -- Confirm screen: shows exactly what will happen before it actually moves money --
  await expect(page.getByTestId('adjust-confirm-submit')).toBeVisible()
  await expect(page.getByText(reason)).toBeVisible()
  await page.getByTestId('adjust-confirm-submit').click()

  await expect(page.getByText('به‌روزرسانی شد')).toBeVisible()
  // The form resets after a successful submit -- back to the empty picker, not stuck on the
  // confirm screen (would indicate the submit silently failed despite the toast).
  await expect(page.getByTestId('adjust-phone-input')).toBeVisible()

  // -- The ledger reflects the real, persisted effect, not just an optimistic toast: filter
  // by the same user and check the new row's amount and reason --
  await page.getByTestId('wallet-phone-filter').fill(CUSTOMER_PHONE)
  const ledgerMatchButton = page.getByTestId('wallet-user-matches').getByRole('button', { name: new RegExp(CUSTOMER_PHONE) })
  await expect(ledgerMatchButton).toBeVisible()
  await ledgerMatchButton.click()
  await expect(page.getByTestId('wallet-selected-user')).toContainText(CUSTOMER_PHONE)

  const row = page.locator('tbody tr').filter({ hasText: reason })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('۵۰٬۰۰۰')
  await expect(row).toContainText('تعدیل دستی')
})
