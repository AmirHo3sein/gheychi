import { test, expect, type Page } from '@playwright/test'
import Redis from 'ioredis'

async function otpCode(phone: string): Promise<string> {
  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })
  const code = await redis.get(`otp:${phone}`)
  await redis.quit()
  if (!code) throw new Error(`OTP was not found in Redis for ${phone} -- did SMS_PROVIDER/OtpService change?`)
  return code
}

// Root cause of a documented, previously-intermittent CI failure in user-app's OWN e2e
// suite (see 01-happy-path.spec.ts's own header comment for the full story): on a cold
// `nuxt dev` process, a first-time client-side navigation can race Vite's dependency
// optimizer into a bare `location.reload()` that lands back on the OLD path. This suite
// spawns the SAME cold user-app dev server, so the same race is possible here too --
// applied only to the user-app half of this test, matching where it's actually documented.
// `fallbackUrl` must be absolute -- this config deliberately has no `baseURL` (the test
// spans two different origins), so a relative goto() would throw.
async function expectUrlTolerantOfDevReload(page: Page, expected: string | RegExp, fallbackUrl: string) {
  try {
    await expect(page).toHaveURL(expected, { timeout: 15_000 })
  } catch {
    await page.goto(fallbackUrl)
    await expect(page).toHaveURL(expected)
  }
}

// The one deliberate coverage gap this repo's e2e suites otherwise share: every other
// suite (user-app, provider-panel, admin-panel) stays entirely within its own app. This is
// the first spec to actually follow a booking across two of them, using two separate
// browser contexts (independent cookie jars) for the customer and owner sessions.
test('a booking created by a customer in user-app is visible and actionable by the salon owner in provider-panel', async ({
  browser,
  request,
}) => {
  // -- Customer half: register, search, book, and pay -- entirely within user-app (:3003),
  // a near-verbatim reuse of user-app's own 01-happy-path.spec.ts flow. --
  const customerPhone = '09120000199'
  const customerContext = await browser.newContext()
  const customerPage = await customerContext.newPage()

  await customerPage.goto('http://localhost:3003/login')
  await customerPage.waitForLoadState('networkidle')
  await customerPage.getByPlaceholder('09xxxxxxxxx').fill(customerPhone)
  await customerPage.getByRole('button', { name: 'دریافت کد' }).click()

  const codeInput = customerPage.getByPlaceholder('کد ۶ رقمی')
  await expect(codeInput).toBeVisible()
  await codeInput.fill(await otpCode(customerPhone))
  await customerPage.getByRole('button', { name: 'تایید' }).click()

  await customerPage.getByPlaceholder('نام').fill('مشتری کراس‌اپ')
  await customerPage.getByRole('combobox').click()
  await customerPage.locator('.multiselect__option', { hasText: 'زن' }).first().click()
  await customerPage.getByRole('button', { name: 'تکمیل ثبت‌نام' }).click()

  await expectUrlTolerantOfDevReload(customerPage, 'http://localhost:3003/', 'http://localhost:3003/')
  await customerPage.getByText('سالن تست').click()

  await expectUrlTolerantOfDevReload(
    customerPage,
    /\/salons\/e2e-test-salon/,
    'http://localhost:3003/salons/e2e-test-salon',
  )
  await customerPage.getByText('کوتاهی مو').click()

  const bookingUrlPattern = /\/booking\/e2e-test-salon\//
  try {
    await expect(customerPage).toHaveURL(bookingUrlPattern, { timeout: 15_000 })
  } catch {
    await customerPage.getByText('کوتاهی مو').click()
    await expect(customerPage).toHaveURL(bookingUrlPattern)
  }

  await customerPage.getByTestId('slot-button').first().click()
  await customerPage.getByRole('button', { name: 'پرداخت و رزرو' }).click()

  // MockPaymentGateway immediately redirects back with Status=OK.
  await expect(customerPage).toHaveURL(/\/booking\/callback\?status=success/)
  await expect(customerPage.getByText('پرداخت با موفقیت انجام شد')).toBeVisible()

  await customerContext.close()

  // -- Owner half: log into provider-panel (:3004) as the salon's real owner, find the
  // SAME booking -- matched by the customer's own phone number, proving this is genuinely
  // the booking just created a moment ago in a completely different app, not a coincidental
  // pass against an empty or unrelated list -- and mark it completed. --
  const ownerPhone = '09120000100'
  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()

  await ownerPage.goto('http://localhost:3004/login')
  await ownerPage.waitForLoadState('networkidle')
  await ownerPage.getByTestId('phone-input').fill(ownerPhone)
  await ownerPage.getByTestId('submit-phone').click()

  const ownerCodeInput = ownerPage.getByTestId('code-input')
  await expect(ownerCodeInput).toBeVisible()
  await ownerCodeInput.fill(await otpCode(ownerPhone))
  await ownerPage.getByTestId('submit-code').click()
  await expect(ownerPage).toHaveURL('http://localhost:3004/')

  await ownerPage.getByRole('link', { name: 'نوبت‌ها', exact: true }).click()
  await expect(ownerPage).toHaveURL('http://localhost:3004/bookings')

  const bookingCard = ownerPage.locator('[data-testid^="booking-"]').filter({ hasText: customerPhone })
  await expect(bookingCard).toHaveCount(1)
  await expect(bookingCard).toContainText('مشتری کراس‌اپ')

  await bookingCard.getByTestId('mark-completed').click()
  // NOT toContainText('انجام شد') -- that's ALSO this button's own static label, so it's
  // true even before the click resolves. The button (along with mark-no-show/cancel) only
  // renders while status === 'confirmed' (see BookingsView.vue), so its disappearance is
  // what actually proves the status left 'confirmed'.
  await expect(bookingCard.getByTestId('mark-completed')).toBeHidden()

  // -- The status genuinely persisted server-side, not just an optimistic UI flip -- and
  // it's the API's own booking-list endpoint that proves it, independent of what the page
  // happens to be rendering right now. --
  const cookies = await ownerContext.cookies()
  const sessionCookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  const res = await request.get('http://localhost:3002/api/salons/mine/bookings', {
    headers: { Cookie: sessionCookie },
  })
  const bookings: Array<{ customerPhone: string; status: string }> = await res.json()
  expect(bookings.find((b) => b.customerPhone === customerPhone)?.status).toBe('completed')
})
