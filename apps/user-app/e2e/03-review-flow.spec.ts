import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import Redis from 'ioredis'

// Covers the one funnel segment 01-happy-path.spec.ts stops short of: a COMPLETED
// booking going through the review flow (rating + comment + worker rating) and
// rendering back correctly. 01-happy-path only ever produces a 'confirmed' booking
// (the mock gateway's callback lands there, never 'completed' -- nothing in this app
// advances a booking to 'completed', that's presumably an ops/cron concern outside
// this suite's control), so there is no way to reach this screen through real user
// actions alone. Same trick as 02-admin-featured-badge.spec.ts's direct `salons`
// UPDATE: reach into Postgres to create the precondition state a real flow can't
// produce here, then drive everything from that point on through real UI interaction.
//
// Depends on 01-happy-path.spec.ts having already run in this worker (workers: 1
// forces file-by-file serial execution, same ordering dependency
// 02-admin-featured-badge.spec.ts already relies on): the customer phone below is
// already an onboarded user (name + gender set) by the time this file runs, so
// verify-otp below lands straight on '/' with no 'profile' step -- see login.vue's
// `if (!data.user.name || !data.user.gender) step.value = 'profile'` branch.
test('completed booking -> submit review with rating, comment, and worker rating -> renders back', async ({ page }) => {
  const phone = '09120000200' // the customer from happy-path.spec.ts, already onboarded

  const client = new Client({
    host: process.env.DB_HOST ?? 'localhost', port: Number(process.env.DB_PORT ?? 5544),
    user: process.env.DB_USER ?? 'gheychi', password: process.env.DB_PASS ?? 'gheychi',
    // Must match prepare-db.cjs's own default -- that's the database the webServer-spawned
    // API this test drives is actually connected to.
    database: process.env.DB_NAME ?? 'gheychi_e2e',
  })
  await client.connect()

  const { rows: [{ id: customerId }] } = await client.query(
    `SELECT id FROM users WHERE phone = $1`, [phone],
  )
  const { rows: [{ id: salonId }] } = await client.query(
    `SELECT id FROM salons WHERE slug = 'e2e-test-salon'`,
  )
  const { rows: [{ id: serviceId }] } = await client.query(
    `SELECT id FROM salon_services WHERE salon_id = $1 LIMIT 1`, [salonId],
  )
  // A worker needs a real backing User (workers.user_id REFERENCES users(id), see
  // 1753000000000-workers-and-worker-ratings.ts) -- a fresh one, distinct from the
  // salon owner and the customer, standing in for a staff member.
  const { rows: [{ id: workerUserId }] } = await client.query(
    `INSERT INTO users (phone, role) VALUES ('09120000301', 'provider') RETURNING id`,
  )
  const workerName = 'کارمند تست'
  const { rows: [{ id: workerId }] } = await client.query(
    `INSERT INTO workers (salon_id, user_id, name) VALUES ($1, $2, $3) RETURNING id`,
    [salonId, workerUserId, workerName],
  )
  // Inserted directly as 'completed' with worker_id set -- ReviewsService.create requires
  // exactly this combination (status === 'completed', and a workerRating iff booking.workerId
  // is set) for the review to be accepted at all.
  await client.query(
    `INSERT INTO bookings (user_id, salon_id, service_id, worker_id, starts_at, ends_at, price_snapshot, deposit_amount, status)
     VALUES ($1, $2, $3, $4, now() - interval '2 days', now() - interval '2 days' + interval '30 minutes', 300000, 300000, 'completed')`,
    [customerId, salonId, serviceId, workerId],
  )
  await client.end()

  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })

  await page.goto('/login')
  // See the matching comment in 01-happy-path.spec.ts: on a cold dev server, a click can
  // land before Vue hydration attaches the form handler, falling through to a native
  // (non-JS) form submit. Give hydration's module fetches a chance to settle first.
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

  await expect(page).toHaveURL('/')
  await page.goto('/bookings')

  // Scoped to the specific card for the booking just inserted (status badge text), not
  // just "the first card" -- 01-happy-path.spec.ts's own booking (status 'confirmed')
  // for the same customer/salon/service is also present in this list.
  const completedCard = page.getByTestId('booking-card').filter({ hasText: 'انجام شده' })
  await expect(completedCard).toBeVisible()
  await completedCard.getByTestId('review-booking-button').click()

  // Rate the salon 4/5 and the worker 5/5 -- distinct values so the assertions below
  // can't accidentally pass by comparing the same number against itself.
  const salonStars = page.getByTestId('salon-rating-stars').getByRole('button')
  await salonStars.nth(3).click() // 4th star -> rating 4
  await expect(page.getByText(`امتیاز به ${workerName}`)).toBeVisible()
  const workerStars = page.getByTestId('worker-rating-stars').getByRole('button')
  await workerStars.nth(4).click() // 5th star -> rating 5

  const comment = 'تجربه خیلی خوبی بود، ممنون از تیم سالن'
  await page.getByPlaceholder('نظر شما (اختیاری)').fill(comment)
  await page.getByTestId('submit-review-button').click()

  // Renders back into the 'view' phase: submitted rating/comment/worker rating read
  // back correctly, not just "a success toast appeared".
  await expect(page.getByText('نظر شما ثبت شد')).toBeVisible()
  await expect(page.getByTestId('view-salon-rating-stars')).toBeVisible()
  await expect(page.getByTestId('view-worker-rating-stars')).toBeVisible()
  await expect(page.getByText(comment)).toBeVisible()

  // Reload from a cold GET /reviews/mine (not just the in-memory modal state) to confirm
  // the review was actually persisted, not merely reflected optimistically client-side.
  await page.getByRole('button', { name: 'بستن' }).click()
  await page.reload()
  await expect(completedCard.getByTestId('review-booking-button')).toHaveText('ویرایش نظر')
})
