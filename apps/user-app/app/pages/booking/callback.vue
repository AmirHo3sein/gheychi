<script setup lang="ts">
definePageMeta({ layout: 'bare' })

const route = useRoute()
const status = route.query.status as string | undefined
const bookingId = route.query.bookingId as string | undefined
const success = status === 'success'

useSeoMeta({
  title: success ? 'پرداخت موفق — آرایشگاه' : 'پرداخت ناموفق — آرایشگاه',
})
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-6">
    <BaseCard padding="lg" class="w-full max-w-sm space-y-4 text-center">
      <div
        class="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
        :class="success ? 'bg-(--color-success)/10 text-(--color-success)' : 'bg-(--color-danger-soft) text-(--color-danger)'"
      >
        <BaseIcon :name="success ? 'check-circle' : 'alert-circle'" :size="32" />
      </div>

      <div class="space-y-1">
        <h1 data-testid="callback-title" class="text-lg font-bold text-(--color-text)">
          {{ success ? 'پرداخت با موفقیت انجام شد' : 'پرداخت ناموفق بود' }}
        </h1>
        <p class="text-sm text-(--color-text-muted)">
          {{
            success
              ? 'نوبت شما با دریافت پیش‌پرداخت ثبت شد.'
              : 'پرداخت انجام نشد یا لغو شد؛ نوبتی برای شما رزرو نشده است.'
          }}
        </p>
      </div>

      <div class="space-y-2 pt-1">
        <NuxtLink v-if="bookingId" :to="`/bookings/${bookingId}`" custom v-slot="{ navigate }">
          <BaseButton block data-testid="view-booking-button" @click="navigate">
            مشاهده جزئیات نوبت
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
