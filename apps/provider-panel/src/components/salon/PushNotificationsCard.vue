<!-- apps/provider-panel/src/components/salon/PushNotificationsCard.vue -->
<!-- «اعلان‌های مرورگر»: turn browser push on for this device, so a new booking request (which
     the salon has only minutes to answer in manual-approval mode) reaches the owner even with
     the panel closed. Every state is stated honestly -- unsupported browser, push not set up on
     the server side, permission blocked -- rather than offering a switch that cannot work. -->
<script setup lang="ts">
import { onMounted } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { usePushNotifications } from '@/composables/usePushNotifications'

const { state, busy, refresh, enable, disable } = usePushNotifications()
onMounted(refresh)
</script>

<template>
  <div class="space-y-3 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-5 shadow-(--shadow-sm)" data-testid="push-card">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <h2 class="font-bold text-(--color-text)">اعلان‌های مرورگر</h2>
        <p class="mt-1 text-sm leading-6 text-(--color-text-muted)">
          درخواست‌ها و نوبت‌های جدید، لغو و تغییر زمان را روی همین دستگاه ببینید، حتی وقتی پنل بسته است.
        </p>
      </div>
      <span
        v-if="state === 'on'"
        class="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-(--tone-success-bg) px-2.5 py-1 text-xs font-semibold text-(--tone-success-text)"
        data-testid="push-on-badge"
      >
        <span class="h-1.5 w-1.5 rounded-full bg-(--tone-success-text)" aria-hidden="true" />
        روشن در این دستگاه
      </span>
    </div>

    <p v-if="state === 'unsupported'" class="text-sm text-(--color-text-muted)" data-testid="push-unsupported">
      این مرورگر اعلان‌های وب را پشتیبانی نمی‌کند. در آیفون، ابتدا پنل را با «افزودن به صفحهٔ اصلی» نصب کنید.
    </p>
    <p v-else-if="state === 'unconfigured'" class="text-sm text-(--color-text-muted)" data-testid="push-unconfigured">
      اعلان‌های مرورگر هنوز برای قیچی راه‌اندازی نشده است. تا آن زمان پیامک درخواست‌های جدید برایتان ارسال می‌شود.
    </p>
    <div v-else-if="state === 'denied'" class="flex items-start gap-2 rounded-xl bg-(--tone-warning-bg) p-3 text-sm text-(--tone-warning-text)" data-testid="push-denied">
      <AppIcon name="warning" :size="16" class="mt-0.5 shrink-0" />
      <p>اجازهٔ اعلان برای این سایت در مرورگر مسدود شده است. از تنظیمات سایت در نوار نشانی، «اعلان‌ها» را روی «اجازه» بگذارید و صفحه را دوباره باز کنید.</p>
    </div>
    <div v-else class="flex flex-wrap items-center gap-2">
      <AppButton v-if="state === 'off'" type="button" :loading="busy" data-testid="push-enable" @click="enable">
        <template #icon><AppIcon name="bell" :size="16" /></template>
        روشن کردن اعلان‌ها
      </AppButton>
      <AppButton v-else type="button" variant="secondary" :loading="busy" data-testid="push-disable" @click="disable">
        خاموش کردن در این دستگاه
      </AppButton>
    </div>
  </div>
</template>
