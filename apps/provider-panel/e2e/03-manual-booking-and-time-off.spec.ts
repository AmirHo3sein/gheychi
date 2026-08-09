import { test, expect, type Page } from '@playwright/test'
import Redis from 'ioredis'

// Seeded in prepare-db.cjs with an approved salon + one service ('کوتاهی مو').
const OWNER_PHONE = '09120000300'

async function loginAsOwner(page: Page) {
  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })
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

// Picks the 1st of the month currently shown, optionally navigating forward one month
// first. Always well into the future regardless of what day this suite happens to run on,
// avoiding any today/end-of-month boundary flakiness a "tomorrow" pick would risk.
//
// `navigateForward` must be false on a SECOND call against the same still-mounted page:
// JalaliDatePicker's own viewMonth/viewYear are internal component state that is NOT reset
// when the external v-model clears (only re-synced from a truthy modelValue) -- so a picker
// reopened after BookingsView.vue resets manualForm.date to '' still shows whatever month it
// was last left on. Clicking "next month" again here would silently land a further month out
// instead of repeating the same date, which is exactly what the double-booking scenario below
// needs to be able to do on purpose (submit the identical slot twice).
async function pickFirstDayOfMonth(page: Page, trigger: ReturnType<Page['getByTestId']>, navigateForward: boolean) {
  await trigger.click()
  const popover = page.getByTestId('date-popover')
  if (navigateForward) await popover.getByLabel('ماه بعد').click()
  await popover.locator('button', { hasText: /^۱$/ }).first().click()
}

// One shared login for every scenario below -- OtpService rate-limits to 3 requests/phone/
// hour, and 02-bookings-status.spec.ts already spends one of those on this same seeded
// owner phone within the same suite run.
test('manual bookings, double-booking prevention, and per-worker time off', async ({ page }) => {
  await loginAsOwner(page)

  // -- Manual/offline booking, shown with identity + a manual-entry badge --
  await page.goto('/bookings')
  await page.waitForLoadState('networkidle')

  const walkInPhone = '09120000305'
  await page.getByTestId('manual-booking-phone').fill(walkInPhone)
  await page.getByTestId('manual-booking-name').fill('مشتری واک‌این')
  // AppSelect wraps vue-multiselect (same idiom as 01-onboarding.spec.ts): open it, then
  // click the option -- the seeded salon has exactly one service.
  await page.getByTestId('manual-booking-service').click()
  await page.locator('.multiselect__option').first().click()
  await pickFirstDayOfMonth(page, page.getByTestId('manual-booking-date'), true)
  await page.getByTestId('manual-booking-time').fill('14:00')
  await page.getByTestId('submit-manual-booking').click()

  await expect(page.getByText('نوبت با موفقیت ثبت شد')).toBeVisible()
  const card = page.locator('[data-testid^="booking-"]').filter({ hasText: walkInPhone })
  await expect(card).toBeVisible()
  await expect(card.getByText('ثبت دستی')).toBeVisible()
  await expect(card.getByText('مشتری واک‌این')).toBeVisible()

  // -- A second manual booking for the exact same slot is a genuine conflict, not a
  // silent double-book (the seeded salon's capacity defaults to 1) --
  await page.getByTestId('manual-booking-phone').fill('09120000308')
  await page.getByTestId('manual-booking-service').click()
  await page.locator('.multiselect__option').first().click()
  // navigateForward: false -- see pickFirstDayOfMonth's own comment. The picker is still
  // showing "next month" from the pick above (manualForm.date reset to '' does not reset
  // JalaliDatePicker's own view state), so this repeats the identical slot on purpose.
  await pickFirstDayOfMonth(page, page.getByTestId('manual-booking-date'), false)
  await page.getByTestId('manual-booking-time').fill('14:00')
  await page.getByTestId('submit-manual-booking').click()

  await expect(page.getByText('این زمان قبلا پر شده است')).toBeVisible()
  await expect(page.locator('[data-testid^="booking-"]').filter({ hasText: '09120000308' })).toHaveCount(0)

  // -- Per-worker time off: add a worker, mark them off a day, list/remove it --
  await page.goto('/team')
  await page.waitForLoadState('networkidle')
  await page.locator('input[placeholder="نام"]').fill('کارمند تست')
  await page.locator('input[placeholder="شماره موبایل"]').fill('09120000306')
  await page.getByTestId('submit-add-worker').click()
  await expect(page.getByText('کارمند تست')).toBeVisible()

  // Exactly one worker card exists at this point, so the dynamic per-worker testids
  // (`worker-off-date-${id}`, `add-worker-off-${id}`) can be matched by prefix without
  // knowing the server-generated worker id. Fresh page (navigated to /team above), so this
  // JalaliDatePicker's view state starts at today's month regardless of the bookings-page
  // picker's state above -- navigateForward: true is correct here.
  await pickFirstDayOfMonth(page, page.locator('[data-testid^="worker-off-date-"]'), true)
  await page.locator('[data-testid^="add-worker-off-"]').click()

  // The off-day <li> testid is keyed by exception id (`worker-off-${e.id}`), which shares
  // the "worker-off-" prefix with the date-picker's own testid -- scoping to <ul><li>
  // disambiguates the two instead of relying on string matching alone.
  const offDayItem = page.locator('ul li[data-testid^="worker-off-"]')
  await expect(offDayItem).toHaveCount(1)
  await expect(page.getByText('این عضو مرخصی ثبت‌شده‌ای ندارد.')).not.toBeVisible()

  page.on('dialog', (dialog) => dialog.accept())
  await page.locator('li [data-testid^="remove-worker-off-"]').click()

  await expect(offDayItem).toHaveCount(0)
  await expect(page.getByText('این عضو مرخصی ثبت‌شده‌ای ندارد.')).toBeVisible()
})
