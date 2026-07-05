<script setup lang="ts">
const route = useRoute()
const status = route.query.status as string | undefined
const bookingId = route.query.bookingId as string | undefined
const { apiFetch } = useApi()

const retrying = ref(false)
const retryError = ref('')

async function retryPayment() {
  if (!bookingId) return
  retrying.value = true
  retryError.value = ''
  const { data, error } = await apiFetch<{ paymentUrl: string }>(`/bookings/${bookingId}/retry-payment`, {
    method: 'POST',
    silent: true,
  })
  retrying.value = false
  if (error || !data) {
    retryError.value = 'امکان تلاش مجدد برای این نوبت وجود ندارد'
    return
  }
  await navigateTo(data.paymentUrl, { external: true })
}
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-4 p-8 text-center">
    <template v-if="status === 'success'">
      <div class="text-4xl">✓</div>
      <h1 class="text-lg font-bold">رزرو شما با موفقیت ثبت شد</h1>
      <NuxtLink to="/bookings" class="rounded-lg bg-(--color-accent) px-4 py-2 text-white">مشاهده نوبت‌ها</NuxtLink>
    </template>
    <template v-else>
      <div class="text-4xl">✕</div>
      <h1 class="text-lg font-bold">پرداخت ناموفق بود</h1>
      <p class="text-sm">نوبت شما هنوز نگه داشته شده — می‌توانید دوباره تلاش کنید</p>
      <button
        v-if="bookingId"
        type="button"
        :disabled="retrying"
        class="rounded-lg bg-(--color-accent) px-4 py-2 text-white"
        @click="retryPayment"
      >
        {{ retrying ? 'در حال پردازش...' : 'تلاش مجدد' }}
      </button>
      <p v-if="retryError" class="text-sm text-(--color-ad)">{{ retryError }}</p>
      <NuxtLink to="/" class="text-sm underline">بازگشت به صفحه اصلی</NuxtLink>
    </template>
  </div>
</template>
