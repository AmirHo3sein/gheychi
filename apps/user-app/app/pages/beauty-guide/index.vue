<script setup lang="ts">
// Create a Beauty Guide: upload (or camera) → the API validates, strips metadata, analyzes
// with AI → the guide page. Also the landing point for "Explain this look" from a salon's
// portfolio (?portfolioItemId=), which reuses the same analysis engine server-side.
import type { BeautyGuide } from '../../utils/beauty-guide'
import { isUuid } from '../../utils/beauty-guide'

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024
const ANALYZING_HINTS = ['در حال بررسی تصویر…', 'در حال شناسایی تکنیک‌ها…', 'در حال آماده‌سازی راهنما…']

const route = useRoute()
const { apiFetch } = useApi()
const { flags: featureFlags } = useFeatureFlags()

const file = ref<File | null>(null)
const previewUrl = ref<string | null>(null)
const fileError = ref('')
const submitting = ref(false)
const submitError = ref('')
const hintIndex = ref(0)
let hintTimer: ReturnType<typeof setInterval> | undefined

function pickFile(event: Event) {
  const picked = (event.target as HTMLInputElement).files?.[0] ?? null
  fileError.value = ''
  submitError.value = ''
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = null
  file.value = null
  if (!picked) return
  // Friendly early checks; the API re-validates the real bytes regardless.
  if (!ACCEPTED_TYPES.includes(picked.type)) {
    fileError.value = 'فقط تصاویر JPEG، PNG یا WebP پذیرفته می‌شوند.'
    return
  }
  if (picked.size > MAX_BYTES) {
    fileError.value = 'حجم تصویر باید کمتر از ۵ مگابایت باشد.'
    return
  }
  file.value = picked
  previewUrl.value = URL.createObjectURL(picked)
}

function startHints() {
  hintIndex.value = 0
  hintTimer = setInterval(() => (hintIndex.value = (hintIndex.value + 1) % ANALYZING_HINTS.length), 2500)
}
function stopHints() {
  if (hintTimer) clearInterval(hintTimer)
  hintTimer = undefined
}

async function handleResult(result: { data: BeautyGuide | null; error: { status: number; message: string } | null }) {
  stopHints()
  submitting.value = false
  if (result.error || !result.data) {
    submitError.value =
      result.error?.status === 404
        ? 'این قابلیت در حال حاضر در دسترس نیست.'
        : (result.error?.message ?? 'ساخت راهنما ناموفق بود.')
    return
  }
  await navigateTo(`/beauty-guide/${result.data.id}`)
}

async function submit() {
  if (!file.value || submitting.value) return
  submitting.value = true
  submitError.value = ''
  startHints()
  const form = new FormData()
  form.append('file', file.value)
  await handleResult(await apiFetch<BeautyGuide>('/beauty-guides', { method: 'POST', body: form, silent: true }))
}

onMounted(async () => {
  const portfolioItemId = route.query.portfolioItemId
  if (featureFlags.value.beautyGuideEnabled && isUuid(portfolioItemId)) {
    submitting.value = true
    startHints()
    await handleResult(
      await apiFetch<BeautyGuide>(`/beauty-guides/from-portfolio/${portfolioItemId}`, { method: 'POST', silent: true }),
    )
  }
})

onBeforeUnmount(() => {
  stopHints()
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})

useSeoMeta({ title: 'راهنمای زیبایی — قیچی', robots: 'noindex, nofollow' })
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-5 p-4">
    <div class="flex items-center gap-2">
      <BaseIcon name="sparkles" :size="22" class="text-(--color-ai)" />
      <h1 class="text-xl font-bold text-(--color-text)">راهنمای زیبایی</h1>
    </div>

    <BaseCard v-if="!featureFlags.beautyGuideEnabled" data-testid="guide-unavailable" class="text-sm text-(--color-text-muted)">
      این قابلیت در حال حاضر در دسترس نیست.
    </BaseCard>

    <template v-else>
      <p class="text-sm leading-7 text-(--color-text-muted)">
        عکس استایلی را که دوست دارید بفرستید. می‌گوییم احتمالاً چه تکنیکی است، به آرایشگر چه بگویید، و کدام سالن‌های
        قیچی آن را انجام می‌دهند.
      </p>

      <div v-if="submitting" data-testid="guide-analyzing" class="space-y-4 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-6 text-center" role="status" aria-live="polite">
        <img v-if="previewUrl" :src="previewUrl" alt="" class="mx-auto max-h-64 rounded-xl object-contain opacity-80" />
        <BaseIcon name="spinner" :size="28" class="mx-auto animate-spin text-(--color-ai)" />
        <p class="text-sm font-medium text-(--color-text)">{{ ANALYZING_HINTS[hintIndex] }}</p>
        <p class="text-xs text-(--color-text-muted)">این کار ممکن است چند ثانیه طول بکشد.</p>
      </div>

      <form v-else class="space-y-4" @submit.prevent="submit">
        <label
          for="guide-upload"
          class="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-(--color-border) bg-(--color-surface-card) p-6 text-center transition-colors hover:border-(--color-accent)"
        >
          <img v-if="previewUrl" :src="previewUrl" alt="پیش‌نمایش تصویر انتخاب‌شده" data-testid="guide-preview" class="max-h-72 rounded-xl object-contain" />
          <template v-else>
            <BaseIcon name="camera" :size="32" class="text-(--color-text-muted)" />
            <span class="font-semibold text-(--color-text)">انتخاب یا گرفتن عکس</span>
            <span class="text-xs text-(--color-text-muted)">JPEG، PNG یا WebP — حداکثر ۵ مگابایت</span>
          </template>
          <input
            id="guide-upload"
            data-testid="guide-file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            class="sr-only"
            @change="pickFile"
          />
        </label>
        <p v-if="fileError" data-testid="guide-file-error" class="text-sm text-(--color-danger)">{{ fileError }}</p>
        <p v-if="submitError" data-testid="guide-submit-error" role="alert" class="text-sm text-(--color-danger)">{{ submitError }}</p>
        <BaseButton type="submit" size="lg" block :disabled="!file" data-testid="guide-submit">
          <template #icon><BaseIcon name="sparkles" :size="18" /></template>
          ساخت راهنما
        </BaseButton>
        <p class="text-xs leading-6 text-(--color-text-muted)">
          تصویر شما خصوصی است و فقط برای خودتان قابل مشاهده است؛ اطلاعات مکانی عکس حذف می‌شود. اگر هنگام رزرو راهنما را به
          نوبت پیوست کنید، فقط همان سالن آن را می‌بیند.
        </p>
      </form>

      <NuxtLink to="/account/beauty-guides" class="inline-flex items-center gap-1 text-sm font-medium text-(--color-accent-text) hover:underline">
        راهنماهای قبلی من
        <BaseIcon name="chevron-back" :size="14" />
      </NuxtLink>
    </template>
  </div>
</template>
