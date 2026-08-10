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

// Same idiom as 03-manual-booking-and-time-off.spec.ts's own helper of the same name --
// picks the 1st of the month currently shown, optionally navigating forward one month first,
// always well into the future regardless of what day this suite happens to run on.
async function pickFirstDayOfMonth(page: Page, trigger: ReturnType<Page['getByTestId']>, navigateForward: boolean) {
  await trigger.click()
  const popover = page.getByTestId('date-popover')
  if (navigateForward) await popover.getByLabel('ماه بعد').click()
  await popover.locator('button', { hasText: /^۱$/ }).first().click()
}

// This is the THIRD OTP request against OWNER_PHONE within this suite run
// (01/02-bookings-status.spec.ts and 03-manual-booking-and-time-off.spec.ts already spend the
// first two of OtpService's 3/hour cap on this exact phone) -- right at the limit, not over it,
// and Playwright's workers: 1 config guarantees these spec files never race each other for it.
//
// This spec fills a real gap: 01-onboarding.spec.ts only ever exercises the onboarding
// wizard's mini FirstServiceStep/ScheduleStep components on a BRAND NEW salon, and no other
// spec ever touches ServicesView.vue or HoursView.vue -- the actual post-onboarding pages an
// approved owner uses to manage services and working hours day to day -- at all.
test('services and hours management: edit/add/deactivate a service, weekly hours, and a schedule exception', async ({ page }) => {
  // Accept every window.confirm() this flow triggers (a price change, deactivating a service,
  // removing a schedule exception) -- Playwright auto-dismisses an unhandled dialog, which
  // reads as "cancelled" and would silently no-op each of those actions.
  page.on('dialog', (dialog) => dialog.accept())

  await loginAsOwner(page)

  // -- Services: edit the seeded service's price, add a new one, then deactivate it --
  await page.goto('/services')
  await page.waitForLoadState('networkidle')

  const seededServiceCard = page.locator('[data-testid^="service-card-"]').filter({ hasText: 'کوتاهی مو' })
  await expect(seededServiceCard).toBeVisible()
  await seededServiceCard.getByTestId('service-price-input').fill('350000')
  await seededServiceCard.getByTestId('service-price-input').dispatchEvent('change')
  await expect(page.getByText('قیمت به‌روزرسانی شد')).toBeVisible()

  // Persisted, not just an optimistic toast -- reload and confirm the new price survived.
  // AppMoneyInput displays fa-IR-grouped Farsi digits (formatToman), not the raw ASCII the
  // field was filled with -- '350000' renders back as '۳۵۰٬۰۰۰'.
  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(page.locator('[data-testid^="service-card-"]').filter({ hasText: 'کوتاهی مو' }).getByTestId('service-price-input'))
    .toHaveValue('۳۵۰٬۰۰۰')

  await page.getByTestId('new-service-category').click()
  await page.locator('.multiselect__option').first().click()
  // AppInput with no data-testid -- same placeholder-based fallback TeamView's add-worker
  // form already uses (03-manual-booking-and-time-off.spec.ts's own worker-name locator).
  await page.locator('input[placeholder="نام خدمت"]').fill('رنگ مو')
  await page.getByTestId('new-service-price-input').fill('500000')
  // AppInput labeled (not placeholder'd) and carries no testid -- matches by its <label for>.
  await page.getByLabel('مدت زمان (دقیقه)').fill('60')
  await page.getByTestId('add-service').click()

  const newServiceCard = page.locator('[data-testid^="service-card-"]').filter({ hasText: 'رنگ مو' })
  await expect(newServiceCard).toBeVisible()
  // The originally-seeded service is untouched by adding a second one.
  await expect(seededServiceCard).toBeVisible()

  await newServiceCard.getByTestId('deactivate-service').click()
  await expect(newServiceCard).not.toBeVisible()
  await expect(seededServiceCard).toBeVisible()

  // -- Weekly hours: this approved salon starts with none set (unlike 01-onboarding.spec.ts's
  // brand-new salon, which sets its very first day through the wizard, not this page) --
  await page.goto('/hours')
  await page.waitForLoadState('networkidle')

  await page.locator('[data-testid="day-0"] input[type=checkbox]').check()
  await page.getByTestId('save-hours').click()
  await expect(page.getByText('ساعات کاری ذخیره شد')).toBeVisible()

  // Persisted, not just an optimistic toast -- reload and confirm the day survived.
  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(page.locator('[data-testid="day-0"] input[type=checkbox]')).toBeChecked()

  // -- Schedule exception (a whole-salon closure): HoursView's second, independent feature,
  // untouched by every other spec in this suite --
  await expect(page.getByText('تعطیلی موردی ثبت نشده است.')).toBeVisible()

  await pickFirstDayOfMonth(page, page.getByTestId('exception-date'), true)
  await page.getByTestId('exception-reason').fill('تعمیرات فروشگاه')
  await page.getByTestId('add-exception').click()

  await expect(page.getByText('تعطیلی موردی ثبت نشده است.')).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'حذف تعطیلی' })).toHaveCount(1)

  await page.getByRole('button', { name: 'حذف تعطیلی' }).click()
  await expect(page.getByText('تعطیلی موردی ثبت نشده است.')).toBeVisible()
})
