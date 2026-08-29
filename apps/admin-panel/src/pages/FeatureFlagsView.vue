<!-- apps/admin-panel/src/pages/FeatureFlagsView.vue -->
<!-- Uniform Consequence Rule (DESIGN.md): flipping a platform-wide feature off changes what
     every customer/provider sees, so it gets the same confirm-before-commit shape as
     ConfigView.vue/ReferralSettingsView.vue's own money/behavior-moving settings. -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'

interface FeatureFlags {
  reviewsEnabled: boolean
  storiesEnabled: boolean
  portfolioEnabled: boolean
  referralsEnabled: boolean
  couponsEnabled: boolean
  onlinePaymentEnabled: boolean
}

const FLAG_META: Record<keyof FeatureFlags, { label: string; hint: string; icon: IconName }> = {
  reviewsEnabled: {
    label: 'نظرات و امتیازها',
    hint: 'غیرفعال‌سازی، ثبت نظر جدید و نمایش نظرات/امتیاز سالن‌ها را برای مشتریان مخفی می‌کند.',
    icon: 'reviews',
  },
  storiesEnabled: {
    label: 'استوری',
    hint: 'غیرفعال‌سازی، استوری‌ها را از نمایش عمومی مخفی می‌کند؛ مدیریت استوری در پنل فروشنده همچنان فعال می‌ماند.',
    icon: 'sparkles',
  },
  portfolioEnabled: {
    label: 'نمونه‌کارها',
    hint: 'غیرفعال‌سازی، بخش نمونه‌کارها را از پروفایل عمومی سالن مخفی می‌کند؛ مدیریت آن در پنل فروشنده همچنان فعال می‌ماند.',
    icon: 'palette',
  },
  referralsEnabled: {
    label: 'برنامه معرفی',
    hint: 'غیرفعال‌سازی، اعطای پاداش معرفی جدید را متوقف می‌کند؛ معرفی‌های در انتظار پس از فعال‌سازی مجدد بررسی می‌شوند.',
    icon: 'user-plus',
  },
  couponsEnabled: {
    label: 'کدهای تخفیف',
    hint: 'غیرفعال‌سازی، اعتبارسنجی و استفاده از هر کد تخفیفی (فروشنده یا معرفی) را متوقف می‌کند.',
    icon: 'coupon',
  },
  onlinePaymentEnabled: {
    label: 'پرداخت آنلاین',
    hint: 'فعال‌سازی، دریافت پیش‌پرداخت آنلاین (زرین‌پال) را برای نوبت‌های جدید فعال می‌کند؛ در حالت غیرفعال هر نوبت (خودکار یا با تایید دستی) بدون پرداخت آنلاین تایید می‌شود و کل مبلغ نقدی در سالن دریافت می‌شود.',
    icon: 'wallet',
  },
}
const FLAG_KEYS = Object.keys(FLAG_META) as (keyof FeatureFlags)[]

const { apiFetch } = useApi()
const { push: pushToast } = useToast()
const flags = ref<FeatureFlags | null>(null)
const originalFlags = ref<FeatureFlags | null>(null)
const loading = ref(true)
const loadError = ref(false)
const saving = ref(false)
const confirming = ref(false)

const confirmHeadingEl = ref<HTMLElement | null>(null)

async function load() {
  loading.value = true
  loadError.value = false
  const { data, error } = await apiFetch<FeatureFlags>('/admin/feature-flags', { silent: true })
  if (error || !data) {
    loadError.value = true
    loading.value = false
    return
  }
  flags.value = { ...data }
  originalFlags.value = { ...data }
  loading.value = false
}

const changedKeys = computed<(keyof FeatureFlags)[]>(() => {
  if (!flags.value || !originalFlags.value) return []
  return FLAG_KEYS.filter((key) => flags.value![key] !== originalFlags.value![key])
})
const hasChanges = computed(() => changedKeys.value.length > 0)

function askConfirm() {
  if (!hasChanges.value) return
  confirming.value = true
}

function cancelConfirm() {
  if (!flags.value || !originalFlags.value) return
  // Discard unsaved toggles rather than leaving them applied-but-unconfirmed.
  flags.value = { ...originalFlags.value }
  confirming.value = false
}

async function confirmSave() {
  if (!flags.value) return
  saving.value = true
  const body = Object.fromEntries(changedKeys.value.map((key) => [key, flags.value![key]]))
  const { error } = await apiFetch('/admin/feature-flags', { method: 'PATCH', body })
  saving.value = false
  if (!error) {
    pushToast('تغییرات ذخیره شد')
    originalFlags.value = { ...flags.value }
    confirming.value = false
  }
}

