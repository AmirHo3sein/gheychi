<script setup lang="ts">
import { useSalon } from '@/composables/useSalon'

const { salon, refetch } = useSalon()
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
    <h1 class="text-xl font-bold">
      {{ salon?.status === 'suspended' ? 'آرایشگاه شما معلق شده است' : 'آرایشگاه شما در حال بررسی است' }}
    </h1>
    <p class="text-sm">
      {{
        salon?.status === 'suspended'
          ? 'برای اطلاعات بیشتر با پشتیبانی تماس بگیرید.'
          : 'به محض تایید توسط تیم آرایشگاه، به شما اطلاع داده می‌شود.'
      }}
    </p>
    <button data-testid="refresh-status" type="button" class="rounded-lg border px-4 py-2" @click="refetch">
      بررسی وضعیت
    </button>
  </div>
</template>
