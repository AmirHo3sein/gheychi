<script setup lang="ts">
import { ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useSalon } from '@/composables/useSalon'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'

const { salon, refetch } = useSalon()
const { apiFetch } = useApi()
const { push: pushToast } = useToast()
const submitting = ref(false)
const refreshing = ref(false)

async function resubmit() {
  submitting.value = true
  const { data } = await apiFetch('/salons/mine/resubmit', { method: 'POST' })
  submitting.value = false
  if (data) await refetch()
}

async function checkStatus() {
  refreshing.value = true
  const { error } = await refetch()
  refreshing.value = false
  if (error) pushToast('بررسی وضعیت با خطا مواجه شد. دوباره تلاش کنید.')
}
</script>

<template>
  <div v-if="salon?.status === 'rejected'" class="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 p-4 text-center sm:p-6">
    <div class="flex h-14 w-14 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
      <AppIcon name="x" :size="26" />
    </div>
    <h1 class="text-lg font-bold text-(--color-text)">درخواست شما رد شد</h1>
    <!-- break-words: an admin-authored rejection reason is arbitrary text and may contain an
         unbreakable run; it must wrap inside this max-w-sm column, never widen the page. -->
    <p v-if="salon.rejectionReason" class="w-full break-words rounded-xl bg-(--tone-danger-bg) px-4 py-3 text-sm text-(--tone-danger-text)">
      {{ salon.rejectionReason }}
    </p>
    <RouterLink to="/settings" class="text-sm font-semibold text-(--color-accent-text) hover:underline">ویرایش اطلاعات آرایشگاه</RouterLink>
    <AppButton data-testid="resubmit-button" type="button" block :disabled="submitting" :loading="submitting" @click="resubmit">
      {{ submitting ? 'در حال ارسال…' : 'ارسال مجدد برای بررسی' }}
    </AppButton>
  </div>

  <div v-else class="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 p-4 text-center sm:p-6">
    <div
      class="flex h-14 w-14 items-center justify-center rounded-full"
      :class="salon?.status === 'suspended' ? 'bg-(--tone-danger-bg) text-(--tone-danger-text)' : 'bg-(--tone-warning-bg) text-(--tone-warning-text)'"
    >
      <AppIcon :name="salon?.status === 'suspended' ? 'warning' : 'hours'" :size="26" />
    </div>
    <h1 class="text-lg font-bold text-(--color-text)">
      {{ salon?.status === 'suspended' ? 'آرایشگاه شما معلق شده است' : 'آرایشگاه شما در حال بررسی است' }}
    </h1>
    <p class="text-sm text-(--color-text-muted)">
      {{
        salon?.status === 'suspended'
          ? 'برای اطلاعات بیشتر با پشتیبانی تماس بگیرید.'
          : 'به محض تایید توسط تیم آرایشگاه، به شما اطلاع داده می‌شود.'
      }}
    </p>
    <!-- The onboarding wizard creates the salon before it saves the hours and the first
         service, so a failure on either leaves a pending salon with those missing and no
         way back into the wizard after a reload. These two links are the only entry point
         to fix that -- the router opens exactly these routes for a pending salon (see the
         pendingRepairAccess exception in router/index.ts). -->
    <div v-if="salon?.status === 'pending'" class="flex flex-col items-center gap-1.5 text-sm">
      <span class="text-xs text-(--color-text-muted)">اگر ساعات کاری یا خدمات شما کامل ثبت نشده است:</span>
      <div class="flex items-center gap-4">
        <RouterLink to="/hours" class="font-semibold text-(--color-accent-text) hover:underline">ساعات کاری</RouterLink>
        <RouterLink to="/services" class="font-semibold text-(--color-accent-text) hover:underline">خدمات و قیمت‌ها</RouterLink>
      </div>
    </div>

    <AppButton
      data-testid="refresh-status"
      type="button"
      variant="secondary"
      :disabled="refreshing"
      :loading="refreshing"
      @click="checkStatus"
    >
      بررسی وضعیت
    </AppButton>
  </div>
</template>
