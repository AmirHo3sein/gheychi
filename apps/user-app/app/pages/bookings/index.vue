<script setup lang="ts">
interface BookingItem {
  id: string
  salonName: string
  serviceName: string
  workerName: string | null
  startsAt: string
  priceSnapshot: number
  status: 'pending_payment' | 'confirmed' | 'completed' | 'cancelled_by_user' | 'cancelled_by_salon' | 'expired' | 'no_show'
}

const { apiFetch } = useApi()
const bookings = ref<BookingItem[]>([])
const loading = ref(true)
const reviewingBooking = ref<BookingItem | null>(null)

const STATUS_LABELS: Record<BookingItem['status'], string> = {
  pending_payment: 'در انتظار پرداخت',
  confirmed: 'تایید شده',
  completed: 'انجام شده',
  cancelled_by_user: 'لغو شده توسط شما',
  cancelled_by_salon: 'لغو شده توسط سالن',
  expired: 'منقضی شده',
  no_show: 'عدم مراجعه',
}

async function load() {
  loading.value = true
  const { data } = await apiFetch<BookingItem[]>('/bookings/mine', { silent: true })
  bookings.value = data ?? []
  loading.value = false
}

onMounted(load)

async function retryPayment(id: string) {
  const { data } = await apiFetch<{ paymentUrl: string }>(`/bookings/${id}/retry-payment`, { method: 'POST' })
  if (data) await navigateTo(data.paymentUrl, { external: true })
}

async function cancelBooking(id: string) {
  if (!confirm('این نوبت لغو شود؟')) return
  const { error } = await apiFetch(`/bookings/${id}/cancel`, { method: 'POST' })
  if (!error) load()
}
</script>

<template>
  <div class="p-4 space-y-3">
    <h1 class="text-lg font-bold">نوبت‌های من</h1>
    <p v-if="loading" class="text-sm text-center">در حال بارگذاری...</p>
    <p v-else-if="!bookings.length" class="text-sm text-center">نوبتی ثبت نشده است</p>

    <div v-for="booking in bookings" :key="booking.id" class="rounded-xl bg-(--color-surface-card) p-3 text-sm space-y-1">
      <p class="font-bold">{{ booking.salonName }} — {{ booking.serviceName }}</p>
      <p>{{ new Date(booking.startsAt).toLocaleString('fa-IR') }}</p>
      <p>{{ STATUS_LABELS[booking.status] }}</p>

      <div v-if="booking.status === 'pending_payment'" class="rounded-lg bg-(--color-ad)/10 p-2 flex items-center justify-between">
        <span>پرداخت این نوبت کامل نشده است</span>
        <button type="button" class="rounded-lg bg-(--color-accent) text-white px-3 py-1" @click="retryPayment(booking.id)">تکمیل پرداخت</button>
      </div>

      <button
        v-if="['pending_payment', 'confirmed'].includes(booking.status)"
        type="button"
        class="text-(--color-ad)"
        @click="cancelBooking(booking.id)"
      >
        لغو نوبت
      </button>

      <button
        v-if="booking.status === 'completed'"
        type="button"
        class="text-(--color-accent)"
        @click="reviewingBooking = booking"
      >
        ثبت نظر
      </button>
    </div>

    <ReviewPromptModal
      v-if="reviewingBooking"
      :booking-id="reviewingBooking.id"
      :worker-name="reviewingBooking.workerName"
      @close="reviewingBooking = null"
    />
  </div>
</template>
