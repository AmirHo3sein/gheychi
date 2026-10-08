<script setup lang="ts">
import type { BeautyGuide } from '../../utils/beauty-guide'
import { conceptLabel, guideImageUrl } from '../../utils/beauty-guide'

const { apiFetch } = useApi()
const config = useRuntimeConfig()

const { data: guides, pending, error, refresh } = await useAsyncData('beauty-guides', async () => {
  const { data, error: apiError } = await apiFetch<BeautyGuide[]>('/beauty-guides', { silent: true })
  if (apiError) throw Object.assign(new Error(apiError.message), { statusCode: apiError.status })
  return data ?? []
})

// The API answers 403/404 when the Beauty Guide feature flag is off -- that is «not offered»,
// which retrying can't fix, as opposed to a transient failure, which can.
const unavailable = computed(() => {
  const status = (error.value as { statusCode?: number } | undefined | null)?.statusCode
  return status === 403 || status === 404
})

const STATUS_LABELS: Record<BeautyGuide['status'], string> = {
  ready: 'آماده',
  processing: 'در حال آماده‌سازی',
  unsuitable: 'تصویر مناسب نبود',
  failed: 'ناموفق',
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeZone: 'Asia/Tehran' }).format(new Date(value))
}

useSeoMeta({ title: 'راهنماهای زیبایی من — قیچی', robots: 'noindex, nofollow' })
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6 p-4">
    <div class="flex items-center gap-2">
      <NuxtLink
        to="/profile"
        aria-label="بازگشت"
        class="-ms-2 flex h-11 w-11 items-center justify-center rounded-lg text-(--color-text-muted) transition-colors hover:bg-(--color-surface-subtle)"
      >
        <BaseIcon name="chevron-forward" :size="20" />
      </NuxtLink>
      <h1 class="text-lg font-bold">راهنماهای زیبایی من</h1>
    </div>

    <NuxtLink to="/beauty-guide" class="block">
      <BaseButton block>
        <template #icon><BaseIcon name="sparkles" :size="18" /></template>
        ساخت راهنمای جدید
      </BaseButton>
    </NuxtLink>

    <p v-if="pending && !guides && !error" data-testid="guides-loading" role="status" class="flex items-center justify-center gap-2 py-8 text-sm text-(--color-text-muted)">
      <BaseIcon name="spinner" :size="18" class="animate-spin" />
      در حال بارگذاری...
    </p>
    <p v-else-if="unavailable" data-testid="guides-unavailable" class="text-sm text-(--color-text-muted)">این قابلیت در حال حاضر در دسترس نیست.</p>
    <BaseCard v-else-if="error" data-testid="guides-error" role="alert" class="space-y-3 text-center">
      <p class="text-sm text-(--color-text-muted)">راهنماهای زیبایی بارگذاری نشد.</p>
      <BaseButton variant="secondary" data-testid="guides-retry-button" :loading="pending" @click="refresh()">تلاش دوباره</BaseButton>
    </BaseCard>
    <p v-else-if="!guides?.length" data-testid="empty-state" class="py-6 text-center text-sm text-(--color-text-muted)">
      هنوز راهنمایی نساخته‌اید.
    </p>

    <div v-else class="space-y-3">
      <NuxtLink
        v-for="guide in guides"
        :key="guide.id"
        :to="`/beauty-guide/${guide.id}`"
        data-testid="guide-history-item"
        class="flex gap-3 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-3 shadow-(--shadow-sm) transition-shadow hover:shadow-(--shadow-md)"
      >
        <img
          :src="guideImageUrl(config.public.apiBase as string, guide.imagePath)"
          alt=""
          loading="lazy"
          class="h-16 w-16 shrink-0 rounded-xl object-cover bg-(--color-surface-subtle)"
        />
        <div class="min-w-0 flex-1 space-y-1">
          <p class="truncate font-semibold text-(--color-text)">
            {{ guide.concepts.filter((c) => !c.removed).map((c) => conceptLabel(c)).join('، ') || STATUS_LABELS[guide.status] }}
          </p>
          <p class="text-xs text-(--color-text-muted)">{{ formatDate(guide.createdAt) }} · {{ STATUS_LABELS[guide.status] }}</p>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
