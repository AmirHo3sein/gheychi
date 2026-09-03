import { test, expect, type Page } from '@playwright/test'
import Redis from 'ioredis'

// Seeded in prepare-db.cjs with an approved salon.
const OWNER_PHONE = '09120000300'

async function loginAsOwner(page: Page) {
  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })
  // OtpService allows 3 code requests per phone per hour (RATE_LIMIT_MAX/RATE_WINDOW_SEC),
  // and specs 02/03/04 already spend all three on this same seeded owner within one run.
  // The limiter is doing exactly its job; what is wrong is asking one seeded phone to log in
  // four times, so this spec resets that phone's counter rather than weakening the rule or
  // introducing a second seeded owner that every other spec's counts would have to know
  // about. prepare-db.cjs resets the database but never touches Redis.
  await redis.del(`otp:rl:${OWNER_PHONE}`)
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('phone-input').fill(OWNER_PHONE)
  await page.getByTestId('submit-phone').click()

  const codeInput = page.getByTestId('code-input')
  await expect(codeInput).toBeVisible()
  const code = await redis.get(`otp:${OWNER_PHONE}`)
  await redis.quit()
  if (!code) throw new Error('OTP was not found in Redis -- did SMS_PROVIDER/OtpService change?')
  await codeInput.fill(code)
  await page.getByTestId('submit-code').click()
  await expect(page).toHaveURL('/')
}

// The one thing unit tests genuinely cannot prove about this page: that `/referrals/*` and
// `/wallet/*` -- endpoints that carry no role guard and until now were only ever called by
// the customer app -- really do answer a salon-owner session, and that the code is minted
// on first view rather than requiring some separate customer-app visit first.
test('a salon owner reaches their own referral code and wallet from the panel header', async ({ page }) => {
  await loginAsOwner(page)

  await page.getByTestId('nav-referral').click()
  await expect(page).toHaveURL('/referral')

  // GET /referrals/my-code mints this owner's one lifetime code on first call, so simply
  // arriving here is what creates it -- 8 chars from the no-0/O/1/I alphabet.
  const code = page.getByTestId('referral-code')
  await expect(code).toBeVisible()
  await expect(code).toHaveText(/^[A-HJ-NP-Z2-9]{8}$/)

  // A brand-new owner has no wallet_balances row at all; the page must render a real zero
  // rather than an empty section (an owner cannot tell "no balance" from "failed to load").
  await expect(page.getByTestId('wallet-balance')).toContainText('۰')

  // Honest empty states, not blank cards.
  await expect(page.getByTestId('referral-activity')).toContainText('هنوز کسی با کد شما ثبت‌نام نکرده است.')
  await expect(page.getByTestId('rewards-section')).toContainText('هنوز پاداشی برای شما ثبت نشده است.')

  // Privacy invariant, asserted against the real API response rather than a fixture: no
  // phone number of any shape reaches this page. (There are no referrals seeded here, so
  // this is a floor, not a proof -- the unit spec covers the populated case.)
  await expect(page.locator('body')).not.toContainText('***')
})
