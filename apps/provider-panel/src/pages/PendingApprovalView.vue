<script setup lang="ts">
import { ref } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useSalon } from '@/composables/useSalon'
import { useApi } from '@/composables/useApi'

const { salon, refetch } = useSalon()
const { apiFetch } = useApi()
const submitting = ref(false)

async function resubmit() {
  submitting.value = true
  const { data } = await apiFetch('/salons/mine/resubmit', { method: 'POST' })
  submitting.value = false
  if (data) await refetch()
}
</script>

<template>
  <div v-if="salon?.status === 'rejected'" class="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
    <div class="flex h-14 w-14 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
      <AppIcon name="x" :size="26" />
    </div>
    <h1 class="text-lg font-bold text-(--color-text)">درخواست شما رد شد</h1>
    <p v-if="salon.rejectionReason" class="rounded-xl bg-(--tone-danger-bg) px-4 py-3 text-sm text-(--tone-danger-text)">
      {{ salon.rejectionReason }}
    </p>
    <RouterLink to="/settings" class="text-sm font-semibold text-(--color-accent) hover:underline">ویرایش اطلاعات آرایشگاه</RouterLink>
    <button
      data-testid="resubmit-button"
      type="button"
      :disabled="submitting"
      class="w-full rounded-xl bg-(--color-accent) py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      @click="resubmit"
    >
      {{ submitting ? 'در حال ارسال…' : 'ارسال مجدد برای بررسی' }}
    </button>
  </div>

  <div v-else class="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
    <div
      class="flex h-14 w-14 items-center justify-center rounded-full"
      :class="salon?.status === 'suspended' ? 'bg-(--tone-danger-bg) text-(--tone-danger-text)' : 'bg-(--tone-warning-bg) text-(--tone-warning-text)'"
    >
      <AppIcon :name="salon?.status === 'suspended' ? 'warning' : 'hours'" :size="26" />
    </div>
    <h1 class="text-lg font-bold text-(--color-text)">
      {{ salon?.status === 'suspended' ? 'آرایشگاه شما معلق شده است' : 'آرایشگاه شما در حال بررسی است' }}
    </h1>
    <p class="text-sm text-(--color-muted)">
      {{
        salon?.status === 'suspended'
          ? 'برای اطلاعات بیشتر با پشتیبانی تماس بگیرید.'
          : 'به محض تایید توسط تیم آرایشگاه، به شما اطلاع داده می‌شود.'
      }}
    </p>
    <button
      data-testid="refresh-status"
      type="button"
      class="rounded-xl border border-(--color-border) px-5 py-2.5 text-sm font-semibold text-(--color-text) hover:bg-(--color-border-soft)"
      @click="refetch"
    >
      بررسی وضعیت
    </button>
  </div>
</template>
