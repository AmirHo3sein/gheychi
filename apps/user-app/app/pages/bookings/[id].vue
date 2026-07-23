<script setup lang="ts">
interface BookingDetail {
  id: string
  salonName: string
  serviceName: string
  workerName: string | null
  startsAt: string
  priceSnapshot: number
  depositAmount: number
  status: string
  refundStatus: 'pending' | 'done' | null
}

const route = useRoute()
const { apiFetch } = useApi()

const { data: booking } = await useAsyncData(`booking-detail-${route.params.id}`, async () => {
  const { data } = await apiFetch<BookingDetail>(`/bookings/${route.params.id}`, { silent: true })
  return data
})

if (!booking.value) {
  throw createError({ statusCode: 404, statusMessage: 'Booking not found' })
}
</script>

<template>
  <div class="p-4 space-y-2 text-sm">
    <h1 class="text-lg font-bold">{{ booking!.salonName }}</h1>
    <p>{{ booking!.serviceName }}</p>
    <p v-if="booking!.workerName">کارمند: {{ booking!.workerName }}</p>
    <p>{{ new Date(booking!.startsAt).toLocaleString('fa-IR') }}</p>
    <p>مبلغ کل: {{ booking!.priceSnapshot.toLocaleString('fa-IR') }} تومان</p>
    <p>پیش‌پرداخت: {{ booking!.depositAmount.toLocaleString('fa-IR') }} تومان</p>
    <p v-if="booking!.refundStatus === 'pending'" class="text-(--color-accent)">بازگشت وجه در حال انجام است</p>
    <p v-else-if="booking!.refundStatus === 'done'" class="text-(--color-accent)">وجه بازگردانده شد</p>
    <NuxtLink to="/bookings" class="block text-(--color-accent)">بازگشت به نوبت‌های من</NuxtLink>
  </div>
</template>
