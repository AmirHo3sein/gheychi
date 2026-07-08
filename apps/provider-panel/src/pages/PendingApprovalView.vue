<script setup lang="ts">
import { useSalon } from '@/composables/useSalon'
import { useApi } from '@/composables/useApi'

const { salon, refetch } = useSalon()
const { apiFetch } = useApi()

async function resubmit() {
  const { data } = await apiFetch('/salons/mine/resubmit', { method: 'POST' })
  if (data) await refetch()
}
</script>

<template>
  <div
    v-if="salon?.status === 'rejected'"
    class="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 p-6 text-center"
  >
    <h1 class="text-xl font-bold">درخواست شما رد شد</h1>
    <p v-if="salon.rejectionReason" class="text-sm text-red-600">{{ salon.rejectionReason }}</p>
    <RouterLink to="/settings" class="text-sm text-(--color-accent)">ویرایش اطلاعات آرایشگاه</RouterLink>
    <button data-testid="resubmit-button" type="button" class="rounded-lg border px-4 py-2" @click="resubmit">
      ارسال مجدد برای بررسی
    </button>
  </div>
  <div v-else class="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
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
