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
    submitError.value = error?.status === 409 ? 'این نوبت همین الان رزرو شد، لطفا زمان دیگری را انتخاب کنید' : 'خطایی رخ داد'
    selectedSlot.value = null
    return
  }
  await navigateTo(data.paymentUrl, { external: true })
}
</script>

<template>
  <div class="p-4 space-y-4">
    <div>
      <h1 class="text-lg font-bold">{{ page!.service.name }}</h1>
      <p class="text-sm">{{ page!.salon.name }} — {{ page!.salon.address }}</p>
    </div>

    <SlotPicker :salon-id="page!.salon.id" :service-id="serviceId" @select="selectedSlot = $event" />

    <div v-if="selectedSlot" class="rounded-xl bg-(--color-surface-card) p-4 space-y-2 text-sm">
      <p>قیمت کامل: {{ page!.service.price.toLocaleString('fa-IR') }} تومان</p>
      <p v-if="estimatedDeposit">پیش‌پرداخت آنلاین: {{ estimatedDeposit.toLocaleString('fa-IR') }} تومان</p>
      <p v-if="page!.terms">لغو رایگان تا {{ page!.terms.cancellationWindowHours }} ساعت قبل از نوبت</p>
      <button
        type="button"
        :disabled="submitting"
        class="w-full rounded-lg bg-(--color-accent) p-3 font-semibold text-white"
        @click="confirmBooking"
      >
        {{ submitting ? 'در حال پردازش...' : 'پرداخت و رزرو' }}
      </button>
      <p v-if="submitError" class="text-(--color-ad)">{{ submitError }}</p>
    </div>
  </div>
</template>