watch(confirming, async (isConfirming) => {
  await nextTick()
  if (isConfirming) confirmHeadingEl.value?.focus()
})

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-5 p-4 sm:p-8">
    <div v-if="loading" data-testid="feature-flags-loading" class="flex items-center justify-center gap-2 py-16 text-sm text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
      در حال بارگذاری ویژگی‌ها…
    </div>

    <AppCard
      v-else-if="loadError || !flags"
      :padded="false"
      data-testid="feature-flags-load-error"
      role="alert"
      class="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center"
    >
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
        <AppIcon name="warning" :size="22" />
      </div>
      <p class="text-sm text-(--color-text-muted)">بارگذاری ویژگی‌های پلتفرم با خطا مواجه شد.</p>
      <AppButton type="button" variant="secondary" data-testid="feature-flags-retry-button" @click="load">
        تلاش مجدد
      </AppButton>
    </AppCard>

    <template v-else-if="!confirming">
      <p class="text-sm text-(--color-text-muted)">
        غیرفعال‌سازی یک ویژگی، آن را برای همه سالن‌ها و کاربران پلتفرم مخفی می‌کند -- یک کلید خاموش/روشن عملیاتی، نه تنظیم هر سالن به‌طور جداگانه.
      </p>

      <AppCard :padded="false">
        <div
          v-for="(key, i) in FLAG_KEYS"
          :key="key"
          class="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5"
          :class="i > 0 && 'border-t border-(--color-border-soft)'"
        >
          <div class="flex min-w-0 items-center gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--color-border-soft) text-(--color-accent-text)">
              <AppIcon :name="FLAG_META[key].icon" :size="18" />
            </span>
            <div class="min-w-0">
              <p class="text-sm font-semibold text-(--color-text)">{{ FLAG_META[key].label }}</p>
              <p class="mt-0.5 text-xs text-(--color-text-muted)">{{ FLAG_META[key].hint }}</p>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2.5">
            <StatusBadge :label="flags[key] ? 'فعال' : 'غیرفعال'" :tone="flags[key] ? 'success' : 'neutral'" />
            <button
              type="button"
              role="switch"
              :aria-checked="flags[key]"
              :aria-label="'فعال‌سازی ' + FLAG_META[key].label"
              :data-testid="`flag-toggle-${key}`"
              class="flex h-11 w-11 shrink-0 items-center justify-center"
              @click="flags[key] = !flags[key]"
            >
              <span
                class="relative h-6 w-11 rounded-full transition-colors"
                :class="flags[key] ? 'bg-(--color-accent-text)' : 'bg-(--color-text-muted)'"
              >
                <span
                  class="absolute top-0.5 h-5 w-5 rounded-full bg-(--color-surface-card) shadow-(--shadow-sm) transition-all"
                  :class="flags[key] ? 'end-0.5' : 'start-0.5'"
                />
              </span>
            </button>
          </div>
        </div>
      </AppCard>

      <AppButton variant="primary" data-testid="feature-flags-save-button" :disabled="saving || !hasChanges" @click="askConfirm">
        ذخیره تغییرات
      </AppButton>
    </template>

    <div v-else class="space-y-3.5">
      <p ref="confirmHeadingEl" tabindex="-1" class="text-sm font-semibold text-(--tone-warning-text) focus:outline-none">
        این تغییرات روی چیزی که همه کاربران می‌بینند اثر می‌گذارد. لطفا موارد زیر را بررسی و تایید کنید:
      </p>
      <AppCard :padded="false" data-testid="feature-flags-confirm-summary">
        <div
          v-for="(key, i) in changedKeys"
          :key="key"
          data-testid="feature-flags-confirm-row"
          class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-4 sm:px-5"
          :class="i > 0 && 'border-t border-(--color-border-soft)'"
        >
          <p class="min-w-0 text-sm font-semibold text-(--color-text)">{{ FLAG_META[key].label }}</p>
          <p class="text-sm text-(--color-text-muted)">
            از <span class="font-semibold text-(--color-text)">{{ originalFlags![key] ? 'فعال' : 'غیرفعال' }}</span>
            به <span class="font-semibold text-(--tone-warning-text)">{{ flags[key] ? 'فعال' : 'غیرفعال' }}</span>
          </p>
        </div>
      </AppCard>
      <div class="flex flex-wrap gap-2.5">
        <AppButton type="button" data-testid="feature-flags-confirm-submit" :disabled="saving" :loading="saving" @click="confirmSave">
          تایید و ذخیره
        </AppButton>
        <AppButton type="button" variant="ghost" data-testid="feature-flags-confirm-cancel" :disabled="saving" @click="cancelConfirm">
          انصراف
        </AppButton>
      </div>
    </div>
  </div>
</template>
