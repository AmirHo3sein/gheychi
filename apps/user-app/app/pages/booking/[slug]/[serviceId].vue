<script setup lang="ts">
interface Salon { id: string; name: string; address: string }
interface SalonServiceItem { id: string; name: string; price: number; durationMin: number }
interface BookingTerms { depositPercent: number; depositMinToman: number; cancellationWindowHours: number }

const route = useRoute()
const slug = route.params.slug as string
const serviceId = route.params.serviceId as string
const { apiFetch } = useApi()

const { data: page } = await useAsyncData(`booking-${slug}-${serviceId}`, async () => {
  const [salonRes, servicesRes, termsRes] = await Promise.all([
    apiFetch<Salon>(`/salons/${slug}`, { silent: true }),
    apiFetch<SalonServiceItem[]>(`/salons/${slug}/services`, { silent: true }),
    apiFetch<BookingTerms>('/platform-config/booking-terms', { silent: true }),
  ])
  const service = servicesRes.data?.find((s) => s.id === serviceId)
  if (!salonRes.data || !service) return null
  return { salon: salonRes.data, service, terms: termsRes.data }
})

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Service not found' })
}

const selectedSlot = ref<string | null>(null)
const submitting = ref(false)
const submitError = ref('')

// Mirrors calculateDeposit() in apps/api/src/booking/deposit.util.ts -- this is a
// display-only pre-submit estimate; the backend recomputes the real deposit from its
// own platform-config values at submission time and is the sole source of truth, so a
// mismatch here is a UX/trust issue, not a financial one. Keep in sync with that file.
const estimatedDeposit = computed(() => {
  if (!page.value?.terms) return null
  const pct = Math.round((page.value.service.price * page.value.terms.depositPercent) / 100)
  return Math.max(pct, page.value.terms.depositMinToman)
})

async function confirmBooking() {
  if (!selectedSlot.value) return
  submitting.value = true
  submitError.value = ''
  const { data, error } = await apiFetch<{ booking: { id: string }; paymentUrl: string }>('/bookings', {
    method: 'POST',
    body: { salonId: page.value!.salon.id, serviceId, startsAt: selectedSlot.value },
    silent: true,
  })
  submitting.value = false
  if (error || !data) {
    // A 401 here means the session expired mid-booking -- useApi's global handler has
    // already kicked off a redirect to /login, so there's nothing left to show; setting
    // a local error message would just flash "an error occurred" right as the user is
    // being navigated away.
    if (error?.status === 401) return
    submitError.value = error?.status === 409 ? 'این نوبت همین الان رزرو شد، لطفا زمان دیگری را انتخاب کنید' : 'خطایی رخ داد'
    selectedSlot.value = null
    return
  }
  await navigateTo(data.paymentUrl, { external: true })
}
</script>

<template>
  <!-- Top-level guard, not just the `page!` assertions below: when the createError(404) throw
       above rejects this component's async setup, Vue's Suspense still runs one render pass of
       this template with `page` at its pre-fetch value (undefined) before the rejection is
       handled. Without this v-if, that pass throws inside the render function itself (an
       unhandled rejection, not the createError) -- see blog/[slug].vue, which this mirrors. -->
  <div v-if="page" class="p-4 space-y-4">
    <div>
      <h1 class="text-lg font-bold">{{ page.service.name }}</h1>
      <p class="text-sm">{{ page.salon.name }} — {{ page.salon.address }}</p>
    </div>

    <SlotPicker :salon-id="page.salon.id" :service-id="serviceId" @select="selectedSlot = $event" />

    <div v-if="selectedSlot" class="rounded-xl bg-(--color-surface-card) p-4 space-y-2 text-sm">
      <p>قیمت کامل: {{ page.service.price.toLocaleString('fa-IR') }} تومان</p>
      <p v-if="estimatedDeposit !== null">پیش‌پرداخت آنلاین: {{ estimatedDeposit.toLocaleString('fa-IR') }} تومان</p>
      <p v-if="page.terms">لغو رایگان تا {{ page.terms.cancellationWindowHours }} ساعت قبل از نوبت</p>
      <button
        type="button"
        data-testid="confirm-booking-button"
        :disabled="submitting"
        class="w-full rounded-lg bg-(--color-accent) p-3 font-semibold text-white"
        @click="confirmBooking"
      >
        {{ submitting ? 'در حال پردازش...' : 'پرداخت و رزرو' }}
      </button>
    </div>

    <!-- Deliberately outside the `selectedSlot` block above: confirmBooking() resets
    selectedSlot to null in the same branch that sets this message (e.g. on a 409), so
    nesting it inside that v-if would make the error disappear the instant it's set. -->
    <p v-if="submitError" class="text-(--color-ad) text-sm">{{ submitError }}</p>
  </div>
</template>
