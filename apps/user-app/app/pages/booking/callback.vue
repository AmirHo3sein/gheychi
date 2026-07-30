<script setup lang="ts">
definePageMeta({ layout: 'bare' })

const route = useRoute()
const status = route.query.status as string | undefined
const bookingId = route.query.bookingId as string | undefined

/**
 * Zarinpal returns the customer to the API (GET /api/payments/callback), which resolves what
 * actually happened and redirects here with a `status`. There are THREE outcomes, not two --
 * the third is the late-capture case: the deposit really was captured, but the booking had
 * already left pending_payment (hold expired, or cancelled), so it can never be resurrected
 * into a released slot and PaymentsService queues a real refund instead.
 *
 * That customer used to land on the plain failure page, i.e. was told "no payment happened
 * and nothing was reserved" while their money was gone -- the single message most likely to
 * make someone either phone support or pay a second time. It gets its own state, using the
 * same vocabulary bookings/[id].vue uses for refundStatus: 'pending' ("بازگشت وجه در حال
 * انجام است"), so the two screens read as one story.
 *
 * `status=refunding` is the literal PaymentsController emits for it; anything unrecognised
 * still falls back to the failure state, so a refund is only ever claimed when the API says
 * so.
 */
type Outcome = 'success' | 'refunding' | 'failed'
const outcome: Outcome = status === 'success' ? 'success' : status === 'refunding' ? 'refunding' : 'failed'

const COPY: Record<Outcome, {
  seoTitle: string
  title: string
  body: string
  icon: 'check-circle' | 'clock' | 'alert-circle'
  badgeClass: string
  bookingLinkLabel: string
}> = {
  success: {
    seoTitle: 'پرداخت موفق — قیچی',
    title: 'پرداخت با موفقیت انجام شد',
    body: 'نوبت شما با دریافت پیش‌پرداخت ثبت شد.',
    icon: 'check-circle',
    badgeClass: 'bg-(--color-success)/10 text-(--color-success)',
    bookingLinkLabel: 'مشاهده جزئیات نوبت',
  },
  // Neutral, not danger: the money is accounted for and the fix is already running, so this
  // is an in-progress fact rather than an error the customer has to act on -- same
  // muted/clock treatment as the refund-pending card on the booking detail page.
  refunding: {
    seoTitle: 'بازگشت وجه در حال انجام — قیچی',
    title: 'پرداخت شما دریافت شد، اما نوبت ثبت نشد',
    body: 'پیش‌پرداخت شما دریافت شد، ولی این نوبت پیش از تکمیل پرداخت آزاد شده بود و قابل ثبت نیست. بازگشت وجه به‌صورت خودکار در حال انجام است و نیازی به اقدام شما نیست.',
    icon: 'clock',
    badgeClass: 'bg-(--color-surface-subtle) text-(--color-text-muted)',
    bookingLinkLabel: 'پیگیری بازگشت وجه',
  },
  failed: {
    seoTitle: 'پرداخت ناموفق — قیچی',
    title: 'پرداخت ناموفق بود',
    body: 'پرداخت انجام نشد یا لغو شد؛ نوبتی برای شما رزرو نشده است.',
    icon: 'alert-circle',
    badgeClass: 'bg-(--color-danger-soft) text-(--color-danger)',
    bookingLinkLabel: 'مشاهده جزئیات نوبت',
  },
}

const view = COPY[outcome]

useSeoMeta({ title: view.seoTitle })
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-6">
    <BaseCard padding="lg" class="w-full max-w-sm space-y-4 text-center">
      <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full" :class="view.badgeClass">
        <BaseIcon :name="view.icon" :size="32" />
      </div>

      <div class="space-y-1">
        <h1 data-testid="callback-title" class="text-lg font-bold text-(--color-text)">
          {{ view.title }}
        </h1>
        <p class="text-sm text-(--color-text-muted)">
          {{ view.body }}
        </p>
      </div>

      <div class="space-y-2 pt-1">
        <NuxtLink v-if="bookingId" :to="`/bookings/${bookingId}`" custom v-slot="{ navigate }">
          <BaseButton block data-testid="view-booking-button" @click="navigate">
            {{ view.bookingLinkLabel }}
          </BaseButton>
        </NuxtLink>
        <NuxtLink to="/bookings" custom v-slot="{ navigate }">
          <BaseButton variant="secondary" block data-testid="my-bookings-button" @click="navigate">
            نوبت‌های من
          </BaseButton>
        </NuxtLink>
      </div>
    </BaseCard>
  </div>
</template>
