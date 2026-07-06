<script setup lang="ts">
definePageMeta({ layout: 'bare' })

const route = useRoute()
const status = route.query.status as string | undefined
const bookingId = route.query.bookingId as string | undefined
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-6 text-center">
    <div class="max-w-sm space-y-3">
      <p v-if="status === 'success'" class="text-lg font-bold">پرداخت با موفقیت انجام شد ✅</p>
      <p v-else class="text-lg font-bold">پرداخت ناموفق بود ❌</p>
      <NuxtLink
        v-if="bookingId"
        :to="`/bookings/${bookingId}`"
        class="block rounded-lg bg-(--color-accent) text-white p-3 font-semibold"
      >
        مشاهده جزئیات نوبت
      </NuxtLink>
      <NuxtLink to="/bookings" class="block text-sm">نوبت‌های من</NuxtLink>
    </div>
  </div>
</template>
